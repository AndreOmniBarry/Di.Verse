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

test('a reference that doesn\'t exist gets the closest verses offered, once, with no red error', async () => {
  const ws = new WebSocket(`ws://localhost:${PORT}?type=operator`);
  await new Promise(r => ws.on('open', r));
  const pushed = [];
  ws.on('message', m => { const msg = JSON.parse(m); if (msg.action !== 'STATE') pushed.push(msg); });
  const d = await (await fetch(base + '/api/detect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Jude chapter 2 verse 1' }) })).json();
  await new Promise(r => setTimeout(r, 200));
  ws.close();
  assert.strictEqual(d.type, 'implicit');
  assert.strictEqual(d.source, 'nearest');
  assert.match(d.notice, /Jude only has 1 chapter/);
  assert.ok(d.candidates.length >= 1 && d.candidates.every(c => c.book === 'Jude' && c.chapter === 1));
  assert.strictEqual(pushed.length, 0);
  // Matthew 11 ends at verse 30: the likeliest mishearings first
  const m = await (await fetch(base + '/api/detect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Matthew 11:35' }) })).json();
  assert.match(m.notice, /Matthew chapter 11 ends at verse 30/);
  assert.deepStrictEqual(m.candidates.map(c => c.chapter + ':' + c.verse), ['11:25', '11:30', '11:15']);
  // and in the manual box
  const r = await fetch(base + '/api/verse?book=Matthew&chapter=11&verse=35');
  assert.strictEqual(r.status, 422);
  assert.deepStrictEqual((await r.json()).suggestions.map(x => x.reference), ['Matthew 11:25', 'Matthew 11:30', 'Matthew 11:15']);
});

