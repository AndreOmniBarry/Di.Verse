// Transcription provider choice and failover, with both APIs faked
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');

async function boot(port, env) {
  const proc = spawn(process.execPath, ['--require', path.join(__dirname, 'helpers/mock-transcribe.js'), path.join(__dirname, '../server.js')], {
    env: { ...process.env, OPENAI_API_KEY: '', GROQ_API_KEY: '', ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', APIBIBLE_KEY: '', TRANSCRIBE_PROVIDER: '', DIVERSE_NO_BROWSER: '1', DIVERSE_STATE_FILE: require('path').join(require('os').tmpdir(), 'diverse-test-state-' + process.pid + '.json'), PORT: String(port), ...env },
    stdio: 'pipe',
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://localhost:${port}/api/transcribe/config`); return proc; } catch (e) { await new Promise(r => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
}

async function transcribe(port) {
  const res = await fetch(`http://localhost:${port}/api/transcribe`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: Buffer.alloc(32000).toString('base64'), sampleRate: 16000 }),
  });
  return { status: res.status, body: await res.json() };
}

test('Groq (free) is used first and gets longer chunks', async () => {
  const p = await boot(3921, { GROQ_API_KEY: 'g', OPENAI_API_KEY: 'o', MOCK_GROQ: 'ok', MOCK_OPENAI: 'ok' });
  try {
    const conf = await (await fetch('http://localhost:3921/api/transcribe/config')).json();
    assert.strictEqual(conf.provider, 'groq');
    assert.deepStrictEqual(conf.chunk, { minSeconds: 6, maxSeconds: 12 });
    const r = await transcribe(3921);
    assert.strictEqual(r.body.provider, 'groq');
    assert.match(r.body.text, /groq heard/);
  } finally { p.kill(); }
});

test('Groq quota used up → OpenAI takes over and the operator is told', async () => {
  const p = await boot(3922, { GROQ_API_KEY: 'g', OPENAI_API_KEY: 'o', MOCK_GROQ: '429', MOCK_OPENAI: 'ok' });
  try {
    const r = await transcribe(3922);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.provider, 'openai');
    assert.match(r.body.warning, /Groq free-tier limit reached — .*using OpenAI instead/);
  } finally { p.kill(); }
});

test('OpenAI only, no credit → clear billing message', async () => {
  const p = await boot(3923, { OPENAI_API_KEY: 'o', MOCK_OPENAI: '429q' });
  try {
    const r = await transcribe(3923);
    assert.strictEqual(r.status, 502);
    assert.strictEqual(r.body.code, 'OPENAI_NO_CREDIT');
  } finally { p.kill(); }
});

async function detect(port) {
  const res = await fetch(`http://localhost:${port}/api/detect`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'God loved everybody so much that He sent Jesus to rescue all of us' }),
  });
  return res.json();
}

test('detection runs free on Groq when there is no Anthropic key', async () => {
  const p = await boot(3924, { GROQ_API_KEY: 'g', MOCK_GROQ_CHAT: 'ok' });
  try {
    const d = await detect(3924);
    assert.strictEqual(d.type, 'implicit');
    assert.strictEqual(d.candidates[0].book, 'John');
    assert.strictEqual(d.error, undefined);
  } finally { p.kill(); }
});

test('dead Anthropic key → Groq takes over detection, operator told why', async () => {
  const p = await boot(3925, { GROQ_API_KEY: 'g', ANTHROPIC_API_KEY: 'bad', MOCK_CLAUDE: '401', MOCK_GROQ_CHAT: 'ok' });
  try {
    const d = await detect(3925);
    assert.strictEqual(d.type, 'implicit');
    assert.match(d.warning, /Anthropic API key is invalid.*using Groq/);
  } finally { p.kill(); }
});

test('no AI keys at all → parser-only, no error spam', async () => {
  const p = await boot(3926, {});
  try {
    const d = await detect(3926);
    assert.deepStrictEqual(d, { type: 'none' });
  } finally { p.kill(); }
});
