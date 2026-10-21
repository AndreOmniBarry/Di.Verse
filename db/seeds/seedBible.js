/**
 * Di.Verse — Bible Seed Script
 * Seeds KJV fully from GitHub (public domain, all 31,102 verses)
 * All other translations fetched from Claude on demand and cached automatically
 * 
 * Run: node db/seeds/seedBible.js
 */

const Database = require('better-sqlite3');
const path = require('path');
const https = require('https');

const DB_PATH = path.join(__dirname, '../bible.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// ── Schema ──
db.exec(`
  CREATE TABLE IF NOT EXISTS verses (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    translation TEXT NOT NULL,
    book        TEXT NOT NULL,
    book_num    INTEGER NOT NULL,
    chapter     INTEGER NOT NULL,
    verse       INTEGER NOT NULL,
    text        TEXT NOT NULL,
    source      TEXT DEFAULT 'seed'
  );
  CREATE INDEX IF NOT EXISTS idx_lookup
    ON verses(translation, book_num, chapter, verse);

  CREATE TABLE IF NOT EXISTS bible_structure (
    book_num  INTEGER NOT NULL,
    book      TEXT NOT NULL,
    chapter   INTEGER NOT NULL,
    max_verse INTEGER NOT NULL,
    PRIMARY KEY (book_num, chapter)
  );
`);

// Makes INSERT OR REPLACE replace instead of duplicating rows on --force reseeds.
// An older DB that already holds duplicates can't take the index — say so.
try {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_verse ON verses(translation, book, chapter, verse)`);
} catch (err) {
  console.warn('⚠️  Duplicate verses found in db/bible.db — delete the file and reseed for a clean copy.');
}

// ── All 66 books with correct GitHub filenames ──
const BOOKS = [
  ['Genesis','Genesis'],['Exodus','Exodus'],['Leviticus','Leviticus'],
  ['Numbers','Numbers'],['Deuteronomy','Deuteronomy'],['Joshua','Joshua'],
  ['Judges','Judges'],['Ruth','Ruth'],['1 Samuel','1Samuel'],
  ['2 Samuel','2Samuel'],['1 Kings','1Kings'],['2 Kings','2Kings'],
  ['1 Chronicles','1Chronicles'],['2 Chronicles','2Chronicles'],
  ['Ezra','Ezra'],['Nehemiah','Nehemiah'],['Esther','Esther'],
  ['Job','Job'],['Psalms','Psalms'],['Proverbs','Proverbs'],
  ['Ecclesiastes','Ecclesiastes'],['Song of Solomon','SongofSolomon'],
  ['Isaiah','Isaiah'],['Jeremiah','Jeremiah'],['Lamentations','Lamentations'],
  ['Ezekiel','Ezekiel'],['Daniel','Daniel'],['Hosea','Hosea'],
  ['Joel','Joel'],['Amos','Amos'],['Obadiah','Obadiah'],
  ['Jonah','Jonah'],['Micah','Micah'],['Nahum','Nahum'],
  ['Habakkuk','Habakkuk'],['Zephaniah','Zephaniah'],['Haggai','Haggai'],
  ['Zechariah','Zechariah'],['Malachi','Malachi'],['Matthew','Matthew'],
  ['Mark','Mark'],['Luke','Luke'],['John','John'],['Acts','Acts'],
  ['Romans','Romans'],['1 Corinthians','1Corinthians'],
  ['2 Corinthians','2Corinthians'],['Galatians','Galatians'],
  ['Ephesians','Ephesians'],['Philippians','Philippians'],
  ['Colossians','Colossians'],['1 Thessalonians','1Thessalonians'],
  ['2 Thessalonians','2Thessalonians'],['1 Timothy','1Timothy'],
  ['2 Timothy','2Timothy'],['Titus','Titus'],['Philemon','Philemon'],
  ['Hebrews','Hebrews'],['James','James'],['1 Peter','1Peter'],
  ['2 Peter','2Peter'],['1 John','1John'],['2 John','2John'],
  ['3 John','3John'],['Jude','Jude'],['Revelation','Revelation']
];

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'DiVerse-Church-App/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Parse error: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

const insertVerse = db.prepare(`
  INSERT OR REPLACE INTO verses (translation, book, book_num, chapter, verse, text, source)
  VALUES (?, ?, ?, ?, ?, ?, 'seed')
`);
const insertStructure = db.prepare(`
  INSERT OR REPLACE INTO bible_structure (book_num, book, chapter, max_verse)
  VALUES (?, ?, ?, ?)
`);

const insertManyVerses = db.transaction((rows) => {
  for (const r of rows) insertVerse.run(r.translation, r.book, r.book_num, r.chapter, r.verse, r.text);
});
const insertManyStructure = db.transaction((rows) => {
  for (const r of rows) insertStructure.run(r.book_num, r.book, r.chapter, r.max_verse);
});

// Public-domain translations stored locally, same as KJV. Source files list
// the 66 books in canonical order, so book N here is BOOKS[N-1].
// Darby is deliberately absent: the available file has thousands of verses
// with words run together ("In the beginningGod").
const PD_BASE = 'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/';
const PD_TRANSLATIONS = [
  { code: 'ASV', file: 'ASV.json' },
  { code: 'YLT', file: 'YLT.json' },
  { code: 'BBE', file: 'BBE.json' },
];

function countVerses(code) {
  return db.prepare(`SELECT COUNT(*) as c FROM verses WHERE translation = ?`).get(code).c;
}

// "[Selah" in the ASV source is a conversion artifact with no closing bracket
function cleanText(text) {
  return text.replace(/\[Selah\b(?![^\[]*\])/g, 'Selah').replace(/\s+/g, ' ').trim();
}

async function seedKJV() {
  console.log('📖 Seeding KJV from GitHub (public domain source)...\n');

  const base = 'https://raw.githubusercontent.com/aruljohn/Bible-kjv/master/';
  let totalVerses = 0;
  const structureRows = [];

  for (let i = 0; i < BOOKS.length; i++) {
    const [bookName, filename] = BOOKS[i];
    const bookNum = i + 1;
    process.stdout.write(`  [${String(bookNum).padStart(2,'0')}/66] ${bookName.padEnd(22)}...`);

    try {
      const data = await fetchJSON(`${base}${filename}.json`);
      const verseRows = [];

      for (let chIdx = 0; chIdx < data.chapters.length; chIdx++) {
        const chapter = chIdx + 1;
        const verses = data.chapters[chIdx].verses;

        for (const v of verses) {
          verseRows.push({
            translation: 'KJV',
            book: bookName,
            book_num: bookNum,
            chapter,
            verse: parseInt(v.verse),
            text: v.text.trim()
          });
        }

        structureRows.push({
          book_num: bookNum,
          book: bookName,
          chapter,
          max_verse: verses.length
        });
      }

      insertManyVerses(verseRows);
      totalVerses += verseRows.length;
      console.log(` ✓  ${verseRows.length} verses`);

    } catch (err) {
      console.log(` ✗  ERROR: ${err.message}`);
    }

    await sleep(80);
  }

  insertManyStructure(structureRows);
  console.log(`\n  ✅ KJV: ${totalVerses} verses · ${structureRows.length} chapter records\n`);
}

async function seedPublicDomain({ code, file }) {
  process.stdout.write(`📖 ${code.padEnd(4)} downloading...`);
  const data = await fetchJSON(PD_BASE + file);
  if (!Array.isArray(data.books) || data.books.length !== 66) {
    throw new Error(`expected 66 books, got ${data.books && data.books.length}`);
  }

  const rows = [];
  let omitted = 0;
  data.books.forEach((book, i) => {
    const bookName = BOOKS[i][0];
    for (const ch of book.chapters) {
      for (const v of ch.verses) {
        const text = cleanText(v.text || '');
        // A few verses (e.g. Acts 8:37) are absent from this translation's
        // source text; leave them out so lookups say so instead of showing ""
        if (!text) { omitted++; continue; }
        rows.push({ translation: code, book: bookName, book_num: i + 1, chapter: ch.chapter, verse: v.verse, text });
      }
    }
  });
  if (rows.length < 31000) throw new Error(`only ${rows.length} verses — source file looks incomplete`);

  db.prepare(`DELETE FROM verses WHERE translation = ?`).run(code);
  insertManyVerses(rows);
  console.log(` ✓  ${rows.length} verses${omitted ? ` (${omitted} not in this translation)` : ''}`);
}

async function seed() {
  console.log('\n========================================');
  console.log('  Di.Verse — Bible Database Seeder');
  console.log('========================================\n');

  const force = process.argv.includes('--force');

  // Verse text generated by an AI model in older versions is not scripture — remove it
  const removed = db.prepare(`DELETE FROM verses WHERE source = 'claude_cache'`).run().changes;
  if (removed) console.log(`🧹 Removed ${removed} AI-generated verses from earlier versions\n`);

  if (countVerses('KJV') > 30000 && !force) console.log(`✅ KJV already seeded (${countVerses('KJV')} verses)`);
  else await seedKJV();

  let failed = 0;
  for (const t of PD_TRANSLATIONS) {
    if (countVerses(t.code) > 31000 && !force) { console.log(`✅ ${t.code} already seeded (${countVerses(t.code)} verses)`); continue; }
    try { await seedPublicDomain(t); }
    catch (err) { failed++; console.log(` ✗  ${t.code} failed: ${err.message}`); }
  }

  console.log('\n========================================');
  console.log('  Seeding Complete');
  console.log('========================================\n');
  printSummary();
  console.log('  Licensed translations (NKJV, AMP, NIV, ESV, NLT, MSG...) come from');
  console.log('  API.Bible when APIBIBLE_KEY is set in .env — see AUDIT.md §7.\n');

  db.close();
  if (failed) process.exit(1);
}

function printSummary() {
  const counts = db.prepare(
    `SELECT translation, COUNT(*) as c FROM verses GROUP BY translation`
  ).all();
  console.log('Current database:');
  for (const row of counts) {
    console.log(`  ${row.translation}: ${row.c} verses`);
  }
  console.log('');
}

seed().catch(err => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});