test('several references in one breath: the first is shown, the others queued; "Psalm 11" also offers 1:1', async () => {
  const detect = body => fetch(base + '/api/detect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
  const d = await detect({ text: 'turn to Romans 8:28 and also Philippians 4:13 and Jude 24' });
  assert.strictEqual(d.verseData.reference, 'Romans 8:28');
  assert.deepStrictEqual(d.also.map(v => v.reference), ['Philippians 4:13', 'Jude 1:24']);
  const p = await detect({ text: 'Psalm 11' });
  assert.strictEqual(p.verseData.reference, 'Psalms 11:1');
  assert.ok(p.candidates.some(c => c.chapter === 1 && c.verse === 1));
  const j = await detect({ text: 'John 316' });   // captions running the numbers together
  assert.strictEqual(j.verseData.reference, 'John 3:16');
});

test('spoken MSG and PHILLIPS references preserve translation and verse range', async () => {
  const detect = body => fetch(base + '/api/detect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json());

  const phillips = await detect({
    text: 'Turn to Titus 3:3-11 in J. B. Phillips',
    activeTranslation: 'KJV',
    fast: true,
  });
  assert.strictEqual(phillips.type, 'explicit');
  assert.strictEqual(phillips.reference.translation, 'PHILLIPS');
  assert.strictEqual(phillips.verseData.reference, 'Titus 3:3-11');
  assert.ok(phillips.verseData.translation === 'PHILLIPS' ||
    (phillips.verseData.fallback && phillips.verseData.requestedTranslation === 'PHILLIPS'));

  const msg = await detect({
    text: 'Zephaniah chapter three verses one to five',
    activeTranslation: 'MSG',
    fast: true,
  });
  assert.strictEqual(msg.type, 'explicit');
  assert.strictEqual(msg.reference.translation, 'MSG');
  assert.strictEqual(msg.verseData.reference, 'Zephaniah 3:1-5');
  assert.ok(msg.verseData.translation === 'MSG' ||
    (msg.verseData.fallback && msg.verseData.requestedTranslation === 'MSG'));
});

test('the preacher\'s cues follow what is really on screen, even when another operator page put it there', async () => {
  await fetch(base + '/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'SHOW_VERSE', verse: { reference: 'Esther 8:9', translation: 'KJV', text: 'x', book: 'Esther', chapter: 8, verse: 9 } }) });
  const detect = body => fetch(base + '/api/detect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
  let d = await detect({ text: 'the next one please', fast: true });   // no `current` from this page
  assert.strictEqual(d.type, 'navigate'); assert.strictEqual(d.verseData.reference, 'Esther 8:10');
  d = await detect({ text: 'take it back', fast: true });
  assert.strictEqual(d.verseData.reference, 'Esther 8:8');
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

test('an old page left open in vMix is reported, and vMix is told to reload it', async () => {
  const http = require('http');
  const calls = [];
  const fake = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const fn = u.searchParams.get('Function');
    if (fn) calls.push(`${fn} ${u.searchParams.get('Input')}`);
    res.end('<vmix><inputs><input key="a" number="1" type="Capture" title="Camera"/>' +
      '<input key="b" number="2" type="Browser" title="Browser 192.168.0.133">http://192.168.0.133:3936/projection?overlay=1</input>' +
      '<input key="c" number="3" type="Browser" title="Browser news">https://example.com/</input></inputs><active>1</active></vmix>');
  }).listen(3935);
  const srv = spawn(process.execPath, [path.join(__dirname, '../server.js')], { env: { ...process.env, PORT: '3936', OPENAI_API_KEY: '', GROQ_API_KEY: '', GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '', DIVERSE_NO_BROWSER: '1', DIVERSE_STALE_MS: '300',
    DIVERSE_STATE_FILE: path.join(require('os').tmpdir(), 'diverse-vmix-stale-' + process.pid + '.json'), VMIX_URL: 'http://localhost:3935', VMIX_SQUEEZE_INPUT: '' }, stdio: 'pipe' });
  try {
    for (let i = 0; i < 50; i++) { try { await fetch('http://localhost:3936/api/songs/search'); break; } catch (e) { await new Promise(r => setTimeout(r, 100)); } }
    const op = new WebSocket('ws://localhost:3936?type=operator');
    const notices = [];
    op.on('message', m => { const msg = JSON.parse(m); if (msg.action === 'NOTICE') notices.push(msg.message); });
    await new Promise(r => op.on('open', r));
    const fresh = new WebSocket('ws://localhost:3936?type=projection&overlay=1'); // a current page introduces itself
    await new Promise(r => fresh.on('open', r));
    fresh.send(JSON.stringify({ action: 'CLIENT_INFO', ua: 'Chrome/120', width: 1280, height: 720, overlay: true }));
    const old = new WebSocket('ws://localhost:3936?type=projection'); // an old page doesn't
    await new Promise(r => old.on('open', r));
    await new Promise(r => setTimeout(r, 900));
    old.close(); fresh.close(); op.close();
    assert.strictEqual(notices.filter(n => /OLD Di\.Verse page/.test(n)).length, 1, notices.join(' | '));
    assert.deepStrictEqual(calls, ['BrowserReload 2']);
  } finally { srv.kill(); fake.close(); }
});

test('pages are never cached (vMix kept old copies)', async () => {
  for (const p of ['/projection', '/operator', '/projection/backgrounds.js']) {
    const res = await fetch(base + p);
    assert.strictEqual(res.headers.get('cache-control'), 'no-store', p);
  }
});

test('next / previous verse endpoint', async () => {
  const get = async q => { const r = await fetch(base + '/api/verse/step?' + q); return [r.status, await r.json()]; };
  let [st, v] = await get('book=Romans&chapter=8&verse=39&dir=next');
  assert.strictEqual(st, 200); assert.strictEqual(v.reference, 'Romans 9:1');
  [st, v] = await get('book=rom&chapter=8&verse=28&verseEnd=30&dir=next');
  assert.strictEqual(v.reference, 'Romans 8:31');
  [st, v] = await get('book=Esther&chapter=8&verse=9&dir=prev&unit=chapter');
  assert.strictEqual(v.reference, 'Esther 7:1');
  [st, v] = await get('book=Genesis&chapter=1&verse=1&dir=prev');
  assert.strictEqual(st, 404);
});

test('the preacher says "next verse" / "verse 17" while a verse is on screen', async () => {
  const detect = body => fetch(base + '/api/detect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
  const current = { book: 'Romans', chapter: 8, verse: 28, translation: 'KJV' };
  let d = await detect({ text: 'alright church let us go to the next verse', current, fast: true });
  assert.strictEqual(d.type, 'navigate'); assert.strictEqual(d.verseData.reference, 'Romans 8:29');
  d = await detect({ text: 'take it back', current, fast: true });
  assert.strictEqual(d.verseData.reference, 'Romans 8:27');
  d = await detect({ text: 'look at verse 31', current, fast: true });
  assert.strictEqual(d.verseData.reference, 'Romans 8:31');
  // still being spoken: "verse 3" may become "verse 31", so wait
  d = await detect({ text: 'look at verse 3', current, fast: true, interim: true });
  assert.notStrictEqual(d.type, 'navigate');
  // nothing on screen: no cue
  d = await detect({ text: 'the next verse says', fast: true });
  assert.notStrictEqual(d.type, 'navigate');
  // a named book is a normal reference, not a cue
  d = await detect({ text: 'turn to John 3 verse 16', current, fast: true });
  assert.strictEqual(d.type, 'explicit'); assert.strictEqual(d.verseData.reference, 'John 3:16');
});

test('manual box: words of a verse find it', async () => {
  let r = await (await fetch(base + '/api/search?q=' + encodeURIComponent('i wish above all things that thou mayest prosper'))).json();
  assert.strictEqual(r.best, '3 John 1:2');
  r = await (await fetch(base + '/api/search?q=' + encodeURIComponent('the man Isaac sowed in the land'))).json();
  assert.strictEqual(r.best, 'Genesis 26:12');
  assert.ok(r.results[0].text.startsWith('Then Isaac sowed'));
});

test('a misheard paraphrase in the sermon is shown', async () => {
  const d = await fetch(base + '/api/detect', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'then Isaac souled in that land and received in the same year an hundredfold', fast: true }) }).then(r => r.json());
  assert.strictEqual(d.type, 'explicit'); assert.ok(['quote', 'finder'].includes(d.source)); assert.strictEqual(d.verseData.reference, 'Genesis 26:12');
  const s = await fetch(base + '/api/detect', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'the man Isaac sowed in the land', fast: true }) }).then(r => r.json());
  assert.strictEqual(s.type, 'implicit'); assert.strictEqual(s.candidates[0].book + ' ' + s.candidates[0].chapter + ':' + s.candidates[0].verse, 'Genesis 26:12');
});

