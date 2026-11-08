// The local Bible library: translations stored in bible.db, where every
// lookup takes about a millisecond and works offline.
//
//  · install(code)   — download a free translation from bible.helloao.org
//                      (public domain / openly licensed only), check it, store it
//  · store(...)      — shared by the downloader and the file importer: checks
//                      every book, chapter and verse against the KJV layout,
//                      writes the text in one go and records what it covers
//  · list()          — what's installed and what can be added, with reasons
//
// Nothing is ever stored under a name it isn't: the free catalogue's "GNB" is
// the 1869 Noyes Bible, not the Good News Bible, so codes are fixed here, and
// licensed names (NKJV, AMP, TPT, GNT…) are only accepted from the importer
// with the operator stating where the file came from.
const { getDb, getBookNum, invalidateTranslations } = require('./bibleDb');
const { BOOKS, findBook } = require('./books');

const CATALOGUE = 'https://bible.helloao.org/api/available_translations.json';
const BASE = 'https://bible.helloao.org';

// Free English translations offered for download. Checked against the live
// catalogue (Nov 2026): full Bibles, commercial use allowed, no credit line
// required. Our code, their id, the name shown to the operator.
const FREE = [
  { code: 'BSB', id: 'BSB', name: 'Berean Standard Bible', note: 'Modern, reads close to NIV / NKJV' },
  { code: 'WEB', id: 'ENGWEBP', name: 'World English Bible', note: 'Modern, widely used' },
  { code: 'MSB', id: 'eng_msb', name: 'Majority Standard Bible', note: 'Modern, Majority Text' },
  { code: 'AAB', id: 'AAB', name: 'Accessible Ancients Bible', note: 'Modern, plain English' },
  { code: 'DARBY', id: 'eng_dby', name: 'Darby Translation (1890)', note: 'Classic literal' },
  { code: 'RV', id: 'eng_rv5', name: 'Revised Version (1885)', note: 'Classic, KJV revision' },
  { code: 'GENEVA', id: 'eng_gnv', name: 'Geneva Bible (1599)', note: 'Historic' },
  { code: 'WEBSTER', id: 'eng_wbs', name: 'Webster Bible (1833)', note: 'Classic, KJV revision' },
];

// Copyrighted translations: only from a file the operator is licensed to use
const LICENSED_ONLY = new Set(['NKJV', 'AMP', 'AMPC', 'TPT', 'GNT', 'GNB', 'NIV', 'ESV', 'NLT', 'MSG', 'NASB', 'CSB', 'HCSB', 'CEV', 'NCV', 'TLB', 'NRSV', 'RSV', 'NET', 'LEB', 'CJB', 'ERV', 'ICB', 'NIRV']);

function meta() {
  return getDb().prepare('SELECT * FROM translation_meta ORDER BY code').all();
}

// Expected verses per chapter, from the KJV layout in bible_structure
function layout() {
  const map = new Map();
  for (const r of getDb().prepare('SELECT book, chapter, max_verse FROM bible_structure').all()) map.set(r.book + '|' + r.chapter, r.max_verse);
  return map;
}

