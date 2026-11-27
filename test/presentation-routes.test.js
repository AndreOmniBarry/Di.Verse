// Sermon notes, virtual set and history through the real server: the note
// layer never clears scripture, a title shows for 10 seconds, references are
// validated, profiles go live with APPLY_PROFILE, and other devices are refused.
const temp = require('./helpers/tempCopy');
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const WebSocket = require('ws');

let base, port, server;
const freePort = () => new Promise((resolve, reject) => { const p = net.createServer(); p.once('error', reject); p.listen(0, '127.0.0.1', () => { const n = p.address().port; p.close(() => resolve(n)); }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
const json = (method, url, body) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async r => ({ status: r.status, body: await r.json() }));

// a screen: collects what the server sends to projection pages
function screen() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}?type=projection`);
    const got = [];
    ws.on('message', m => got.push(JSON.parse(m)));
    ws.on('open', () => setTimeout(() => resolve({ ws, got, last: a => got.filter(m => m.action === a).pop() }), 300));
    ws.on('error', reject);
  });
}

test.before(async () => {
  port = await freePort(); base = `http://localhost:${port}`;
  server = spawn(process.execPath, [path.join(__dirname, '../server.js')], {
    env: { ...process.env, PORT: String(port), DIVERSE_DATA: temp.dir, DIVERSE_NO_BROWSER: '1', VMIX_URL: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GROQ_API_KEY: '', GEMINI_API_KEY: '', APIBIBLE_KEY: '' },
    stdio: 'pipe',
  });
  let out = ''; server.stderr.on('data', d => { out += d; });
  for (let i = 0; i < 300; i++) { try { if ((await fetch(base + '/api/sermon')).ok) return; } catch (e) {} await wait(100); }
  throw new Error('server did not start: ' + out.slice(-800));
});
test.after(async () => { if (server) { server.kill(); await new Promise(r => server.once('exit', r)); } temp.cleanup(); });

const VERSE = { action: 'SHOW_VERSE', verse: { reference: 'John 3:16', translation: 'KJV', book: 'John', chapter: 3, verse: 16, text: 'For God so loved the world', displayMode: 'lower-third' } };

test('a heard point becomes a suggestion with the verse on screen attached', async () => {
  await json('POST', '/api/push', VERSE);
  const r = await json('POST', '/api/sermon/observe', { text: 'Point number one, God so loved you', heardAt: Date.now() });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.notes[0].kind, 'point');
  assert.strictEqual(r.body.notes[0].status, 'suggested');
  assert.deepStrictEqual(r.body.notes[0].refs.map(x => x.kind), ['on-screen']);
  assert.strictEqual((await json('POST', '/api/sermon/observe', {})).status, 400);
});

test('showing and hiding a note never touches the scripture underneath', async () => {
  const scr = await screen();
  await json('POST', '/api/push', VERSE);
  const point = (await json('POST', '/api/sermon/notes', { kind: 'point', number: 2, original: 'Prayer changes things' })).body;
  const shown = await json('POST', `/api/sermon/notes/${point.id}/show`, {});
  assert.strictEqual(shown.body.durationMs, 0, 'a point stays until hidden');
  await wait(200);
  assert.strictEqual(scr.last('SHOW_NOTE').note.text, 'Prayer changes things');
  // a screen that connects now gets the verse and the note
  const late = await screen();
  assert.ok(late.last('SHOW_VERSE') && late.last('SHOW_NOTE'));
  await json('POST', '/api/sermon/hide');
  await wait(200);
  assert.ok(scr.last('HIDE_NOTE'));
  assert.ok(!scr.got.some(m => m.action === 'CLEAR'), 'hiding a note sends no CLEAR');
  const after = await screen();
  assert.strictEqual(after.last('SHOW_VERSE').verse.reference, 'John 3:16', 'the verse is still on screen');
  assert.ok(!after.last('SHOW_NOTE'), 'the note is gone');
  [scr, late, after].forEach(s => s.ws.close());
});

test('a title shows for 10 seconds by default and can be replayed', async () => {
  const scr = await screen();
  const title = (await json('POST', '/api/sermon/notes', { kind: 'title', original: 'Walking in divine purpose' })).body;
  assert.strictEqual((await json('POST', `/api/sermon/notes/${title.id}/show`, {})).body.durationMs, 10000);
  assert.strictEqual((await json('POST', `/api/sermon/notes/${title.id}/show`, { durationMs: 999999999 })).body.durationMs, 600000, 'capped at 10 minutes');
  const again = await json('POST', `/api/sermon/notes/${title.id}/show`, {});
  assert.strictEqual(again.body.note.shown_count, 3);
  await wait(200);
  assert.strictEqual(scr.got.filter(m => m.action === 'SHOW_NOTE').length, 3);
  assert.strictEqual((await json('GET', '/api/sermon')).body.session.title, 'Walking in divine purpose');
  scr.ws.close();
});

