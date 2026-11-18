// Browser check: an older listening result must never replace a newer screen.
// Replays the live-test sequence from 18 Nov 2026 (Hebrews 4:15 overwriting
// Genesis) through the Operator page's own code, plus the race cases.
//
//   node test/browser/screen-guard.js      (needs Playwright: npm i -g playwright)
//
// Starts its own Di.Verse on port 3981 with a throwaway data folder.
const { spawn, execSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const assert = require('assert');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require(execSync('npm root -g').toString().trim() + '/playwright').chromium; }
const ROOT = path.join(__dirname, '..', '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'diverse-guard-'));
fs.mkdirSync(path.join(data, 'db')); fs.copyFileSync(path.join(ROOT, 'db', 'bible.db'), path.join(data, 'db', 'bible.db'));
const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: { ...process.env, PORT: '3981', DIVERSE_DATA: data, DIVERSE_NO_BROWSER: '1', NODE_NO_WARNINGS: '1',
  OPENAI_API_KEY: '', GROQ_API_KEY: '', GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '', APIBIBLE_KEY: '' }, stdio: 'ignore' });
const expect = [];
(async () => {
  for (let i = 0; i < 80; i++) { try { await fetch('http://localhost:3981/api/version'); break; } catch (e) { await new Promise(r => setTimeout(r, 100)); } }
  const b = await chromium.launch();
  const scr = await b.newPage(); const shown = [];
  await scr.exposeFunction('seen', r => shown.push(r));
  await scr.goto('http://localhost:3981/projection'); await scr.waitForTimeout(300);
  await scr.evaluate(() => { new MutationObserver(() => { ['ltRef','sqRef','fsRef'].forEach(id => { const t = document.getElementById(id).textContent; if (t && t !== window.__l) { window.__l = t; window.seen(t); } }); }).observe(document.body, { subtree: true, childList: true, characterData: true }); });
  const op = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; op.on('pageerror', e => errs.push(e.message));
  await op.goto('http://localhost:3981/operator'); await op.waitForTimeout(800);
  await op.evaluate(() => { isListening = true; });
  // exactly what the page sends: interim = newest 14 words (utt n), final = full sentence with context (utt n)
  const interim = (t, utt) => op.evaluate(([t, utt]) => detectScripture(t.split(/\s+/).slice(-14).join(' '), '', activeTranslation, sessionId, true, { interim: true, utt }), [t, utt]);
  const final = (t, utt) => op.evaluate(([t, utt]) => { appendTranscription(t); transcriptionContext.push(t); if (transcriptionContext.length > 3) transcriptionContext.shift();
    return detectScripture(t, transcriptionContext.slice(0, -1).join(' '), activeTranslation, sessionId, true, { utt, via: 'captions' }); }, [t, utt]);
  const screen = async label => { await op.waitForTimeout(250); const now = shown[shown.length - 1] || '(none)'; console.log(label.padEnd(64), '→ screen:', now); expect.push([label, now]); };
  const heb = 'hallelujah says that for we have not a high priest who is not touched by they are infirmities hips 4:50 which cannot be touched with the feeling of our affirmities both was in all points tempted like as we are yet without saying';

  console.log('— Replay of the screenshot (one long caption sentence) —');
  await interim(heb, 1); await screen('interim: "...high priest...tempted like as we are..."');
  const grow1 = heb + ' and Jacob said I will not let you go unless you bless me';
  await interim(grow1, 1); await screen('interim grows: "...and Jacob said I will not let you go..."');
  const grow2 = grow1 + ' that is seeing the Book of Genesis 32:36';
  await interim(grow2, 1); await screen('interim grows: "...the Book of Genesis 32:36" (doesn\'t exist)');
  await final(grow2, 1); await screen('final of that whole sentence arrives');
  await interim('in the Book of Genesis 32:32 it says therefore', 2); await final('in the Book of Genesis 32:32 it says therefore', 2);
  await screen('"in the Book of Genesis 32:32 it says therefore"');
  console.log('   queue top:', await op.evaluate(() => queue.slice(0, 4).map(q => q.reference + (q.type === 'implicit' ? '?' : '')).join(', ')));
  await final('let me go for the day breaketh and he said I will not let thee go except thou bless me', 3);
  await screen('preacher quotes Genesis 32:26 exactly');
  await final('and Jabez prayed that the Lord would enlarge his coast and Hannah cried unto the Lord', 4);
  await screen('"...Jabez...Hannah cried unto the Lord" (suggestions)');
  await final('for we have not an high priest which cannot be touched with the feeling of our infirmities', 5);
  await screen('Hebrews 4:15 quoted again 1 min later (shown recently)');
  console.log('   transcript note:', await op.evaluate(() => [...document.querySelectorAll('#transcriptionFeed .sys')].map(e => e.textContent).filter(t => /Hebrews/.test(t)).pop()));

  console.log('— Race: a late answer about older words —');
  await op.evaluate(async () => {
    const heardAt = Date.now();
    await new Promise(r => setTimeout(r, 50));
    await quickGo.call(null, (document.getElementById('quickRef').value = 'rom 8 28'));   // operator pushes a newer verse
    const d = await fetch('/api/detect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'turn to John 3:16', fast: true }) }).then(r => r.json());
    await handleDetection(d, { heardAt });   // John 3:16 was heard BEFORE Romans went up
  });
  await screen('late "John 3:16" result after the operator showed Romans 8:28');

  console.log('— A long sentence\'s final repeats references caught mid-sentence —');
  await interim('turn with me to Philippians 4:13', 9); await screen('interim: Philippians 4:13');
  await interim('turn with me to Philippians 4:13 and then read Isaiah 40:31', 9); await screen('interim grows: ...Isaiah 40:31');
  await final('turn with me to Philippians 4:13 and then read Isaiah 40:31 together', 9); await screen('final of the whole sentence');

  console.log('— Explicitly naming a recent verse again brings it back —');
  await op.evaluate(() => { shownAt['Hebrews 4:15'] = Date.now() - 60000; });
  await final('so again Hebrews 4:15 says', 10); await screen('"so again Hebrews 4:15 says"');
  await b.close();
  const want = {
    'final of that whole sentence arrives': 'Hebrews 4:15',
    '"in the Book of Genesis 32:32 it says therefore"': 'Genesis 32:32',
    'preacher quotes Genesis 32:26 exactly': 'Genesis 32:26',
    '"...Jabez...Hannah cried unto the Lord" (suggestions)': 'Genesis 32:26',
    'Hebrews 4:15 quoted again 1 min later (shown recently)': 'Genesis 32:26',
    'late "John 3:16" result after the operator showed Romans 8:28': 'Romans 8:28',
    'interim grows: ...Isaiah 40:31': 'Isaiah 40:31',
    'final of the whole sentence': 'Isaiah 40:31',
    '"so again Hebrews 4:15 says"': 'Hebrews 4:15',
  };
  try {
    assert.deepStrictEqual(errs, [], 'page errors');
    for (const [label, screen] of expect) if (want[label]) assert.strictEqual(screen, want[label], label);
    console.log('\n✓ screen guard holds');
  } finally { srv.kill(); fs.rmSync(data, { recursive: true, force: true }); }
})().catch(err => { console.error('\n✗ ' + err.message); srv.kill(); process.exit(1); });
