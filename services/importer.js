// Reads a Bible file into rows Di.Verse can store: [{ book, chapter, verse, text }]
//
// Supports existing standalone scripture formats. Optional source notes are recorded when provided.
//
// Formats:
//  · JSON — bible.helloao.org complete.json; a flat list of
//    { book, chapter, verse, text }; { books: [{ name, chapters: [{ chapter,
//    verses: [{ verse, text }] }] }] }; or [{ abbrev|name, chapters: [[ "v1", "v2" ]] }]
//  · USFM (.usfm / .sfm, Paratext / Bible societies): \id, \c, \v
//  · OSIS XML (SWORD / CrossWire): <verse osisID="John.3.16">…</verse> or milestones
//  · Zefania XML: <BIBLEBOOK bnumber> <CHAPTER cnumber> <VERS vnumber>
const { findBook, BOOKS } = require('./books');
const { rowsFromHelloao } = require('./library');

function bookOf(x) {
  if (x == null) return null;
  if (typeof x === 'number' || /^\d+$/.test(String(x))) return BOOKS[Number(x) - 1] || null;
  return findBook(String(x).replace(/\.$/, ''));
}

// { "Genesis": { "1": { "1": "In the beginning…", … } } } — book → chapter → verse,
// optionally wrapped once ({ "ASV": { "Genesis": … } } or { "books": { … } })
function fromBookMap(data) {
  const isMap = o => o && typeof o === 'object' && !Array.isArray(o);
  const bookKeys = o => isMap(o) ? Object.keys(o).filter(k => bookOf(k)).length : 0;
  if (bookKeys(data) < 1) {
    const inner = isMap(data) && Object.values(data).find(v => bookKeys(v) >= 1);
    if (!inner) return null;
    data = inner;
  }
  const rows = [];
  for (const [bk, chapters] of Object.entries(data)) {
    const b = bookOf(bk);
    if (!b || !isMap(chapters)) continue;
    for (const [c, verses] of Object.entries(chapters)) {
      if (isMap(verses)) {
        for (const [v, t] of Object.entries(verses)) rows.push({ book: b.name, chapter: parseInt(c), verse: parseInt(v), text: String(t && t.text != null ? t.text : t) });
      } else if (Array.isArray(verses)) {
        verses.forEach((t, i) => rows.push({ book: b.name, chapter: parseInt(c), verse: i + 1, text: String(t && t.text != null ? t.text : t) }));
      }
    }
  }
  return rows;
}

function fromJson(data) {
  const mapped = fromBookMap(data);
  if (mapped && mapped.length) return mapped;
  if (data && Array.isArray(data.books) && data.books[0] && data.books[0].chapters && data.books[0].chapters[0] && (data.books[0].chapters[0].chapter || data.books[0].chapters[0].content)) {
    return rowsFromHelloao(data); // bible.helloao.org
  }
  const rows = [];
  const list = Array.isArray(data) ? data : (data.verses || data.books || data.bible || []);
  for (const item of list) {
    // flat: { book, chapter, verse, text }
    if (item && item.verse != null && item.text != null) {
      const b = bookOf(item.book || item.book_name || item.bookName || item.book_id || item.bookId);
      if (b) rows.push({ book: b.name, chapter: Number(item.chapter), verse: Number(item.verse), text: String(item.text) });
      continue;
    }
    // nested: { name|abbrev|book, chapters: [...] }
    const b = item && bookOf(item.name || item.book || item.abbrev || item.id || item.usfm);
    if (!b || !Array.isArray(item.chapters)) continue;
    item.chapters.forEach((ch, ci) => {
      if (Array.isArray(ch)) ch.forEach((t, vi) => rows.push({ book: b.name, chapter: ci + 1, verse: vi + 1, text: String(t) }));
      else if (ch && Array.isArray(ch.verses)) ch.verses.forEach((v, vi) => {
        if (typeof v === 'string') rows.push({ book: b.name, chapter: Number(ch.chapter || ci + 1), verse: vi + 1, text: v });
        else rows.push({ book: b.name, chapter: Number(ch.chapter || ci + 1), verse: Number(v.verse || v.number || vi + 1), text: String(v.text || '') });
      });
    });
  }
  return rows;
}