test('packaged app: data lives in its own folder; settings save keys without ever sending them back', async () => {
  const os = require('os'), fs = require('fs');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'diverse-data-'));
  const srv = spawn(process.execPath, [path.join(__dirname, '../server.js')], { env: { ...process.env, PORT: '3938', DIVERSE_DATA: data,
    DIVERSE_BUNDLED_DB: path.join(__dirname, '../db/bible.db'), DIVERSE_NO_BROWSER: '1', DIVERSE_STATE_FILE: '', GROQ_API_KEY: '', OPENAI_API_KEY: '', GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '', APIBIBLE_KEY: '', VMIX_URL: '' }, stdio: 'pipe' });
  try {
    for (let i = 0; i < 80; i++) { try { await fetch('http://localhost:3938/api/version'); break; } catch (e) { await new Promise(r => setTimeout(r, 100)); } }
    assert.ok(fs.existsSync(path.join(data, 'db', 'bible.db')), 'Bibles copied on first run');
    assert.ok(fs.existsSync(path.join(data, '.env')), '.env created');
    const v = await (await fetch('http://localhost:3938/api/verse?book=John&chapter=3&verse=16')).json();
    assert.match(v.text, /^For God so loved/);
    const secret = 'gsk_test_1234567890abcdefWXYZ';
    let r = await fetch('http://localhost:3938/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ GROQ_API_KEY: secret, VMIX_URL: 'http://192.168.0.120:8088' }) });
    assert.strictEqual(r.status, 200);
    assert.match(fs.readFileSync(path.join(data, '.env'), 'utf8'), new RegExp('^GROQ_API_KEY=' + secret + '$', 'm'));
    const shown = await (await fetch('http://localhost:3938/api/setup')).text();
    assert.ok(!shown.includes(secret.slice(0, 20)), 'the key itself is never sent back');
    assert.match(shown, /…WXYZ/); assert.match(shown, /192\.168\.0\.120:8088/);
    r = await fetch('http://localhost:3938/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ GROQ_API_KEY: 'a\nINJECTED=1' }) });
    assert.strictEqual(r.status, 400);
  } finally { srv.kill(); fs.rmSync(data, { recursive: true, force: true }); }
});

