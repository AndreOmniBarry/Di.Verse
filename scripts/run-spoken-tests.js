#!/usr/bin/env node
'use strict';

// Run the spoken-catalogue QA against an isolated copy of the full local Bible
// database. The user's live database is never modified.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const sourceDb = path.join(root, 'db', 'bible.db');
const tempData = fs.mkdtempSync(path.join(os.tmpdir(), 'diverse-spoken-qa-'));
const tempDbDir = path.join(tempData, 'db');
const tempDb = path.join(tempDbDir, 'bible.db');

function run(command, args, options) {
  const result = spawnSync(command, args, Object.assign({ encoding: 'utf8' }, options || {}));
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || command + ' failed');
  }
  return result.stdout || '';
}

try {
  if (!fs.existsSync(sourceDb)) {
    throw new Error('Local db/bible.db is missing. Restore or seed the Bible database before spoken QA.');
  }

  fs.mkdirSync(tempDbDir, { recursive: true });

  // A fresh development/CI seed contains only the four bundled public-domain
  // translations. Run the full-catalogue gate when the local library actually
  // has at least 57 translations; otherwise report an explicit skip.
  const installedCount = Number(run('sqlite3', [sourceDb,
    "SELECT COUNT(DISTINCT translation) FROM verses WHERE translation <> '';"], {}).trim());
  if (!Number.isFinite(installedCount) || installedCount < 57) {
    console.log('[Spoken QA] Skipped full-catalogue check: ' + installedCount + '/57 installed translations found. It will run automatically when the full library is present.');
    process.exitCode = 0;
  } else {
    run('sqlite3', [sourceDb, ".backup '" + tempDb + "'"], {});
    console.log('[Spoken QA] Full local Bible database copied to a disposable test folder (' + installedCount + ' translations).');
    const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'test/spoken-catalogue.test.js'], {
      cwd: root,
      env: Object.assign({}, process.env, {
        DIVERSE_DATA: tempData,
        DIVERSE_SPOKEN_CATALOGUE_QA: '1',
        DIVERSE_NO_BROWSER: '1'
      }),
      stdio: 'inherit'
    });

    if (result.error) throw result.error;
    process.exitCode = result.status === null ? 1 : result.status;
  }
} catch (error) {
  console.error('[Spoken QA] ' + error.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(tempData, { recursive: true, force: true });
}
