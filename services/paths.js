// Where Di.Verse keeps your things: keys (.env), Bibles, songs, screen state.
//
// Run from the code folder (npm start): next to the code, as always.
// Packaged app: the launcher sets DIVERSE_DATA to a folder outside the app
// (Mac: ~/Library/Application Support/Di.Verse, Windows: %APPDATA%\Di.Verse),
// so installing a new version never touches them. On the first run the Bibles
// shipped inside the app (DIVERSE_BUNDLED_DB) are copied there.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = process.env.DIVERSE_DATA ? path.resolve(process.env.DIVERSE_DATA) : ROOT;
const DB_DIR = path.join(DATA, 'db');

const paths = {
  ROOT,
  DATA,
  DB_DIR,
  ENV_FILE: path.join(DATA, '.env'),
  BIBLE_DB: path.join(DB_DIR, 'bible.db'),
  SONGS_DB: path.join(DB_DIR, 'songs.db'),
  STATE_FILE: process.env.DIVERSE_STATE_FILE || path.join(DB_DIR, 'screen-state.json'),
  LOG_DIR: path.join(DATA, 'logs'),
  packaged: Boolean(process.env.DIVERSE_DATA),
};

if (paths.packaged) {
  for (const d of [DATA, DB_DIR, paths.LOG_DIR]) fs.mkdirSync(d, { recursive: true });
  const shipped = process.env.DIVERSE_BUNDLED_DB;
  if (shipped && !fs.existsSync(paths.BIBLE_DB) && fs.existsSync(shipped)) {
    fs.copyFileSync(shipped, paths.BIBLE_DB);
    console.log('[Di.Verse] First run: Bibles copied to ' + DB_DIR);
  }
  const example = path.join(ROOT, '.env.example');
  if (!fs.existsSync(paths.ENV_FILE) && fs.existsSync(example)) fs.copyFileSync(example, paths.ENV_FILE);
}

module.exports = paths;