test('references must exist; nothing is guessed', async () => {
  const n = (await json('POST', '/api/sermon/notes', { kind: 'highlight', original: 'Delay is not denial' })).body;
  assert.strictEqual((await json('POST', `/api/sermon/notes/${n.id}/refs`, { reference: 'Hezekiah 4:2' })).status, 422);
  assert.strictEqual((await json('POST', `/api/sermon/notes/${n.id}/refs`, { reference: 'Romans 99:1' })).status, 422);
  const ok = await json('POST', `/api/sermon/notes/${n.id}/refs`, { reference: 'Habakkuk 2:3' });
  assert.deepStrictEqual(ok.body.refs.map(r => r.reference), ['Habakkuk 2:3']);
  assert.strictEqual((await json('POST', '/api/sermon/notes', { kind: 'point', original: 'x y', refText: 'Book of Nothing 1:1' })).status, 400);
});

test('editing keeps the original; notes are read back after a refresh', async () => {
  const n = (await json('POST', '/api/sermon/observe', { text: 'The second point is that basically God is really faithful to his promises' })).body.notes[0];
  const edited = await json('PATCH', `/api/sermon/notes/${n.id}`, { display: 'God keeps his promises', status: 'approved' });
  assert.strictEqual(edited.body.original, 'The second point is that basically God is really faithful to his promises');
  const list = (await json('GET', '/api/sermon')).body.notes;
  const back = list.find(x => x.id === n.id);
  assert.strictEqual(back.display, 'God keeps his promises');
  assert.strictEqual(back.status, 'approved');
});

test('Clear removes the note too; a new sermon starts an empty list', async () => {
  const n = (await json('POST', '/api/sermon/notes', { kind: 'highlight', original: 'Grace is enough' })).body;
  await json('POST', `/api/sermon/notes/${n.id}/show`, {});
  await json('POST', '/api/push', { action: 'CLEAR' });
  const s = await screen();
  assert.ok(!s.last('SHOW_NOTE') && !s.last('SHOW_VERSE'));
  s.ws.close();
  const fresh = await json('POST', '/api/sermon/session', { title: 'Second service' });
  assert.deepStrictEqual(fresh.body.notes.map(x => x.kind), ['title']);
});

test('virtual set: take a profile live, keep it for new screens, refuse bad edits', async () => {
  const scr = await screen();
  const d = (await json('GET', '/api/vset')).body;
  assert.ok(d.layouts.includes('split-left') && d.layouts.includes('cinematic'));
  const split = d.profiles.find(p => p.name === 'Split: Preacher Left');
  assert.strictEqual((await json('POST', '/api/vset/live', { id: split.id })).status, 200);
  await wait(200);
  assert.strictEqual(scr.last('APPLY_PROFILE').profile.settings.layout, 'split-right');
  const late = await screen();
  assert.strictEqual(late.last('APPLY_PROFILE').profile.id, split.id, 'a screen opened later gets the live profile');
  const edit = await json('PUT', `/api/vset/profiles/${split.id}`, { settings: { ...split.settings, splitRatio: 60, textScale: 50 } });
  assert.strictEqual(edit.body.settings.textScale, 1.6);
  await wait(200);
  assert.strictEqual(scr.last('APPLY_PROFILE').profile.settings.splitRatio, 60, 'editing the live profile re-applies it');
  assert.strictEqual((await json('POST', '/api/vset/profiles', { name: 'Di.Verse Classic', settings: {} })).status, 409);
  assert.strictEqual((await json('DELETE', `/api/vset/profiles/${split.id}`)).status, 409, 'the live profile cannot be deleted');
  assert.strictEqual((await json('POST', '/api/vset/live', { id: 99999 })).status, 404);
  [scr, late].forEach(s => s.ws.close());
});

test('presentation history records scripture and notes', async () => {
  await json('POST', '/api/push', { ...VERSE, verse: { ...VERSE.verse, reference: 'Psalms 23:1', book: 'Psalms', chapter: 23, verse: 1 } });
  const items = (await json('GET', '/api/history')).body.items;
  assert.strictEqual(items[0].label, 'Psalms 23:1 KJV');
  assert.ok(items.some(i => i.kind === 'note' && /Prayer changes things/.test(i.label)));
});

test('the operator page keeps every control, adds the sections and has no emoji', async () => {
  const op = await (await fetch(base + '/operator')).text();
  for (const id of ['view-live', 'view-scripture', 'view-sermon', 'view-songs', 'view-vset', 'view-history', 'view-settings', 'noteOnAir', 'vsPreview',
    'quickRef', 'translationSelect', 'modeBtn', 'cameraSelect', 'autoPushToggle', 'whisperToggle', 'themeSelect', 'bgSelect', 'frameSelect', 'sizeSelect',
    'transcriptionFeed', 'audioInputSelect', 'bookInput', 'chapterInput', 'verseInput', 'songSearch', 'songList', 'slideList', 'followToggle',
    'nowPlaying', 'queueContainer', 'alertContainer', 'listenBtn', 'wsStatus', 'apiStatus', 'versionBadge'])
    assert.ok(op.includes(`id="${id}"`), id);
  assert.ok(!/[\u{1F300}-\u{1FAFF}✅❌⚠⚪]/u.test(op), 'no emoji');
  assert.strictEqual((await fetch(base + '/assets/icons.svg')).status, 200);
});

