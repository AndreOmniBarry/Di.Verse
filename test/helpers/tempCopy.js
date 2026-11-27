// A disposable data folder holding a consistent copy of the Bible database
// the test run uses (scripts/run-tests.js already points DIVERSE_DATA at a
// throwaway copy; run directly, the repository's db/bible.db is copied). The
// source is only read. Require this FIRST: it sets DIVERSE_DATA for the file.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const source = [process.env.DIVERSE_DATA && path.join(process.env.DIVERSE_DATA, 'db', 'bible.db'), path.join(__dirname, '..', '..', 'db', 'bible.db')]
  .find(p => p && fs.existsSync(p));
if (!source) throw new Error('No bible.db to copy: run `npm run seed` first');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diverse-test-copy-'));
fs.mkdirSync(path.join(dir, 'db'));
execFileSync('sqlite3', [source, `.backup '${path.join(dir, 'db', 'bible.db').replace(/'/g, "''")}'`]);
process.env.DIVERSE_DATA = dir;
delete process.env.DIVERSE_BUNDLED_DB;

function cleanup() { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
module.exports = { dir, source, cleanup };
