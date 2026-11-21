// A translation stored through library.store() (the path every import and
// download uses) must be readable back through every route the operator
// depends on, from a fresh connection and after a server restart.
// Runs on a temporary data folder, never the real bible.db.
const temp = require('./helpers/tempBible');
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawn } = require('child_process');
const sqlite = require('../services/sqlite');
const bibleDb = require('../services/bibleDb');
const library = require('../services/library');

const PORT = 3991;
const base = `http://localhost:${PORT}`;
let server = null;

function start() {
  server = spawn(process.execPath, [path.join(__dirname, '../server.js')], {
    env: { ...process.env, PORT: String(PORT), DIVERSE_DATA: temp.dir, DIVERSE_NO_BROWSER: '1', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GROQ_API_KEY: '', GEMINI_API_KEY: '', APIBIBLE_KEY: '' },
    stdio: 'pipe',
  });
  return (async () => {
    for (let i = 0; i < 60; i++) {
      try { await fetch(base + '/api/translations'); return; } catch (e) { await new Promise(r => setTimeout(r, 100)); }
    }
    throw new Error('server did not start');
  })();
}
function stop() {
  if (!server) return Promise.resolve();
  const s = server; server = null;
  return new Promise(r => { s.on('exit', r); s.kill(); });
}
test.after(async () => { await stop(); temp.cleanup(); });

test('stored verses and translation_meta are written', () => {
  temp.seed();
  const report = library.store('TST', 'Test Translation', temp.rows('TST'), { source: 'test', licence: 'test licence' });
  assert.strictEqual(report.verses, 174);
  const db = bibleDb.getDb();
  assert.strictEqual(db.prepare(`SELECT COUNT(*) AS c FROM verses WHERE translation = 'TST'`).get().c, 174);
  const meta = db.prepare(`SELECT * FROM translation_meta WHERE code = 'TST'`).get();
  assert.strictEqual(meta.name, 'Test Translation');
  assert.strictEqual(meta.verses, 174);
  assert.strictEqual(meta.licence, 'test licence');
});

test('a fresh connection sees the stored translation', async () => {
  bibleDb.closeDb();
  const raw = sqlite.open(bibleDb.DB_PATH, { readonly: true });
  try {
    assert.strictEqual(raw.prepare(`SELECT text FROM verses WHERE translation = 'TST' AND book = 'John' AND chapter = 3 AND verse = 16`).get().text, 'TST John 3:16');
  } finally { raw.close(); }
  const v = await bibleDb.getPassage('John', 3, 16, 18, 'TST');
  assert.strictEqual(v.translation, 'TST');
  assert.ok(!v.fallback);
  assert.match(v.text, /TST John 3:16.*TST John 3:18/);
  bibleDb.closeDb(); // the server opens it next
});

async function checkServer() {
  const list = await (await fetch(base + '/api/translations')).json();
  const t = list.find(x => x.code === 'TST');
  assert.ok(t && t.available && t.provider === 'local', 'listed and available');
  const v = await (await fetch(base + '/api/verse?book=John&chapter=3&verse=16&translation=TST')).json();
  assert.strictEqual(v.text, 'TST John 3:16');
  assert.ok(!v.fallback);
  const r = await (await fetch(base + '/api/verse?book=Genesis&chapter=1&verse=1&verseEnd=3&translation=TST')).json();
  assert.strictEqual(r.translation, 'TST');
  assert.match(r.text, /TST Genesis 1:3/);
}

test('the server lists it and serves its passages', async () => {
  await start();
  await checkServer();
});

test('it is still there after the server restarts', async () => {
  await stop();
  await start();
  await checkServer();
});

test('database health is operator-only data and reports the translation', async () => {
  const h = await (await fetch(base + '/api/db/health')).json(); // loopback = operator laptop
  assert.strictEqual(h.integrity, 'ok');
  assert.ok(h.database.startsWith(temp.dir));
  assert.ok(h.translations.find(x => x.code === 'TST' && x.verses === 174));
});

// From another device on the network (not this laptop), every database route is refused
test('database routes refuse other devices', async (t) => {
  const ip = Object.values(require('os').networkInterfaces()).flat().find(a => a && a.family === 'IPv4' && !a.internal);
  if (!ip) return t.skip('no network address to test from');
  for (const [method, p] of [['GET', '/api/db/health'], ['GET', '/api/db/backups'], ['POST', '/api/db/backups'], ['POST', '/api/db/restore']]) {
    const res = await fetch(`http://${ip.address}:${PORT}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
    assert.strictEqual(res.status, 403, method + ' ' + p);
  }
});
