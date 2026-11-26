#!/usr/bin/env node
'use strict';

// Run the project's test files against a throwaway copy of the local Bible DB.
// Some integration tests intentionally delete/add fixture translations; never
// let those operations touch the user's working db/bible.db.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const sourceDb = path.join(root, 'db', 'bible.db');
const tempData = fs.mkdtempSync(path.join(os.tmpdir(), 'diverse-test-data-'));
const tempDbDir = path.join(tempData, 'db');
const tempDb = path.join(tempDbDir, 'bible.db');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || command + ' failed');
  }
  return result.stdout || '';
}

try {
  if (!fs.existsSync(sourceDb)) {
    throw new Error('Local db/bible.db is missing. Restore or seed the Bible database before running tests.');
  }

  fs.mkdirSync(tempDbDir, { recursive: true });

  // sqlite3 .backup is transactionally consistent and includes committed WAL
  // content, unlike copying the database file while the app may be running.
  run('sqlite3', [sourceDb, ".backup '" + tempDb + "'"]);

  // Most tests expect a clean seed-only catalogue. Preserve the four seeded
  // public-domain translations and the chapter structure, but remove all
  // user-imported/licensed translations from this disposable test copy.
  const cleanSql = [
    `CREATE TABLE IF NOT EXISTS translation_meta (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source TEXT,
      licence TEXT,
      coverage TEXT,
      verses INTEGER,
      books INTEGER,
      missing INTEGER,
      installed_at TEXT,
      note TEXT
    );`,
    "DELETE FROM verses WHERE translation NOT IN ('KJV','ASV','YLT','BBE');",
    'DELETE FROM translation_meta;',
    "UPDATE verses SET source='seed' WHERE translation IN ('KJV','ASV','YLT','BBE');",
    'PRAGMA wal_checkpoint(TRUNCATE);',
    'PRAGMA integrity_check;'
  ].join(' ');
  const integrity = run('sqlite3', [tempDb, cleanSql]).trim().split(/\r?\n/).pop();
  if (integrity !== 'ok') throw new Error('Temporary test database integrity check failed: ' + integrity);

  const testDir = path.join(root, 'test');
  const files = fs.readdirSync(testDir)
    .filter(name => name.endsWith('.test.js'))
    .sort()
    .map(name => path.join('test', name));

  if (!files.length) throw new Error('No test/*.test.js files were found.');

  console.log('[Di.Verse tests] Using a disposable database: ' + tempDb);
  console.log('[Di.Verse tests] Live db/bible.db will not be modified.');

  const result = spawnSync(process.execPath,
    ['--test', '--test-concurrency=1', ...files],
    {
      cwd: root,
      env: { ...process.env, DIVERSE_DATA: tempData },
      stdio: 'inherit'
    }
  );

  if (result.error) throw result.error;
  process.exitCode = result.status === null ? 1 : result.status;
} catch (error) {
  console.error('[Di.Verse tests] ' + error.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(tempData, { recursive: true, force: true });
}
