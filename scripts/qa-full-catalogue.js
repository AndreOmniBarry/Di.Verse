#!/usr/bin/env node
'use strict';

// Full-catalogue QA against YOUR real Bible library, safely.
//
//   node scripts/qa-full-catalogue.js --source "/path/to/bible.db" [--out qa-output] [--min 57]
//
// Installed app on a Mac:  --source "$HOME/Library/Application Support/Di.Verse/db/bible.db"
// Code folder:             --source db/bible.db
//
// What it does:
//   1. Opens --source READ-ONLY and writes a consistent copy (SQLite VACUUM
//      INTO, includes committed WAL changes) into a new temporary folder.
//      The source file is never written to.
//   2. Runs test/full-catalogue-qa.test.js against that copy only.
//   3. Writes, to --out (default ./qa-output):
//        translation-manifest.json / .md  every edition: code, name, coverage,
//                                         counts, sample references, 10 checks
//        voice-test-list.csv              one line per edition: what to say
//      No Bible verse text is written anywhere; only references and short
//      text fingerprints.
//   4. Deletes the temporary copy.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const root = path.resolve(__dirname, '..');
const source = opt('source');
const out = path.resolve(opt('out') || path.join(root, 'qa-output'));
const min = Number(opt('min') || 57);

if (!source) {
  console.error('Usage: node scripts/qa-full-catalogue.js --source "/path/to/bible.db" [--out qa-output] [--min 57]');
  process.exit(2);
}
const src = path.resolve(source);
if (!fs.existsSync(src)) { console.error('[Catalogue QA] Not found: ' + src); process.exit(2); }

const tempData = fs.mkdtempSync(path.join(os.tmpdir(), 'diverse-catalogue-qa-'));
const tempDb = path.join(tempData, 'db', 'bible.db');
fs.mkdirSync(path.dirname(tempDb), { recursive: true });
fs.mkdirSync(out, { recursive: true });

let status = 1;
try {
  const sqlite = require(path.join(root, 'services', 'sqlite'));
  const before = fs.statSync(src).mtimeMs;
  const db = sqlite.open(src, { readonly: true });
  try { db.exec("VACUUM INTO '" + tempDb.replace(/'/g, "''") + "'"); } finally { db.close(); }
  if (fs.statSync(src).mtimeMs !== before) throw new Error('the source database changed while it was being copied; close Di.Verse and run again');
  console.log('[Catalogue QA] Read-only copy of ' + src + ' made in a temporary folder; the original is not modified.');

  const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'test/full-catalogue-qa.test.js'], {
    cwd: root,
    env: { ...process.env, DIVERSE_DATA: tempData, DIVERSE_FULL_CATALOGUE_QA: '1', DIVERSE_QA_OUT: out, DIVERSE_QA_MIN: String(min),
      DIVERSE_NO_BROWSER: '1', GROQ_API_KEY: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', APIBIBLE_KEY: '' },
    stdio: 'inherit',
  });
  status = r.status === null ? 1 : r.status;
  console.log('[Catalogue QA] ' + (status === 0 ? 'PASSED' : 'FAILED') + '. Results: ' + path.join(out, 'translation-manifest.md'));
} catch (e) {
  console.error('[Catalogue QA] ' + e.message);
} finally {
  fs.rmSync(tempData, { recursive: true, force: true });
}
process.exit(status);
