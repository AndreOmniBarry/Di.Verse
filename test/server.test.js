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
  const env = { ...process.env, PORT: String(PORT), OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GROQ_API_KEY: '', GEMINI_API_KEY: '', APIBIBLE_KEY: '', DIVERSE_NO_BROWSER: '1', DIVERSE_STATE_FILE: require('path').join(require('os').tmpdir(), 'diverse-test-state-' + process.pid + '.json') };
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
  ws.on('message', m => { const msg = JSON.parse(m); if (msg.action !== 'STATE') pushed.push(msg); });
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

test('a screen that reconnects gets the current picture back', async () => {
  await fetch(base + '/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'APPLY_BACKGROUND', background: 'crystal-ocean', frame: 'glass' }) });
  await fetch(base + '/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'SHOW_VERSE', verse: { reference: 'Psalms 23:1', text: 'The LORD is my shepherd', translation: 'KJV' } }) });
  const ws = new WebSocket(`ws://localhost:${PORT}?type=projection`);
  const got = [];
  ws.on('message', m => got.push(JSON.parse(m)));
  await new Promise(r => setTimeout(r, 400));
  ws.close();
  assert.deepStrictEqual(got.map(m => m.action), ['APPLY_BACKGROUND', 'SHOW_VERSE']);
  assert.strictEqual(got[1].verse.reference, 'Psalms 23:1');
});

test('a screen reports its browser and errors; the operator is told', async () => {
  const op = new WebSocket(`ws://localhost:${PORT}?type=operator`);
  const notices = [];
  op.on('message', m => { const msg = JSON.parse(m); if (msg.action === 'NOTICE') notices.push(msg.message); });
  await new Promise(r => op.on('open', r));
  const scr = new WebSocket(`ws://localhost:${PORT}?type=projection&overlay=1`);
  await new Promise(r => scr.on('open', r));
  scr.send(JSON.stringify({ action: 'CLIENT_INFO', ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome/75.0.3770.100 vMix/24', width: 1280, height: 720, overlay: true, webgl: false }));
  scr.send(JSON.stringify({ action: 'CLIENT_ERROR', message: 'layout: test failure' }));
  await new Promise(r => setTimeout(r, 300));
  const info = await (await fetch(base + '/api/vmix')).json();
  scr.close(); op.close();
  const screen = info.screens.find(s => s.where.startsWith('vMix'));
  assert.ok(screen, JSON.stringify(info.screens));
  assert.strictEqual(screen.browser, 'Chrome 75');
  assert.strictEqual(screen.size, '1280×720');
  assert.strictEqual(screen.errors, 1);
  assert.ok(notices.some(n => /vMix.*Chrome 75.*layout: test failure/.test(n)), notices.join(' | '));
});

test('an operator cannot send screen reports (projection pages only)', async () => {
  const op = new WebSocket(`ws://localhost:${PORT}?type=operator`);
  await new Promise(r => op.on('open', r));
  op.send(JSON.stringify({ action: 'CLIENT_INFO', ua: 'Chrome/99', width: 1, height: 1 }));
  await new Promise(r => setTimeout(r, 200));
  const info = await (await fetch(base + '/api/vmix')).json();
  op.close();
  assert.ok(!info.screens.some(s => s.browser === 'Chrome 99'));
});

test('squeeze mode switches vMix to the squeeze scene and back to the camera that was live', async () => {
  // Stand-in for vMix's web API on another port
  const http = require('http');
  const calls = [];
  const fake = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.searchParams.get('Function')) calls.push(u.searchParams.get('Function') + ' ' + u.searchParams.get('Input'));
    res.end('<vmix><inputs><input key="a" number="1" type="Capture" title="Camera 1"/><input key="b" number="3" type="Capture" title="Camera 3"/><input key="c" number="5" type="Colour" title="Di.Verse Squeeze"/></inputs><active>3</active></vmix>');
  }).listen(3931);
  const { spawn } = require('child_process');
  const srv = spawn(process.execPath, [path.join(__dirname, '../server.js')], { env: { ...process.env, PORT: '3932', OPENAI_API_KEY: '', GROQ_API_KEY: '', GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '', DIVERSE_NO_BROWSER: '1',
    DIVERSE_STATE_FILE: require('path').join(require('os').tmpdir(), 'diverse-vmix-state-' + process.pid + '.json'), VMIX_URL: 'http://localhost:3931', VMIX_SQUEEZE_INPUT: 'Di.Verse Squeeze' }, stdio: 'pipe' });
  try {
    for (let i = 0; i < 50; i++) { try { await fetch('http://localhost:3932/api/songs/search'); break; } catch (e) { await new Promise(r => setTimeout(r, 100)); } }
    const check = await (await fetch('http://localhost:3932/api/vmix')).json();
    assert.strictEqual(check.reachable, true);
    assert.strictEqual(check.squeezeInputFound, true);
    const push = body => fetch('http://localhost:3932/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await push({ action: 'SHOW_VERSE', verse: { reference: 'John 3:16', text: 'x', translation: 'KJV', displayMode: 'squeeze' } });
    await push({ action: 'SHOW_VERSE', verse: { reference: 'John 3:17', text: 'y', translation: 'KJV', displayMode: 'squeeze' } });
    await push({ action: 'CLEAR' });
    await new Promise(r => setTimeout(r, 400));
    assert.deepStrictEqual(calls, ['Fade Di.Verse Squeeze', 'Fade 3']); // one switch in, back to Camera 3
  } finally { srv.kill(); fake.close(); }
});

test('automatic squeeze: vMix zooms the live camera into the window, then puts it back', async () => {
  const http = require('http');
  const calls = [];
  const fake = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const fn = u.searchParams.get('Function');
    if (fn) calls.push(`${fn} ${u.searchParams.get('Input')}${u.searchParams.has('Value') ? ' ' + u.searchParams.get('Value') : ''}`);
    res.end('<vmix><inputs><input key="a" number="1" type="Capture" title="Blackmagic Design"/><input key="b" number="2" type="Browser" title="Browser 192.168.0.133"/></inputs><active>1</active></vmix>');
  }).listen(3933);
  const { spawn } = require('child_process');
  const srv = spawn(process.execPath, [path.join(__dirname, '../server.js')], { env: { ...process.env, PORT: '3934', OPENAI_API_KEY: '', GROQ_API_KEY: '', GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '', DIVERSE_NO_BROWSER: '1',
    DIVERSE_STATE_FILE: require('path').join(require('os').tmpdir(), 'diverse-vmix-auto-' + process.pid + '.json'), VMIX_URL: 'http://localhost:3933', VMIX_SQUEEZE_INPUT: '' }, stdio: 'pipe' });
  try {
    for (let i = 0; i < 50; i++) { try { await fetch('http://localhost:3934/api/songs/search'); break; } catch (e) { await new Promise(r => setTimeout(r, 100)); } }
    const check = await (await fetch('http://localhost:3934/api/vmix')).json();
    assert.strictEqual(check.mode, 'automatic');
    assert.strictEqual(check.live, '1 Blackmagic Design');
    const push = body => fetch('http://localhost:3934/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await push({ action: 'APPLY_BACKGROUND', background: 'theme', frame: 'glass', size: 'large', camera: '46' });
    await push({ action: 'SHOW_VERSE', verse: { reference: 'Jeremiah 27:13', text: 'x', translation: 'KJV', displayMode: 'squeeze' } });
    await new Promise(r => setTimeout(r, 300));
    // camera 46% → left edge at 3%, top edge at 5% of the frame
    assert.deepStrictEqual(calls, ['SetZoom 1 0.46', 'SetPanX 1 -0.48', 'SetPanY 1 0.44']);
    calls.length = 0;
    await push({ action: 'APPLY_BACKGROUND', background: 'theme', frame: 'glass', size: 'large', camera: '25' }); // resized while up
    await push({ action: 'CLEAR' });
    await new Promise(r => setTimeout(r, 300));
    assert.deepStrictEqual(calls, ['SetZoom 1 0.25', 'SetPanX 1 -0.69', 'SetPanY 1 0.65', 'SetZoom 1 1', 'SetPanX 1 0', 'SetPanY 1 0']);
  } finally { srv.kill(); fake.close(); }
});