test('other devices cannot write sermon notes or profiles', async (t) => {
  const ip = Object.values(require('os').networkInterfaces()).flat().find(a => a && a.family === 'IPv4' && !a.internal);
  if (!ip) return t.skip('no network address to test from');
  for (const [method, p] of [['POST', '/api/sermon/notes'], ['POST', '/api/sermon/observe'], ['POST', '/api/sermon/hide'], ['POST', '/api/vset/live'], ['POST', '/api/vset/profiles'], ['DELETE', '/api/sermon/notes/1']]) {
    const r = await fetch(`http://${ip.address}:${port}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
    assert.strictEqual(r.status, 403, method + ' ' + p);
  }
  assert.strictEqual((await fetch(`http://${ip.address}:${port}/api/sermon`)).status, 200, 'reads stay open, like the rest of the API');
});

test('vMix: split layouts place the camera opposite the scripture; notes never move it; Clear restores', async () => {
  const http = require('http');
  const calls = [];
  const fake = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const fn = u.searchParams.get('Function');
    if (fn) calls.push(`${fn} ${u.searchParams.get('Input')}${u.searchParams.has('Value') ? ' ' + u.searchParams.get('Value') : ''}`);
    res.end('<vmix><inputs><input key="a" number="1" type="Capture" title="Camera"/></inputs><active>1</active></vmix>');
  });
  const vport = await freePort(); await new Promise(r => fake.listen(vport, '127.0.0.1', r));
  const sport = await freePort(), sbase = `http://localhost:${sport}`;
  const srv = spawn(process.execPath, [path.join(__dirname, '../server.js')], {
    env: { ...process.env, PORT: String(sport), DIVERSE_DATA: temp.dir, DIVERSE_NO_BROWSER: '1', VMIX_URL: `http://127.0.0.1:${vport}`, VMIX_SQUEEZE_INPUT: '',
      DIVERSE_STATE_FILE: path.join(temp.dir, 'vmix-split-state.json'), OPENAI_API_KEY: '', GROQ_API_KEY: '', GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '' }, stdio: 'pipe' });
  const call = (method, url, body) => fetch(sbase + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(r => r.json());
  try {
    for (let i = 0; i < 300; i++) { try { if ((await fetch(sbase + '/api/vset')).ok) break; } catch (e) {} await wait(100); }
    const p = await call('POST', '/api/vset/profiles', { name: 'Split test 50', settings: { layout: 'split-right', splitRatio: 50 } });
    await call('POST', '/api/vset/live', { id: p.id });
    const verse = mode => call('POST', '/api/push', { ...VERSE, verse: { ...VERSE.verse, displayMode: mode } });
    await verse('split-right'); await wait(300);
    assert.deepStrictEqual(calls.splice(0), ['SetZoom 1 0.46', 'SetPanX 1 -0.49', 'SetPanY 1 0'], 'camera window on the left');
    await verse('split-left'); await wait(300);
    assert.deepStrictEqual(calls.splice(0), ['SetZoom 1 0.46', 'SetPanX 1 0.49', 'SetPanY 1 0'], 'moved to the right without a full-screen flash');
    const n = await call('POST', '/api/sermon/notes', { kind: 'point', number: 1, original: 'Camera stays put' });
    await call('POST', `/api/sermon/notes/${n.id}/show`, {}); await call('POST', '/api/sermon/hide'); await wait(300);
    assert.deepStrictEqual(calls.splice(0), [], 'a sermon note never moves the camera');
    await call('PUT', `/api/vset/profiles/${p.id}`, { settings: { ...p.settings, splitRatio: 60 } }); await wait(300);
    assert.deepStrictEqual(calls.splice(0), ['SetZoom 1 0.56', 'SetPanX 1 0.39', 'SetPanY 1 0'], 'a new split ratio resizes the window');
    await verse('squeeze'); await wait(300);
    assert.deepStrictEqual(calls.splice(0), ['SetZoom 1 0.2', 'SetPanX 1 -0.74', 'SetPanY 1 0.7'], 'Squeeze keeps its own geometry');
    await call('POST', '/api/push', { action: 'CLEAR' }); await wait(300);
    assert.deepStrictEqual(calls.splice(0), ['SetZoom 1 1', 'SetPanX 1 0', 'SetPanY 1 0']);
  } finally { srv.kill(); fake.close(); await new Promise(r => srv.once('exit', r)); }
});
