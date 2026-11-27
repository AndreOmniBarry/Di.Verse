// Browser check (v1.12): sermon notes and the virtual set through the real
// Operator and projection pages in Chromium.
//
//   node test/browser/sermon-virtualset.js [screenshot-folder]
//
// Starts its own Di.Verse on a free port with a throwaway copy of db/bible.db.
// Covers: Alt+1..7 sections, a spoken point suggested and approved, the note
// shown over a verse and hidden with H (the verse stays), a title on a
// 10-second timer, notes still there after a page reload, manual notes with a
// validated reference, the Virtual Set preview (draft only, live screens
// unchanged), Take live (profile on the screen, display mode follows), split
// and cinematic layouts at 1080p and 4K, and no JavaScript errors.
const { spawn, execSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const assert = require('assert');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require(execSync('npm root -g').toString().trim() + '/playwright').chromium; }
const ROOT = path.join(__dirname, '..', '..');
const SHOTS = process.argv[2];
const freePort = () => new Promise((resolve, reject) => { const p = net.createServer(); p.once('error', reject); p.listen(0, '127.0.0.1', () => { const n = p.address().port; p.close(() => resolve(n)); }); });
let passed = 0;
const ok = (cond, label) => { assert.ok(cond, label); passed++; console.log('  ✓ ' + label); };
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'diverse-sermon-vset-'));
  fs.mkdirSync(path.join(data, 'db'));
  execSync(`sqlite3 "${path.join(ROOT, 'db', 'bible.db')}" ".backup '${path.join(data, 'db', 'bible.db')}'"`);
  const PORT = await freePort(), base = 'http://localhost:' + PORT;
  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: { ...process.env, PORT: String(PORT), DIVERSE_DATA: data, DIVERSE_NO_BROWSER: '1', NODE_NO_WARNINGS: '1',
    VMIX_URL: '', OPENAI_API_KEY: '', GROQ_API_KEY: '', GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '', APIBIBLE_KEY: '' }, stdio: 'ignore' });
  const b = await chromium.launch();
  const errs = [];
  try {
    for (let i = 0; i < 200; i++) { try { await fetch(base + '/api/version'); break; } catch (e) { await wait(100); } }
    const ctx = await b.newContext({ viewport: { width: 1600, height: 950 } });
    const op = await ctx.newPage(), scr = await ctx.newPage();
    await scr.setViewportSize({ width: 1920, height: 1080 });
    for (const [p, n] of [[op, 'operator'], [scr, 'projection']]) { p.on('pageerror', e => errs.push(n + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/status of (400|422)/.test(m.text())) errs.push(n + ' console: ' + m.text()); }); } // 400 / 422: the refused references above
    await scr.goto(base + '/projection'); await op.goto(base + '/operator'); await wait(1200);
    const vis = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && e.offsetParent !== null; }, sel);
    const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };

    // sections
    for (const [k, v] of [[1, 'live'], [2, 'scripture'], [3, 'sermon'], [4, 'songs'], [5, 'vset'], [6, 'history'], [7, 'settings']]) {
      await op.keyboard.press('Alt+Digit' + k); await wait(150);
      assert.ok(await vis(op, '#view-' + v), v);
    }
    ok(true, 'Alt+1 to Alt+7 open each of the seven sections');
    await op.keyboard.press('Alt+Digit1');
    ok(await vis(op, '#queueContainer') && await vis(op, '#nowPlaying'), 'the program column (on screen, queue, push) stays visible');

    // verse up, then a spoken point
    await op.fill('#quickRef', 'john 3 16'); await op.press('#quickRef', 'Enter'); await wait(1200);
    await op.evaluate(() => sermonHear('Point number one, God has a plan for your life'));
    await wait(800);
    ok(/God has a plan for your life/.test(await op.textContent('#liveNotes')), 'a spoken point appears as a suggestion in Live Control');
    ok((await op.textContent('#sermonCount')).trim() === '1', 'the Sermon Notes badge counts it');
    await shot(op, 'v112-live');
    await op.click('#liveNotes .mini-note button[title="Show now"]'); await wait(900);
    ok(/God has a plan/.test(await scr.textContent('#nlText')) && await scr.evaluate(() => /\bshow\b/.test(document.getElementById('noteLayer').className)), 'Show puts the point on screen');
    ok(/John 3:16/.test(await scr.textContent('#ltRef')), 'the verse is still on screen under the note');
    ok(await vis(op, '#noteOnAir'), 'the program column shows the note is on air');
    await shot(scr, 'v112-note-over-verse');
    await op.evaluate(() => document.activeElement && document.activeElement.blur());
    await op.keyboard.press('h'); await wait(800);
    ok(!/\bshow\b/.test(await scr.evaluate(() => document.getElementById('noteLayer').className)), 'H hides the note');
    ok(/John 3:16/.test(await scr.textContent('#ltRef')) && await scr.evaluate(() => document.getElementById('lowerThird').classList.contains('show')), 'hiding the note leaves the verse on screen');

    // title on a 10 second timer (the timer is checked, not waited for)
    await op.evaluate(() => sermonHear("Today's sermon is titled walking in divine purpose")); await wait(700);
    await op.keyboard.press('Alt+Digit3'); await wait(400);
    const titleBtn = op.locator('.note', { hasText: 'Walking in Divine Purpose' }).locator('button', { hasText: 'Show 10 s' });
    ok(await titleBtn.count() === 1, 'the title suggestion offers Show 10 s');
    await titleBtn.click(); await wait(800);
    ok(/10 s/.test(await op.textContent('#noteOnAirKind')), 'the title shows for 10 seconds');
    ok(/Sermon Title/i.test(await scr.textContent('#nlKind')), 'the screen labels it as the sermon title');
    await op.click('#noteOnAir button'); await wait(500);

    // manual note with a reference, edit, persistence
    await op.selectOption('#noteKind', 'highlight'); await op.fill('#noteText', 'Delay is not denial'); await op.fill('#noteRef', 'Hezekiah 2:3'); await op.click('.add-note .btn-accent'); await wait(600);
    ok(/not a reference that exists/.test(await op.textContent('#alertContainer')), 'a reference that does not exist is refused');
    await op.fill('#noteRef', 'Habakkuk 2:3'); await op.click('.add-note .btn-accent'); await wait(600);
    ok(/Habakkuk 2:3/.test(await op.textContent('#noteList')), 'a manual highlight is added with its reference');
    const point = op.locator('.note', { hasText: 'God has a plan for your life' });
    await point.locator('button', { hasText: 'Edit' }).click();
    await op.keyboard.press('Control+A'); await op.keyboard.type('God has a plan for you');
    await point.locator('button', { hasText: 'Save wording' }).click(); await wait(600);
    ok(/Heard: "Point number one, God has a plan for your life"/.test(await op.textContent('#noteList')), 'edited wording keeps what was heard');
    await op.reload(); await wait(1500);
    await op.keyboard.press('Alt+Digit3'); await wait(500);
    const after = await op.textContent('#noteList');
    ok(/God has a plan for you(?!r)/.test(after) && /Delay is not denial/.test(after) && /Walking in Divine Purpose/.test(after), 'notes are all there after reloading the Operator page');
    ok(await vis(op, '#view-sermon'), 'the page reopens on the last section');
    await shot(op, 'v112-sermon');

    // virtual set: preview is a draft only
    await op.keyboard.press('Alt+Digit5'); await wait(1800);
    await op.locator('.profile', { hasText: 'Teaching: Navy and Gold' }).click(); await wait(300);
    await op.click('text=Sample verse and point'); await wait(900);
    const frame = op.frameLocator('#vsPreview');
    ok(await frame.locator('html').getAttribute('data-vs-bg') === 'navy-gradient', 'the preview shows the draft profile');
    ok(await scr.evaluate(() => !document.documentElement.getAttribute('data-vs')), 'the live screen is unchanged while previewing');
    await shot(op, 'v112-vset');
    await op.click('text=Take live'); await wait(1200);
    ok(await scr.evaluate(() => document.documentElement.getAttribute('data-vs-bg')) === 'navy-gradient', 'Take live applies the profile on the screen');
    ok(await scr.evaluate(() => document.documentElement.getAttribute('data-layout')) === 'cinematic', 'the display mode follows the profile (cinematic)');
    ok(/Cinematic/.test(await op.textContent('#modeBtn')), 'the Operator mode button shows the new mode');
    await shot(scr, 'v112-cinematic-1080');
    // split at 4K
    const s4 = await ctx.newPage(); await s4.setViewportSize({ width: 3840, height: 2160 }); s4.on('pageerror', e => errs.push('4k: ' + e.message));
    await s4.goto(base + '/projection'); await wait(700);
    await op.locator('.profile', { hasText: 'Split: Preacher Left' }).click(); await wait(300);
    await op.click('text=Take live'); await wait(1300);
    const g = await s4.evaluate(() => { const r = document.getElementById('sqWindow').getBoundingClientRect(), p = document.querySelector('.sq-panel').getBoundingClientRect();
      return { l: r.left / innerWidth, w: r.width / innerWidth, panelLeft: p.left / innerWidth }; });
    ok(Math.abs(g.l - 0.025) < 0.002 && Math.abs(g.w - 0.46) < 0.002 && g.panelLeft > 0.5, 'split at 4K: camera window left (2.5%, 46%), scripture right');
    await shot(s4, 'v112-split-4k');
    // history
    await op.keyboard.press('Alt+Digit6'); await wait(800);
    const hist = await op.textContent('#historyBody');
    ok(/John 3:16/.test(hist) && /Point 1/.test(hist), 'Presentation History lists the verse and the note');
    ok(errs.length === 0, 'no JavaScript errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
    console.log(`\n✓ sermon notes and virtual set: ${passed} checks`);
  } finally { await b.close(); srv.kill(); fs.rmSync(data, { recursive: true, force: true }); }
})().catch(err => { console.error('\n✗ ' + err.message); process.exit(1); });
