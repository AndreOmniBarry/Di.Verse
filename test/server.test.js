// Boots the real server with no API keys and checks the routes that broke.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

const PORT = 3917;
const base = `http://localhost:${PORT}`;
let server;

test.before(async () => {
  const env = { ...process.env, PORT: String(PORT), OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GROQ_API_KEY: '', GEMINI_API_KEY: '', APIBIBLE_KEY: '', DIVERSE_NO_BROWSER: '1' };
  server = spawn(process.execPath, [path.join(__dirname, '../server.js')], { env, stdio: 'pipe' });
  for (let i = 0; i < 50; i++) {
    try { await fetch(base + '/api/songs/search'); return; } catch (e) { await new Promise(r => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});
test.after(() => server.kill());

test('server boots without an OpenAI key and explains why listening is off', async () => {
  const res = await fetch(base + '/api/transcribe', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: Buffer.alloc(4000).toString('base64') })
  });
  assert.strictEqual(res.status, 503);
  assert.strictEqual((await res.json()).code, 'TRANSCRIBE_KEY_MISSING');
});

test('push forwards theme and font size to the projection screen', async () => {
  const ws = new WebSocket(`ws://localhost:${PORT}?type=projection`);
  await new Promise(r => ws.on('open', r));
  const got = new Promise(r => ws.on('message', m => r(JSON.parse(m))));
  await fetch(base + '/api/push', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'SHOW_VERSE', verse: { reference: 'John 3:16', text: 'x', translation: 'KJV' }, theme: { bg: 'red' }, fontSize: 4 })
  });
  const msg = await got;
  ws.close();
  assert.deepStrictEqual(msg.theme, { bg: 'red' });
  assert.strictEqual(msg.fontSize, 4);
});

test('verse lookup rejects non-numeric chapter', async () => {
  const res = await fetch(base + '/api/verse?book=John&chapter=abc&verse=1');
  assert.strictEqual(res.status, 400);
});

test('editing a song replaces its slides instead of duplicating them', async () => {
  const json = { 'Content-Type': 'application/json' };
  const { id } = await (await fetch(base + '/api/songs', { method: 'POST', headers: json, body: JSON.stringify({ title: 'Test Song' }) })).json();
  const slides = [{ section: 'Verse 1', content: 'a' }, { section: 'Chorus', content: 'b' }];
  for (let i = 0; i < 2; i++) {
    await fetch(base + `/api/songs/${id}`, { method: 'PUT', headers: json, body: JSON.stringify({ title: 'Test Song 2', slides }) });
  }
  const saved = await (await fetch(base + `/api/songs/${id}/slides`)).json();
  assert.strictEqual(saved.length, 2);
  await fetch(base + `/api/songs/${id}`, { method: 'DELETE' });
  assert.strictEqual((await (await fetch(base + `/api/songs/${id}/slides`)).json()).length, 0);
});

test('saving a song that was deleted elsewhere says so (404, not a crash)', async () => {
  const res = await fetch(base + '/api/songs/999999', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'x', slides: [{ content: 'a' }] }) });
  assert.strictEqual(res.status, 404);
  assert.match((await res.json()).error, /no longer exists/);
});

test('an invalid reference is reported once (response only, no WebSocket copy)', async () => {
  const ws = new WebSocket(`ws://localhost:${PORT}?type=operator`);
  await new Promise(r => ws.on('open', r));
  const pushed = [];
  ws.on('message', m => pushed.push(JSON.parse(m)));
  const d = await (await fetch(base + '/api/detect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Jude chapter 2 verse 1' }) })).json();
  await new Promise(r => setTimeout(r, 200));
  ws.close();
  assert.strictEqual(d.type, 'validation_error');
  assert.strictEqual(pushed.length, 0);
});

test('a quoted verse is shown without a reference; a misheard reference gets the quoted verse offered', async () => {
  const post = body => fetch(base + '/api/detect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
  const quoted = await post({ text: 'I wish above all things that thou mayest prosper', fast: true });
  assert.strictEqual(quoted.type, 'explicit');
  assert.strictEqual(quoted.source, 'quote');
  assert.strictEqual(quoted.verseData.reference, '3 John 1:2');

  // "1st John" misheard for "3rd John" while quoting it: corrected
  const misheard = await post({ text: 'I wish above all things that thou mayest prosper. 1st John 1 verse 2', fast: true });
  assert.strictEqual(misheard.verseData.reference, '3 John 1:2');

  // A genuinely different reference: shown as said, the quoted verse offered
  const different = await post({ text: 'I wish above all things that thou mayest prosper. Romans 8 verse 28', fast: true });
  assert.strictEqual(different.verseData.reference, 'Romans 8:28');
  assert.deepStrictEqual(different.candidates.map(c => `${c.book} ${c.chapter}:${c.verse}`), ['3 John 1:2']);
});
