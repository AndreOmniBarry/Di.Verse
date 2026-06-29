const Database = require('better-sqlite3');
const path = require('path');
const { fetchVerse: claudeFetchVerse } = require('./claude');

const DB_PATH = path.join(__dirname, '../db/bible.db');
let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initSchema();
  }
  return db;
}

function initSchema() {
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
}

// ── Get verse — local DB first, Claude fallback ──
async function getVerse(book, chapter, verse, translation = 'KJV') {
  const db = getDb();

  // 1. Try local database first (KJV always here after seed)
  const row = db.prepare(`
    SELECT text, book, chapter, verse, translation, source
    FROM verses
    WHERE book = ? AND chapter = ? AND verse = ? AND translation = ?
  `).get(book, chapter, verse, translation);

  if (row) {
    return {
      reference: `${row.book} ${row.chapter}:${row.verse}`,
      translation: row.translation,
      text: row.text,
      book: row.book,
      chapter: row.chapter,
      verse: row.verse,
      source: row.source || 'local'
    };
  }

  // 2. Not in local DB — fetch from Claude
  console.log(`[Bible] ${book} ${chapter}:${verse} (${translation}) not in DB — fetching from Claude`);
  const result = await claudeFetchVerse(book, chapter, verse, translation);

  if (result) {
    // Cache it in the DB so next request is instant
    cacheVerse(result, translation);
    return result;
  }

  // 3. Final fallback — return KJV if available
  if (translation !== 'KJV') {
    console.log(`[Bible] Claude fetch failed — falling back to KJV`);
    return getVerse(book, chapter, verse, 'KJV');
  }

  return null;
}

// Cache Claude-fetched verses locally for future use
function cacheVerse(verseData, translation) {
  try {
    const db = getDb();
    const bookNum = getBookNum(verseData.book);
    if (!bookNum) return;

    db.prepare(`
      INSERT OR REPLACE INTO verses (translation, book, book_num, chapter, verse, text, source)
      VALUES (?, ?, ?, ?, ?, ?, 'claude_cache')
    `).run(translation, verseData.book, bookNum, verseData.chapter, verseData.verse, verseData.text);

    console.log(`[Bible] Cached ${verseData.reference} (${translation}) locally`);
  } catch (err) {
    console.error('[Bible] Cache error:', err.message);
  }
}

// Book number lookup
const BOOK_NUMS = {
  'Genesis':1,'Exodus':2,'Leviticus':3,'Numbers':4,'Deuteronomy':5,
  'Joshua':6,'Judges':7,'Ruth':8,'1 Samuel':9,'2 Samuel':10,
  '1 Kings':11,'2 Kings':12,'1 Chronicles':13,'2 Chronicles':14,
  'Ezra':15,'Nehemiah':16,'Esther':17,'Job':18,'Psalms':19,'Proverbs':20,
  'Ecclesiastes':21,'Song of Solomon':22,'Isaiah':23,'Jeremiah':24,
  'Lamentations':25,'Ezekiel':26,'Daniel':27,'Hosea':28,'Joel':29,
  'Amos':30,'Obadiah':31,'Jonah':32,'Micah':33,'Nahum':34,
  'Habakkuk':35,'Zephaniah':36,'Haggai':37,'Zechariah':38,'Malachi':39,
  'Matthew':40,'Mark':41,'Luke':42,'John':43,'Acts':44,'Romans':45,
  '1 Corinthians':46,'2 Corinthians':47,'Galatians':48,'Ephesians':49,
  'Philippians':50,'Colossians':51,'1 Thessalonians':52,'2 Thessalonians':53,
  '1 Timothy':54,'2 Timothy':55,'Titus':56,'Philemon':57,'Hebrews':58,
  'James':59,'1 Peter':60,'2 Peter':61,'1 John':62,'2 John':63,
  '3 John':64,'Jude':65,'Revelation':66
};

function getBookNum(book) {
  return BOOK_NUMS[book] || null;
}

function searchVerses(query, translation = 'KJV', limit = 10) {
  const db = getDb();
  return db.prepare(`
    SELECT book, chapter, verse, text, translation
    FROM verses
    WHERE translation = ? AND text LIKE ?
    LIMIT ?
  `).all(translation, `%${query}%`, limit);
}

module.exports = { getDb, getVerse, searchVerses, getBookNum };