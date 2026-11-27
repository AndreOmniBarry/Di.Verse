// Browser check: translations on an Operator page that is already open.
//   1. A translation imported or removed while the page is open shows up /
//      goes away on its own, keeping the selection, without touching the screen.
//   2. A spoken translation change re-shows the verse on screen in the new
//      translation (range kept), reports an unavailable one honestly, and the
//      newest request wins when two overlap.
//
//   node test/browser/translations.js
//
// Starts its own Di.Verse on port 3985 with a throwaway copy of db/bible.db
// (needs ASV, YLT and BBE, which `npm run seed` stores). No API keys, so
// licensed translations (NKJV, TPT, AMP) are unavailable.
const { spawn, execSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const assert = require('assert');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require(execSync('npm root -g').toString().trim() + '/playwright').chromium; }
const ROOT = path.join(__dirname, '..', '..');
const PORT = 3985, base = 'http://localhost:' + PORT;
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'diverse-translations-'));
fs.mkdirSync(path.join(data, 'db')); fs.copyFileSync(path.join(ROOT, 'db', 'bible.db'), path.join(data, 'db', 'bible.db'));
const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: { ...process.env, PORT: String(PORT), DIVERSE_DATA: data, DIVERSE_NO_BROWSER: '1', NODE_NO_WARNINGS: '1',
  OPENAI_API_KEY: '', GROQ_API_KEY: '', GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '', APIBIBLE_KEY: '' }, stdio: 'ignore' });

let passed = 0;
const ok = (cond, label) => { assert.ok(cond, label); passed++; console.log('  ✓ ' + label); };