// rows: [{ book (our name), chapter, verse, text }]
// Returns the coverage report; throws (and stores nothing) if the text is
// empty or clearly not a Bible.
function store(code, name, rows, info = {}) {
  code = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code || code.length > 12) throw new Error('A translation code is 1–12 letters or digits, e.g. BSB');
  if (code === 'KJV' && info.source !== 'seed') throw new Error('KJV is built in and can\'t be replaced');

  const expected = layout();
  const seen = new Set(), clean = [];
  let extra = 0, empty = 0, dupes = 0;
  for (const r of rows) {
    const text = String(r.text || '').replace(/\s+/g, ' ').trim();
    if (!text) { empty++; continue; }
    const key = r.book + '|' + r.chapter + '|' + r.verse;
    if (seen.has(key)) { dupes++; continue; }
    seen.add(key);
    if (!expected.has(r.book + '|' + r.chapter) || r.verse > expected.get(r.book + '|' + r.chapter)) extra++;
    clean.push({ book: r.book, chapter: r.chapter, verse: r.verse, text });
  }
  if (clean.length < 100) throw new Error(`Only ${clean.length} verses found — this doesn't look like a Bible file`);

  // Coverage, book by book, against the KJV layout
  const perBook = [];
  let missing = 0, total = 0;
  for (const b of BOOKS) {
    let want = 0, got = 0;
    for (let c = 1; expected.has(b.name + '|' + c); c++) {
      const max = expected.get(b.name + '|' + c);
      want += max;
      for (let v = 1; v <= max; v++) if (seen.has(b.name + '|' + c + '|' + v)) got++;
    }
    total += want; missing += want - got;
    if (got) perBook.push({ book: b.name, got, want });
  }
  const books = perBook.length;
  const nt = perBook.filter(p => getBookNum(p.book) >= 40).length, ot = books - nt;
  const share = (total - missing) / total;
  const coverage = books === 66 && share >= 0.985 ? 'Full Bible'
    : nt === 27 && ot === 0 ? 'New Testament'
    : ot === 39 && nt === 0 ? 'Old Testament'
    : `${books} books (${ot} OT, ${nt} NT)`;

  const db = getDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM verses WHERE translation = ? AND substr(source, 1, 3) != 'ai_'`).run(code);
    const ins = db.prepare('INSERT INTO verses (translation, book, book_num, chapter, verse, text, source) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const r of clean) ins.run(code, r.book, getBookNum(r.book), r.chapter, r.verse, r.text, info.source || 'import');
    db.prepare(`INSERT OR REPLACE INTO translation_meta (code, name, source, licence, coverage, verses, books, missing, installed_at, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(code, name, info.source || 'import', info.licence || '', coverage, clean.length, books, missing, new Date().toISOString(), info.note || '');
  })();
  invalidateTranslations();
  const report = { code, name, coverage, verses: clean.length, books, missing, extra, empty, duplicates: dupes,
    missingBooks: BOOKS.filter(b => !perBook.find(p => p.book === b.name)).map(b => b.name) };
  console.log(`[Library] ${code} stored: ${coverage}, ${clean.length} verses${missing ? `, ${missing} verses missing vs KJV layout` : ''}`);
  return report;
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
  return res.json();
}

// bible.helloao.org verse content: strings, {text}, and markers (notes, line breaks)
function verseText(content) {
  return (content || []).map(c => typeof c === 'string' ? c : (c && typeof c.text === 'string' ? c.text : ' ')).join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?)\]’”])/g, '$1')   // where a footnote marker sat: "Sivan )" → "Sivan)"
    .replace(/([(\[“‘])\s+/g, '$1')
    .trim();
}

function rowsFromHelloao(json) {
  const rows = [];
  for (const book of json.books || []) {
    const b = findBook(book.id);
    if (!b) continue; // apocrypha etc.
    for (const ch of book.chapters || []) {
      const chapter = ch.chapter || ch;
      for (const item of chapter.content || []) {
        if (item.type !== 'verse') continue;
        rows.push({ book: b.name, chapter: chapter.number, verse: item.number, text: verseText(item.content) });
      }
    }
  }
  return rows;
}

// Download and store a free translation. onStep(message) reports progress.
async function install(code, onStep = () => {}) {
  const offer = FREE.find(f => f.code === String(code).toUpperCase());
  if (!offer) throw new Error(`${code} isn't in the free list (${FREE.map(f => f.code).join(', ')})`);
  onStep('Checking the licence in the catalogue…');
  const cat = await getJson(CATALOGUE);
  const entry = (cat.translations || []).find(t => t.id === offer.id);
  if (!entry) throw new Error(`${offer.name} is no longer in the bible.helloao.org catalogue`);
  const lic = entry.license || {};
  if (lic.commercialUse !== 'allowed' || lic.attribution === 'required') {
    throw new Error(`${offer.name}'s licence changed (commercial use: ${lic.commercialUse}, credit: ${lic.attribution}) — not installed`);
  }
  onStep(`Downloading ${offer.name}…`);
  const json = await getJson(BASE + entry.completeTranslationApiLink);
  onStep('Checking every book, chapter and verse…');
  const rows = rowsFromHelloao(json);
  return store(offer.code, offer.name, rows, { source: 'helloao:' + offer.id, licence: entry.licenseUrl || '', note: offer.note });
}

function remove(code) {
  code = String(code).toUpperCase();
  if (['KJV'].includes(code)) throw new Error('KJV is built in');
  const db = getDb();
  const n = db.transaction(() => {
    const c = db.prepare(`DELETE FROM verses WHERE translation = ? AND substr(source, 1, 3) != 'ai_'`).run(code).changes;
    db.prepare('DELETE FROM translation_meta WHERE code = ?').run(code);
    return c;
  })();
  invalidateTranslations();
  return n;
}

function list() {
  const installed = meta();
  const have = new Set(installed.map(m => m.code));
  return {
    installed,
    free: FREE.map(f => ({ ...f, installed: have.has(f.code) })),
  };
}

module.exports = { install, store, remove, list, rowsFromHelloao, FREE, LICENSED_ONLY };
