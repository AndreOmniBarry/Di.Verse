// Browser check for "listening like a person" (Batch 1):
//  · reading through the verse on screen: nothing else replaces it, and the
//    screen follows the reading into the next verses
//  · a book said in one breath and its numbers in the next are joined
//  · an unclear moment is listened to again (Whisper's answer simulated)
//
//   node test/browser/listening.js      (needs Playwright: npm i -g playwright)
const { spawn, execSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const assert = require('assert');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require(execSync('npm root -g').toString().trim() + '/playwright').chromium; }
const ROOT = path.join(__dirname, '..', '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'diverse-listen-'));
fs.mkdirSync(path.join(data, 'db')); fs.copyFileSync(path.join(ROOT, 'db', 'bible.db'), path.join(data, 'db', 'bible.db'));
const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: { ...process.env, PORT: '3983', DIVERSE_DATA: data, DIVERSE_NO_BROWSER: '1', NODE_NO_WARNINGS: '1',
  OPENAI_API_KEY: '', GROQ_API_KEY: '', GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '', APIBIBLE_KEY: '' }, stdio: 'ignore' });
const results = [];

(async () => {
  for (let i = 0; i < 80; i++) { try { await fetch('http://localhost:3983/api/version'); break; } catch (e) { await new Promise(r => setTimeout(r, 100)); } }
  const b = await chromium.launch();
  const scr = await b.newPage(); const shown = [];
  await scr.exposeFunction('seen', r => shown.push(r));
  await scr.goto('http://localhost:3983/projection'); await scr.waitForTimeout(300);
  await scr.evaluate(() => { new MutationObserver(() => { ['ltRef', 'sqRef', 'fsRef'].forEach(id => { const t = document.getElementById(id).textContent; if (t && t !== window.__l) { window.__l = t; window.seen(t); } }); }).observe(document.body, { subtree: true, childList: true, characterData: true }); });
  const op = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; op.on('pageerror', e => errs.push(e.message));
  // Whisper, simulated: the second listen hears the reference clearly
  await op.route('**/api/transcribe', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ text: 'turn with me to Romans 8:28', provider: 'groq' }) }));
  await op.goto('http://localhost:3983/operator'); await op.waitForTimeout(800);
  await op.evaluate(() => { isListening = true; whisperReady = true; });
  let utt = 100;
  const final = t => op.evaluate(([t, u]) => { appendTranscription(t); transcriptionContext.push(t); if (transcriptionContext.length > 3) transcriptionContext.shift();
    return detectScripture(t, transcriptionContext.slice(0, -1).join(' '), activeTranslation, sessionId, true, { utt: u, via: 'captions' }); }, [t, utt++]);
  const interim = t => op.evaluate(([t, u]) => detectScripture(t.split(/\s+/).slice(-14).join(' '), '', activeTranslation, sessionId, true, { interim: true, utt: u }), [t, utt]);
  const step = async (label, want) => { await op.waitForTimeout(700); const now = shown[shown.length - 1] || '(none)'; console.log(label.padEnd(60), '→', now); results.push([label, now, want]); };

  console.log('— Reading through —');
  await op.fill('#quickRef', 'mark 9 9'); await op.press('#quickRef', 'Enter'); await step('operator shows Mark 9:9', 'Mark 9:9');
  await interim('and as they came down from the mountain he charged them'); await step('reading it aloud (mid-sentence)', 'Mark 9:9');
  await final('and as they came down from the mountain Jesus charged them saying tell the vision to no man'); await step('reading with Matthew 17:9\'s wording', 'Mark 9:9');
  await final('till the son of man were risen from the dead'); await step('finishing the verse', 'Mark 9:9');
  await final('and they kept that saying with themselves questioning one with another'); await step('reading on into verse 10', 'Mark 9:10');
  await final('and they asked him saying why say the scribes that Elias must first come'); await step('…and verse 11', 'Mark 9:11');
  await final('so church Jesus wanted them to wait'); await step('back to preaching', 'Mark 9:11');

  console.log('— Book now, numbers next —');
  await final('let us turn with me to the book of Romans'); await step('"let us turn with me to the book of Romans"', 'Mark 9:11');
  await final('chapter eight verse twenty eight'); await step('"chapter eight verse twenty eight"', 'Romans 8:28');

  console.log('— Listening again —');
  await op.evaluate(async () => { await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'CLEAR' }) }); });
  await op.waitForTimeout(300);
  // the unclear sentence's audio, just finished (after the screen was cleared)
  await op.evaluate(() => { shownAt = {}; readingUntil = 0; lastChunk = { pcm: new Int16Array(16000), rate: 16000, at: Date.now(), sent: false }; });
  await scr.evaluate(() => { window.__l = ''; }); shown.length = 0;
  await final('turn with me to Romans ate twenty ate'); await step('captions garble the numbers: "Romans ate twenty ate"', 'Romans 8:28');
  const again = await op.evaluate(() => [...document.querySelectorAll('#transcriptionFeed .sys')].map(e => e.textContent).filter(t => /listened again/.test(t)).pop());
  console.log('   transcript:', again);
  results.push(['the second listen is shown in the transcript', again ? 'yes' : 'no', 'yes']);

  await b.close();
  try {
    assert.deepStrictEqual(errs, [], 'page errors');
    for (const [label, now, want] of results) assert.strictEqual(now, want, label);
    console.log('\n✓ listening checks hold');
  } finally { srv.kill(); fs.rmSync(data, { recursive: true, force: true }); }
})().catch(err => { console.error('\n✗ ' + err.message); srv.kill(); process.exit(1); });