test('system check lists what a service depends on, each with a state and what to do', async () => {
  const d = await (await fetch(base + '/api/health')).json();
  const names = d.checks.map(c => c.name);
  for (const n of ['Di.Verse', 'Internet', 'Listening backup (Whisper)', 'API.Bible', 'vMix link', 'Screens', 'Bibles on this computer', 'Data folder']) assert.ok(names.includes(n), n);
  for (const c of d.checks) { assert.ok(['ok', 'warn', 'fail', 'off'].includes(c.state), c.name); assert.ok(c.detail, c.name); }
  // the test server has no keys: says so and how to fix it, never shows a key
  assert.strictEqual(d.checks.find(c => c.name === 'Listening backup (Whisper)').state, 'fail');
  assert.match(d.checks.find(c => c.name === 'Bibles on this computer').detail, /KJV/);
  assert.ok(['ok', 'warn', 'fail'].includes(d.worst));
});

test('session report: success rate, missed references word for word, false alarms, sound health and advice', async () => {
  const os = require('os'), fs = require('fs');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'diverse-diag-'));
  const srv = spawn(process.execPath, [path.join(__dirname, '../server.js')], { env: { ...process.env, PORT: '3939', DIVERSE_DATA: data,
    DIVERSE_BUNDLED_DB: path.join(__dirname, '../db/bible.db'), DIVERSE_NO_BROWSER: '1', DIVERSE_STATE_FILE: '', GROQ_API_KEY: '', OPENAI_API_KEY: '', GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '', APIBIBLE_KEY: '' }, stdio: 'pipe' });
  const B = 'http://localhost:3939';
  const post = (u, body) => fetch(B + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
  try {
    for (let i = 0; i < 80; i++) { try { await fetch(B + '/api/version'); break; } catch (e) { await new Promise(r => setTimeout(r, 100)); } }
    await post('/api/detect', { text: 'turn with me to John 3:16', fast: true, via: 'captions' });                 // found
    await post('/api/detect', { text: 'turn with me to John 3:16', fast: true, interim: true });                 // same verse mid-sentence: counted once
    await post('/api/detect', { text: 'let us look at romance 8:28 this morning', fast: true, via: 'captions' }); // misheard book: missed
    await post('/api/detect', { text: 'good morning church', fast: true, via: 'captions' });                      // just talk: not missed
    await post('/api/detect', { text: 'Matthew 11:35', fast: true, via: 'whisper' });                            // doesn't exist: nearest
    const v = r => ({ reference: r, translation: 'KJV', text: 'x' });
    await post('/api/push', { action: 'SHOW_VERSE', verse: v('John 3:16'), why: 'auto', listening: true, detected: true });
    await post('/api/push', { action: 'SHOW_VERSE', verse: v('Romans 8:28'), why: 'manual', listening: true });
    await post('/api/push', { action: 'SHOW_VERSE', verse: v('Psalms 23:1'), why: 'auto', listening: true, detected: true });
    await post('/api/push', { action: 'CLEAR' });                                                                  // right after an automatic push
    await post('/api/push', { action: 'SHOW_VERSE', verse: v('Psalms 23:1'), why: 'mode' });                      // not counted
    await post('/api/diag', { kind: 'audio', okSec: 20, whisperSec: 30, speechSec: 50, rebuilds: 1, level: 0.01 });
    const r = await (await fetch(B + '/api/diag/report')).json();
    assert.strictEqual(r.numbers.found, 1);
    assert.strictEqual(r.numbers.fromSpeech, 2);
    assert.strictEqual(r.numbers.typedWhileListening, 1);
    assert.strictEqual(r.numbers.successRate, 67);
    assert.strictEqual(r.numbers.missed, 1);
    assert.match(r.examples.missed[0].text, /romance 8:28/);
    assert.strictEqual(r.numbers.nearest, 1);
    assert.strictEqual(r.numbers.falseAlarms, 1);
    assert.strictEqual(r.examples.falseAlarms[0].ref, 'Psalms 23:1');
    assert.strictEqual(r.numbers.captionsWorking, 40);
    assert.ok(r.advice.some(a => /mic level was low/.test(a)), r.advice.join(' | '));
    assert.ok(r.advice.some(a => /named a book and a number/.test(a)));
    const txt = await (await fetch(B + '/api/diag/export')).text();
    assert.match(txt, /MISSED: "let us look at romance 8:28 this morning"/);
    assert.match(txt, /on screen: John 3:16 \(auto\)/);
    assert.ok(fs.readdirSync(path.join(data, 'logs', 'sessions')).some(f => f.endsWith('.jsonl')), 'kept on the Di.Verse computer');
  } finally { srv.kill(); fs.rmSync(data, { recursive: true, force: true }); }
});


