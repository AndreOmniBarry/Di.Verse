// A throwaway Bible database for tests, so the operator's real bible.db is
// never touched. Require this FIRST in a test file: it points DIVERSE_DATA at
// a new temporary folder before anything opens the database.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diverse-test-data-'));
process.env.DIVERSE_DATA = dir;
delete process.env.DIVERSE_BUNDLED_DB;

// Genesis 1-5 and John 3 (verse counts from the KJV): enough for library.store
const CHAPTERS = [['Genesis', 1, 1, 31], ['Genesis', 1, 2, 25], ['Genesis', 1, 3, 24], ['Genesis', 1, 4, 26], ['Genesis', 1, 5, 32], ['John', 43, 3, 36]];

function seed() {
  const db = require('../../services/bibleDb').getDb();
  const s = db.prepare('INSERT OR REPLACE INTO bible_structure (book_num, book, chapter, max_verse) VALUES (?, ?, ?, ?)');
  const v = db.prepare('INSERT INTO verses (translation, book, book_num, chapter, verse, text, source) VALUES (?, ?, ?, ?, ?, ?, ?)');
  db.transaction(() => {
    for (const [book, num, ch, max] of CHAPTERS) {
      s.run(num, book, ch, max);
      for (let i = 1; i <= max; i++) v.run('KJV', book, num, ch, i, `KJV ${book} ${ch}:${i}`, 'seed');
    }
  })();
  return db;
}

// rows for library.store: every verse of the test chapters in translation `code`
function rows(code) {
  const out = [];
  for (const [book, , ch, max] of CHAPTERS) for (let i = 1; i <= max; i++) out.push({ book, chapter: ch, verse: i, text: `${code} ${book} ${ch}:${i}` });
  return out;
}

function cleanup() { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }

module.exports = { dir, seed, rows, cleanup };
