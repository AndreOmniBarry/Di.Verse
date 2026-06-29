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

async function seed() {
  console.log('\n========================================');
  console.log('  Di.Verse — Bible Database Seeder');
  console.log('========================================\n');

  // Check if already seeded
  const existing = db.prepare(`SELECT COUNT(*) as c FROM verses WHERE translation = 'KJV'`).get();
  if (existing.c > 30000 && !process.argv.includes('--force')) {
    console.log(`✅ KJV already seeded (${existing.c} verses). Use --force to reseed.\n`);
    printSummary();
    process.exit(0);
  }

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

  console.log('\n========================================');
  console.log('  Seeding Complete');
  console.log('========================================\n');
  console.log(`  ✅ KJV: ${totalVerses} verses seeded from GitHub`);
  console.log(`  ✅ Bible structure: ${structureRows.length} chapter records`);
  console.log('\n  All other translations (NKJV, AMP, AMPC, TPT, MSG, GNT, TLB etc.)');
  console.log('  are served by Claude in real time and cached locally after first use.');
  console.log('  No extra setup required.\n');

  db.close();
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