// Browser regression across the product, with screenshots for the QA record.
//
//   node test/browser/regression.js [screenshot-folder]
//
// Starts its own Di.Verse on a free port with a throwaway copy of db/bible.db
// (run `npm run seed` first). Real Operator, projection and preacher pages
// in Chromium. Covers: lower-third / squeeze / full-screen, verse ranges,
// reference-only lower third, footnote superscripts (scripture only, never
// lyrics), Bible story suggestions, song lyrics, preacher monitor in step,
// presentation clicker keys, duplicate detection, reconnection after a server
// restart, and no JavaScript errors on any page. Speech is fed as text: this
// is not a microphone test.
const { spawn, execSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const assert = require('assert');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require(execSync('npm root -g').toString().trim() + '/playwright').chromium; }
const ROOT = path.join(__dirname, '..', '..');
const SHOTS = process.argv[2];
const freePort = () => new Promise((resolve, reject) => { const p = net.createServer(); p.once('error', reject); p.listen(0, '127.0.0.1', () => { const port = p.address().port; p.close(() => resolve(port)); }); });

let passed = 0;
const ok = (cond, label) => { assert.ok(cond, label); passed++; console.log('  ✓ ' + label); };
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'diverse-regression-'));
  fs.mkdirSync(path.join(data, 'db'));
  execSync(`sqlite3 "${path.join(ROOT, 'db', 'bible.db')}" ".backup '${path.join(data, 'db', 'bible.db')}'"`);
  const PORT = await freePort(), base = 'http://localhost:' + PORT;
  const env = { ...process.env, PORT: String(PORT), DIVERSE_DATA: data, DIVERSE_NO_BROWSER: '1', NODE_NO_WARNINGS: '1', OPENAI_API_KEY: '', GROQ_API_KEY: '', GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '', APIBIBLE_KEY: '' };
  let srv;
  const start = async () => { srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env, stdio: 'ignore' }); for (let i = 0; i < 150; i++) { try { await fetch(base + '/api/translations'); return; } catch (e) { await wait(100); } } throw new Error('server did not start'); };
  const stop = () => new Promise(r => { srv.once('exit', r); srv.kill(); });
  await start();
  const b = await chromium.launch();
  const errs = [];
  const page = async (url, size) => { const p = await b.newPage({ viewport: size || { width: 1280, height: 720 } }); p.on('pageerror', e => errs.push(url + ': ' + e.message)); await p.goto(base + url); await p.waitForTimeout(700); return p; };
  try {
    const scr = await page('/projection');
    const pre = await page('/preacher', { width: 900, height: 600 });
    const op = await page('/operator', { width: 1440, height: 900 });
    const shot = async (p, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name) }); } };
    const proj = () => scr.evaluate(() => {
      const vis = id => { const e = document.getElementById(id); return e && getComputedStyle(e).display !== 'none' && e.offsetParent !== null; };
      const t = id => (document.getElementById(id) || {}).textContent || '';
      return { lt: t('ltRef'), ltText: t('ltText'), sq: t('sqRef'), sqText: t('sqText'), fs: t('fsRef'), fsText: t('fsText'), note: t('refNote'), html: document.body.innerText };
    });
    const pushVerse = (book, ch, v, ve, mode) => op.evaluate(async ([book, ch, v, ve, mode]) => {
      if (mode) setMode(mode, false);
      const d = await (await fetch('/api/verse?book=' + book + '&chapter=' + ch + '&verse=' + v + (ve ? '&verseEnd=' + ve : ''))).json();
      await pushVerse(Object.assign({}, d, { type: 'manual', confidence: 1 }));
    }, [book, ch, v, ve, mode]);

    console.log('— Display modes —');
    await pushVerse('John', 3, 16, null, 'lower-third'); await wait(600);
    let s = await proj();
    ok(/John 3:16/.test(s.lt) && /God so loved/.test(s.ltText), 'lower-third shows John 3:16');
    await shot(scr, 'projection-lower-third.png');
    await pushVerse('John', 3, 16, null, 'squeeze'); await wait(600);
    s = await proj(); ok(/John 3:16/.test(s.sq), 'squeeze shows John 3:16'); await shot(scr, 'projection-squeeze.png');
    await pushVerse('John', 3, 16, null, 'full-screen'); await wait(600);
    s = await proj(); ok(/John 3:16/.test(s.fs), 'full-screen shows John 3:16'); await shot(scr, 'projection-full-screen.png');

    console.log('— Ranges, preacher monitor —');
    await pushVerse('Romans', 8, 28, 30, 'lower-third'); await wait(700);
    s = await proj(); ok(/Romans 8:28-30/.test(s.lt) && /²⁹/.test(s.ltText) && /³⁰/.test(s.ltText), 'a range shows its verse numbers (28-30)');
    const preText = await pre.evaluate(() => document.getElementById('content').innerText);
    ok(/Romans 8:28-30/.test(preText), 'preacher monitor shows the same passage');
    await shot(pre, 'preacher-monitor.png');

    console.log('— Footnote superscripts: scripture only —');
    await op.evaluate(() => pushVerse({ reference: 'Psalms 23:1', translation: 'TST', text: 'Synthetic wording[a] with a note[12].', book: 'Psalms', chapter: 23, verse: 1, type: 'manual', confidence: 1 }));
    await wait(600); s = await proj();
    ok(/wordingᵃ/.test(s.ltText) && /note¹²/.test(s.ltText) && !/\[a\]/.test(s.ltText), 'footnote markers [a] [12] shown as superscripts on scripture');
    await op.evaluate(() => broadcast({ action: 'SHOW_LYRICS', lyrics: { songTitle: 'Test Song', section: 'Verse 1', content: 'Lyric line [a] stays as written', slideNum: 1, totalSlides: 1, displayMode: 'lower-third' } }));
    await wait(600); s = await proj();
    ok(/Lyric line \[a\] stays as written/.test(s.ltText), 'lyrics are never reformatted as footnotes');
    await shot(scr, 'projection-lyrics.png');

    console.log('— Reference only, stories, duplicates —');
    await op.evaluate(() => { isListening = true; queue.length = 0; renderQueue(); });
    await op.evaluate(() => detectScripture('Abraham took the knife to sacrifice Isaac his son on the mountain', '', activeTranslation, sessionId, true, { utt: 501, via: 'captions' }));
    await wait(800);
    const storyIdx = await op.evaluate(() => queue.findIndex(q => q.type === 'story'));
    ok(storyIdx >= 0, 'a Bible story is suggested (Abraham and Isaac)');
    const story = await op.evaluate(i => queue[i].reference, storyIdx);
    ok(/Genesis 22/.test(story), 'story reference is Genesis 22 (' + story + ')');
    await shot(op, 'operator-story-card.png');
    await op.evaluate(i => pushReference(i), storyIdx); await wait(700);
    s = await proj();
    ok(/Scriptural Reference/i.test(s.note) && /Genesis 22/.test(s.note), 'reference-only lower third shown');
    await shot(scr, 'projection-reference-only.png');
    await op.evaluate(() => { queue.length = 0; renderQueue(); });
    for (const u of [601, 602]) await op.evaluate(u => detectScripture('please turn with me to Philippians 4:13', '', activeTranslation, sessionId, true, { utt: u, via: 'captions' }), u);
    await wait(600);
    ok(await op.evaluate(() => queue.filter(q => q.reference === 'Philippians 4:13').length) === 1, 'the same reference heard twice is queued once');

    console.log('— Presentation clicker —');
    await pushVerse('John', 3, 16, null, 'lower-third'); await wait(500);
    await op.evaluate(() => document.activeElement && document.activeElement.blur());
    await op.keyboard.press('PageDown'); await wait(900);
    s = await proj(); ok(/John 3:17/.test(s.lt), 'clicker forward (PageDown) goes to John 3:17');
    await op.keyboard.press('PageUp'); await wait(900);
    s = await proj(); ok(/John 3:16/.test(s.lt), 'clicker back (PageUp) returns to John 3:16');

    console.log('— Reconnection after a server restart —');
    await stop(); await wait(500);
    ok(/Reconnecting/.test(await scr.evaluate(() => document.getElementById('reconnect').style.display === 'block' ? 'Reconnecting' : '')), 'projection shows Reconnecting while the server is down');
    await start(); await wait(3500);
    s = await proj();
    ok(/John 3:16/.test(s.lt), 'after restart the projection shows the same verse again');
    ok(await scr.evaluate(() => document.getElementById('reconnect').style.display !== 'block'), 'reconnected');

    console.log('— Other pages load without errors —');
    for (const u of ['/setup/', '/admin/', '/admin/bibles.html']) { const p = await page(u); await shot(p, 'page' + u.replace(/[\/.]+/g, '-').replace(/-$/, '') + '.png'); await p.close(); }
    await shot(op, 'operator.png');
    ok(errs.length === 0, 'no JavaScript errors on any page' + (errs.length ? ': ' + errs.join(' | ') : ''));
    console.log(`\n${passed} checks passed`);
  } finally {
    await b.close(); await stop().catch(() => {}); fs.rmSync(data, { recursive: true, force: true });
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