test('Windows audio connector is paired, loopback-only and streams PCM through Whisper', async () => {
  const download = await fetch(base + '/api/audio-bridge/connector.bat');
  assert.strictEqual(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /DiVerse-Windows-Audio-Bridge\.bat/);
  const batch = await download.text();
  assert.match(batch, /listenaddress=127\.0\.0\.1/);
  assert.match(batch, /connectaddress=/);
  assert.match(batch, /Run this file again using Run as administrator/);
  const token = (batch.match(/audio-bridge\?token=([a-f0-9]{48})/) || [])[1];
  assert.ok(token, 'connector includes a one-run pairing token');

  const invalidPage = await fetch(base + '/audio-bridge?token=wrong');
  assert.strictEqual(invalidPage.status, 403);
  const page = await fetch(base + '/audio-bridge?token=' + token);
  assert.strictEqual(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /Start sending audio/);
  assert.strictEqual((await fetch(base + '/audio-bridge/')).status, 404, 'static hosting cannot bypass the pairing route');

  const bad = new WebSocket(`ws://localhost:${PORT}?type=audio-bridge&token=wrong`);
  const badCode = await new Promise(resolve => bad.on('close', resolve));
  assert.strictEqual(badCode, 1008);

  const operator = new WebSocket(`ws://localhost:${PORT}?type=operator`);
  await new Promise(resolve => operator.on('open', resolve));
  const waitFor = action => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for ' + action)), 2500);
    operator.on('message', function handler(raw) {
      const msg = JSON.parse(raw);
      if (msg.action !== action) return;
      clearTimeout(timer);
      operator.off('message', handler);
      resolve(msg);
    });
  });

  const bridge = new WebSocket(`ws://localhost:${PORT}?type=audio-bridge&token=${token}`);
  await new Promise(resolve => bridge.on('open', resolve));
  const connected = waitFor('AUDIO_BRIDGE_STATUS');
  bridge.send(JSON.stringify({ action: 'AUDIO_BRIDGE_INFO', inputLabel: 'Focusrite USB Audio', sampleRate: 48000 }));
  const status = await connected;
  assert.strictEqual(status.connected, true);
  assert.strictEqual(status.inputLabel, 'Focusrite USB Audio');

  const failed = waitFor('AUDIO_BRIDGE_ERROR');
  bridge.send(JSON.stringify({ action: 'AUDIO_CHUNK', sequence: 1, sampleRate: 16000 }));
  bridge.send(Buffer.alloc(32000));
  const error = await failed;
  assert.match(error.message, /No transcription key/);

  bridge.close(); operator.close();
});
