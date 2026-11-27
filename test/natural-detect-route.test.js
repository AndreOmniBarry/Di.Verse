// Natural edition requests through the real /api/detect route on a running
// server (disposable database from scripts/run-tests.js: KJV, ASV, YLT, BBE).
// A translation-only request must come back as a translation change for the
// requested edition (the Operator page then re-shows the current passage, its
// range kept: test/browser/translations.js); a reference with an edition must
// load that reference in that edition; sermon talk must not switch anything.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

let server, base;
const freePort = () => new Promise((resolve, reject) => { const p = net.createServer(); p.once('error', reject); p.listen(0, '127.0.0.1', () => { const port = p.address().port; p.close(() => resolve(port)); }); });

test.before(async () => {
  const port = await freePort();
  base = 'http://127.0.0.1:' + port;
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), DIVERSE_NO_BROWSER: '1', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GROQ_API_KEY: '', GEMINI_API_KEY: '', APIBIBLE_KEY: '',
      DIVERSE_STATE_FILE: path.join(require('os').tmpdir(), 'diverse-natural-' + process.pid + '.json') },
    stdio: 'pipe',
  });
  for (let i = 0; i < 300; i++) { try { if ((await fetch(base + '/api/version')).ok) return; } catch (e) {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error('server did not start');
});
test.after(() => server && server.kill());

const detect = (text, activeTranslation = 'KJV', current) => fetch(base + '/api/detect', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text, activeTranslation, fast: true, ...(current ? { current } : { cues: false }) }) }).then(r => r.json());

test('translation-only requests in natural words', async () => {
  const cases = [
    ['Can we have YLT on screen?', 'YLT'], ['Can we read this same passage on ASV?', 'ASV'], ["Let's see that in Young's Literal.", 'YLT'],
    ['Could you put the American Standard Version up?', 'ASV'], ['Can we have this passage in Basic English please', 'BBE'], ['show us the BBE', 'BBE'],
    ['switch over to ASV', 'ASV'], ["Let's go back to King James.", 'KJV'], ['change it back to the King James', 'KJV'], ['read it on YLT', 'YLT'],
    ['Put the American Standard Version on screen.', 'ASV'], ["Can we see this in Young's Literal?", 'YLT'], ['Keep this reference, but show it in the BBE.', 'BBE'],
    ["Let's change to the ASV.", 'ASV'], ['Can we have the same passage in the Bible in Basic English?', 'BBE'],
  ];
  for (const [said, code] of cases) {
    const d = await detect(said, code === 'KJV' ? 'ASV' : 'KJV');
    assert.strictEqual(d.type, 'translation_change', said + ' -> ' + JSON.stringify(d.type));
    assert.strictEqual(d.new_translation, code, said);
  }
});

test('a reference with an edition loads that reference in that edition', async () => {
  for (const [said, ref, code] of [
    ['John 3 16 on ASV', 'John 3:16', 'ASV'], ['turn to Romans 8 28 in Young\'s Literal', 'Romans 8:28', 'YLT'],
    ['can we read Psalm 23 1 in the Bible in Basic English', 'Psalms 23:1', 'BBE'], ['John 3:16 to 18 in the American Standard Version', 'John 3:16-18', 'ASV'],
  ]) {
    const d = await detect(said);
    assert.strictEqual(d.type, 'explicit', said + ' -> ' + d.type);
    assert.strictEqual(d.verseData.reference, ref, said);
    assert.strictEqual(d.verseData.translation, code, said);
    assert.ok(!d.verseData.fallback, said + ' fell back');
  }
});

test('a cue and an edition in one breath: "read the next verse in the YLT"', async () => {
  const current = { book: 'John', chapter: 3, verse: 16, verseEnd: 18, translation: 'KJV' };
  const d = await detect('Read the next verse in the YLT.', 'KJV', current);
  assert.strictEqual(d.type, 'navigate');
  assert.strictEqual(d.verseData.reference, 'John 3:19');          // after the range 16-18
  assert.strictEqual(d.verseData.translation, 'YLT');
  assert.strictEqual(d.new_translation, 'YLT');
  const back = await detect("Let's read the previous verse in the ASV", 'YLT', { book: 'John', chapter: 3, verse: 19, translation: 'YLT' });
  assert.strictEqual(back.verseData.reference, 'John 3:18');
  assert.strictEqual(back.verseData.translation, 'ASV');
  // an edition that isn't installed never moves on under a stand-in: it is reported as the change that can't be made
  const none = await detect('Read the next verse in the NKJV.', 'KJV', current);
  assert.notStrictEqual(none.type, 'navigate');
});

test('sermon talk does not switch editions', async () => {
  for (const said of ['the message of the cross is power', 'his passion for souls was great', 'the voice of the Lord is upon the waters',
    'that was good news for them', 'the sound was amplified', 'King James was a British monarch', 'we went back to the King James era of England']) {
    const d = await detect(said, 'ASV');
    assert.notStrictEqual(d.type, 'translation_change', said + ' switched to ' + d.new_translation);
  }
});