// USFM: keep the words, drop footnotes, cross-references and formatting markers
function fromUsfm(src) {
  const rows = [];
  let book = null, chapter = 0, cur = null;
  const flush = () => { if (cur) { rows.push(cur); cur = null; } };
  const clean = t => t
    .replace(/\\f\s[\s\S]*?\\f\*/g, ' ').replace(/\\x\s[\s\S]*?\\x\*/g, ' ')   // footnotes, cross references
    .replace(/\\w\s([^|\\]*)(\|[^\\]*)?\\w\*/g, '$1')                         // \w word|lemma\w*
    .replace(/\\\+?[a-z]+\d*\*?/g, ' ');                                      // any other marker
  for (const line of src.split(/\r?\n/)) {
    const m = line.match(/^\\(\S+)\s*(.*)$/);
    if (!m) { if (cur) cur.text += ' ' + clean(line); continue; }
    const [, tag, rest] = m;
    if (tag === 'id') { flush(); book = bookOf(rest.split(/\s/)[0]); chapter = 0; }
    else if (tag === 'c') { flush(); chapter = parseInt(rest); }
    else if (tag === 'v') {
      flush();
      const vm = rest.match(/^(\d+)(?:-\d+)?\s*([\s\S]*)$/);
      if (book && chapter && vm) cur = { book: book.name, chapter, verse: parseInt(vm[1]), text: clean(vm[2]) };
    } else if (/^(s\d?|ms\d?|mr|r|d|sp|cl|h|toc\d|mt\d?|is\d?|ip|rem|ide|sts)$/.test(tag)) {
      // headings and book introductions aren't verse text
      if (tag !== 'd') flush();
    } else if (cur) cur.text += ' ' + clean(rest);                            // \p, \q1, \m … continue the verse
  }
  flush();
  return rows;
}

function decode(s) {
  return s.replace(/<note[\s\S]*?<\/note>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'");
}

function fromOsis(src) {
  const rows = [];
  // container form: <verse osisID="John.3.16">text</verse>
  for (const m of src.matchAll(/<verse\b[^>]*\bosisID="([^"]+)"[^>]*>([\s\S]*?)<\/verse>/g)) {
    const [bk, c, v] = m[1].split(' ')[0].split('.');
    const b = bookOf(bk);
    if (b) rows.push({ book: b.name, chapter: parseInt(c), verse: parseInt(v), text: decode(m[2]) });
  }
  if (rows.length) return rows;
  // milestone form: <verse sID="John.3.16" osisID="John.3.16"/> text <verse eID="John.3.16"/>
  const re = /<verse\b[^>]*\bsID="([^"]+)"[^>]*\/>([\s\S]*?)<verse\b[^>]*\beID="\1"[^>]*\/>/g;
  for (const m of src.matchAll(re)) {
    const [bk, c, v] = m[1].split('.');
    const b = bookOf(bk);
    if (b) rows.push({ book: b.name, chapter: parseInt(c), verse: parseInt(v), text: decode(m[2]) });
  }
  return rows;
}

function fromZefania(src) {
  const rows = [];
  for (const bm of src.matchAll(/<BIBLEBOOK\b[^>]*\bbnumber="(\d+)"[^>]*>([\s\S]*?)<\/BIBLEBOOK>/gi)) {
    const b = bookOf(bm[1]);
    if (!b) continue;
    for (const cm of bm[2].matchAll(/<CHAPTER\b[^>]*\bcnumber="(\d+)"[^>]*>([\s\S]*?)<\/CHAPTER>/gi))
      for (const vm of cm[2].matchAll(/<VERS\b[^>]*\bvnumber="(\d+)"[^>]*>([\s\S]*?)<\/VERS>/gi))
        rows.push({ book: b.name, chapter: parseInt(cm[1]), verse: parseInt(vm[1]), text: decode(vm[2]) });
  }
  return rows;
}

// Several .usfm files (one per book) can be passed joined together.
function parse(content, filename = '') {
  const src = Buffer.isBuffer(content) ? content.toString('utf8').replace(/^﻿/, '') : String(content).replace(/^﻿/, '');
  const name = filename.toLowerCase();
  let format, rows;
  if (/\.json$/.test(name) || /^\s*[[{]/.test(src)) { format = 'JSON'; rows = fromJson(JSON.parse(src)); }
  else if (/\.(usfm|sfm|ptx)$/.test(name) || /^\s*\\id\s/m.test(src)) { format = 'USFM'; rows = fromUsfm(src); }
  else if (/<osis\b|osisID=/i.test(src)) { format = 'OSIS'; rows = fromOsis(src); }
  else if (/<XMLBIBLE\b|<BIBLEBOOK\b/i.test(src)) { format = 'Zefania'; rows = fromZefania(src); }
  else throw new Error('Unrecognised file — use JSON, USFM, OSIS XML or Zefania XML');
  rows = rows.filter(r => Number.isInteger(r.chapter) && Number.isInteger(r.verse) && r.chapter > 0 && r.verse > 0);
  if (!rows.length) throw new Error(`No verses found in this ${format} file — its layout isn't one Di.Verse knows yet. Send the first part of it (head -c 1500 FILE) to your helper.`);
  return { format, rows };
}

module.exports = { parse };

// Import a single file into the local library. A source note is optional metadata.
function importFile({ content, filename = '', code, name, obtained = '' }) {
  const { store } = require('./library');
  code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) throw new Error('Give the translation a code, e.g. NKJV');
  if (!name || !String(name).trim()) throw new Error('Give the translation its full name, e.g. New King James Version');
  const { format, rows } = parse(content, filename);
  const report = store(code, String(name).trim(), rows, {
    source: 'import:' + format,
    licence: String(obtained || '').trim(),
    note: filename,
  });
  return { ...report, format };
}

module.exports.importFile = importFile;