(async () => {
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/translations'); break; } catch (e) { await new Promise(r => setTimeout(r, 100)); } }
  const b = await chromium.launch();
  const scr = await b.newPage();
  await scr.goto(base + '/projection'); await scr.waitForTimeout(300);
  const screen = async () => { await scr.waitForTimeout(350); return scr.evaluate(() => ({ ref: ltRef.textContent, badge: ltBadge.textContent, text: ltText.textContent })); };

  const op = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; op.on('pageerror', e => errs.push(e.message));
  let listCalls = 0;
  await op.route('**/api/translations', r => { listCalls++; r.continue(); });
  // ASV lookups can be slowed down to make requests overlap
  let slowASV = 0;
  await op.route('**/api/verse?*', async r => {
    if (slowASV && /translation=ASV/.test(r.request().url())) await new Promise(x => setTimeout(x, slowASV));
    r.continue();
  });
  await op.goto(base + '/operator'); await op.waitForTimeout(800);
  const options = () => op.evaluate(() => [...translationSelect.options].filter(o => !o.disabled).map(o => o.value));
  const selected = () => op.evaluate(() => [translationSelect.value, activeTranslation]);
  const focus = () => op.evaluate(() => window.dispatchEvent(new Event('focus')));
  const show = async (book, chapter, verse, verseEnd, tr) => {
    await op.evaluate(async ([book, chapter, verse, verseEnd, tr]) => {
      const d = await (await fetch('/api/verse?book=' + book + '&chapter=' + chapter + '&verse=' + verse + (verseEnd ? '&verseEnd=' + verseEnd : '') + '&translation=' + tr)).json();
      await pushVerse(Object.assign({}, d, { type: 'manual', confidence: 1 }));
    }, [book, chapter, verse, verseEnd, tr]);
    return screen();
  };
  const alerts = () => op.evaluate(() => document.getElementById('alertBox') ? document.getElementById('alertBox').textContent : document.body.innerText);
  // a finished sentence through the real detection route, as listening sends it
  let utt = 100;
  const say = (t) => op.evaluate(([t, u]) => { isListening = true; autoPush = true; return detectScripture(t, '', activeTranslation, sessionId, true, { utt: u, via: 'captions' }); }, [t, utt++]);

  console.log('— Open Operator page picks up imported and removed translations —');
  ok(!(await options()).includes('TST'), 'TST not offered before the import');
  await op.evaluate(() => setTranslation('ASV', false));
  const before = await show('John', 3, 16, null, 'KJV');
  const rows = [];
  for (const [book, ch, n] of [['Genesis', 1, 31], ['Genesis', 2, 25], ['Genesis', 3, 24], ['John', 3, 36]]) for (let v = 1; v <= n; v++) rows.push({ book, chapter: ch, verse: v, text: `TST ${book} ${ch}:${v}` });
  const imp = await fetch(base + '/api/library/import?code=TST&name=Test%20Translation&obtained=test%20fixture%20file&filename=t.json&authorized=true', { method: 'POST', body: JSON.stringify(rows) });
  ok(imp.ok, 'imported TST through the existing import route');
  listCalls = 0;
  await focus();
  await op.waitForTimeout(500);
  ok((await options()).includes('TST'), 'TST appears after the page regains focus');
  ok(listCalls === 1, 'one list request per focus (no duplicate listeners)');
  ok((await selected()).join() === 'ASV,ASV', 'selection (ASV) kept');
  ok(JSON.stringify(await screen()) === JSON.stringify(before), 'screen untouched by the refresh');
  await op.evaluate(() => setTranslation('TST', false));
  await fetch(base + '/api/library/TST', { method: 'DELETE' });
  await op.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await op.waitForTimeout(500);
  ok(!(await options()).includes('TST'), 'TST gone after removal (visibility change)');
  ok((await selected()).join() === 'KJV,KJV', 'removed selection falls back to KJV');
  ok(/TST is no longer available/.test(await alerts()), 'operator told why');
  ok(JSON.stringify(await screen()) === JSON.stringify(before), 'screen still untouched');
  const timers = await op.evaluate(() => window.__translationRefresh === true);
  ok(timers, 'refresh registered once');

  console.log('— Spoken translation switching —');
  let s = await show('John', 3, 16, null, 'KJV');
  ok(s.badge === 'KJV' && /For God so loved/.test(s.text), 'John 3:16 KJV on screen');
  await say('can we have that in the American Standard Version');
  s = await screen();
  ok(s.ref === 'John 3:16' && s.badge === 'ASV', 'translation-only: same verse, now ASV');
  ok(/only begotten Son/.test(s.text) && s.text !== before.text, 'ASV text actually fetched');
  ok((await selected()).join() === 'ASV,ASV', 'dropdown follows');
  ok(await op.evaluate(() => currentVerse.translation === 'ASV' && /ASV/.test(nowPlaying.textContent)), 'Now Playing updated');

  s = await show('John', 3, 16, 18, 'KJV');
  await say("let's read it in Young's Literal");
  s = await screen();
  ok(/John 3:16-18/.test(s.ref) && s.badge === 'YLT' && /¹⁸/.test(s.text), 'range kept (John 3:16-18) in YLT');

  const kept = await screen();
  await say('give us that in the Amplified');
  await op.waitForTimeout(300);
  ok(JSON.stringify(await screen()) === JSON.stringify(kept), 'Amplified unavailable: screen unchanged');
  ok((await selected()).join() === 'YLT,YLT', 'selection unchanged');
  ok(/AMP requested, but it is unavailable/.test(await alerts()), 'reported honestly');
  await say("let's read from the Passion Translation");
  ok((await screen()).badge === 'YLT', 'Passion (TPT) unavailable: never shown as KJV under its name');

  await say('back to the King James');
  s = await screen();
  ok(/John 3:16-18/.test(s.ref) && s.badge === 'KJV', 'back to KJV, range kept');

  console.log('— Reference with a translation —');
  await say('Genesis 4:3 in the ASV');
  s = await screen();
  ok(s.ref === 'Genesis 4:3' && s.badge === 'ASV' && /Jehovah/.test(s.text), 'Genesis 4:3 ASV shown directly');
  ok((await selected()).join() === 'ASV,ASV', 'and ASV carries on');
  await say('Genesis 4:4 TPT');
  s = await screen();
  ok(s.badge !== 'TPT', 'Genesis 4:4 TPT unavailable: nothing labelled TPT (got ' + s.badge + ')');
  ok(/TPT not shown/.test(await op.evaluate(() => document.body.innerText)), 'operator told TPT was not shown');

  console.log('— Overlapping requests —');
  await show('Psalms', 23, 1, null, 'KJV');
  slowASV = 1500;
  const p1 = say('in the American Standard Version');        // slow
  await op.waitForTimeout(150);
  const p2 = say("in Young's Literal");                       // fast, newer
  await Promise.all([p1, p2]);
  await op.waitForTimeout(1800);
  s = await screen();
  ok(s.badge === 'YLT', 'newer YLT request wins over the slower ASV one (got ' + s.badge + ')');
  ok((await selected()).join() === 'YLT,YLT', 'selection is the newer one');
  slowASV = 1500;
  const p3 = say('in the American Standard Version');
  await op.waitForTimeout(200);
  await show('Psalms', 23, 2, null, 'KJV');                   // screen moves on meanwhile
  await p3; await op.waitForTimeout(1800);
  s = await screen();
  ok(s.ref === 'Psalms 23:2' && s.badge === 'KJV', 'a late answer never replaces a screen that moved on');
  slowASV = 0;

  console.log('— Natural requests (examples of how a preacher asks, not fixed commands) —');
  await op.evaluate(() => setTranslation('KJV', false));
  let kjvRange = await show('John', 3, 16, 18, 'KJV');
  ok(/John 3:16-18/.test(kjvRange.ref) && kjvRange.badge === 'KJV', 'John 3:16-18 KJV on screen');
  await say('Can we have YLT on screen?');
  s = await screen();
  ok(/John 3:16-18/.test(s.ref) && s.badge === 'YLT' && /¹⁸/.test(s.text) && s.text !== kjvRange.text, '"Can we have YLT on screen?": same range, YLT text projected');
  await say('Keep this reference, but show it in the American Standard Version.');
  s = await screen();
  ok(/John 3:16-18/.test(s.ref) && s.badge === 'ASV' && /only begotten Son/.test(s.text), '"Keep this reference, but show it in the ASV": range kept, ASV text');
  ok((await selected()).join() === 'ASV,ASV', 'dropdown follows the natural request');
  await say('Can we read this same passage on BBE?');
  s = await screen();
  ok(/John 3:16-18/.test(s.ref) && s.badge === 'BBE', '"Can we read this same passage on BBE?": range kept, BBE');
  await op.evaluate(() => { cuesDone = {}; });
  await say('Read the next verse in the YLT.');
  s = await screen();
  ok(s.ref === 'John 3:19' && s.badge === 'YLT', '"Read the next verse in the YLT": moves on to John 3:19 and changes edition');
  ok((await selected()).join() === 'YLT,YLT', 'and YLT carries on');
  const beforeMissing = await screen();
  await say('Put the New Living Translation on screen.');
  await say('Can we read this same passage in the Message?');
  s = await screen();
  ok(JSON.stringify(s) === JSON.stringify(beforeMissing), 'NLT and MSG (not installed): screen unchanged, never shown under their names');
  ok(!/NLT|MSG/.test(s.badge) && (await selected()).join() === 'YLT,YLT', 'badge and selection unchanged');
  await say('Read the next verse in the NKJV.');
  s = await screen();
  ok(s.badge !== 'NKJV' && s.ref === beforeMissing.ref, '"Read the next verse in the NKJV" (not installed): nothing moves on under a stand-in label');
  await show('John', 3, 16, 18, 'KJV');
  slowASV = 1500;
  const n1 = say('Can we have this passage in the American Standard Version?');   // slow
  await op.waitForTimeout(150);
  const n2 = say("Let's change to the YLT.");                                     // newer
  await Promise.all([n1, n2]); await op.waitForTimeout(1800);
  s = await screen();
  if (!(s.badge === 'YLT' && /John 3:16-18/.test(s.ref))) console.log('   screen:', s.ref, s.badge, '| transcript:', (await op.evaluate(() => [...document.querySelectorAll('#transcriptionFeed div')].slice(-6).map(e => e.textContent).join(' || '))));
  ok(s.badge === 'YLT' && /John 3:16-18/.test(s.ref), 'overlapping natural requests: the newer one (YLT) wins, range kept');
  slowASV = 0;

  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log(`\n${passed} checks passed`);
  await b.close(); srv.kill(); fs.rmSync(data, { recursive: true, force: true });
})().catch(e => { console.error('FAILED:', e.message); srv.kill(); process.exit(1); });
