// AI beta path with Gemini, Groq and Claude all mocked at the fetch level
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Tests set keys themselves and never touch your real ones in .env
for (const k of ['GEMINI_API_KEY', 'GROQ_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_MODEL', 'GROQ_MODEL', 'APIBIBLE_KEY', 'APIBIBLE_IDS']) process.env[k] = '';

const seeded = fs.existsSync(path.join(__dirname, '../db/bible.db'));
const aiVerse = require('../services/aiVerse');
const apiBible = require('../services/apiBible');
const { getVerse, getDb, listTranslations } = require('../services/bibleDb');

const TPT_JOHN_3_16 = 'For here is the way God loved the world—he gave his only, unique Son as a gift. So now everyone who believes in him will never perish but experience everlasting life.';
const realFetch = global.fetch;
let replies;   // provider -> text | {status} | function
const seen = [];

function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }
function reply(provider, url) {
  const r = typeof replies[provider] === 'function' ? replies[provider](url) : replies[provider];
  return r;
}
function mock() {
  global.fetch = async (url, init = {}) => {
    const u = String(url instanceof Request ? url.url : url);
    seen.push(u);
    if (u.includes('generativelanguage') && u.includes('/models?')) {
      return json({ models: [
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      ] });
    }
    if (u.includes('generativelanguage') && u.includes(':generateContent')) {
      const r = reply('gemini', u);
      if (r && r.status) return json({ error: { message: 'quota' } }, r.status);
      const body = JSON.parse(init.body);
      return json({ candidates: [{ content: { parts: [{ text: JSON.stringify(r ? { found: true, text: r } : { found: false, text: '' }) }] },
        groundingMetadata: body.tools ? { webSearchQueries: ['John 3:16 TPT'], groundingChunks: [{ web: { uri: 'https://example.org' } }] } : undefined }] });
    }
    if (u.includes('api.groq.com') && u.endsWith('/models')) return json({ object: 'list', data: [{ id: 'llama-3.3-70b-versatile' }, { id: 'groq/compound' }] });
    if (u.includes('api.groq.com')) {
      const r = reply('groq', init && init.body ? JSON.parse(init.body).model : '');
      if (r && r.status) return json({ error: { message: 'rate limit' } }, r.status);
      return json({ id: 'x', object: 'chat.completion', created: 0, model: 'groq/compound',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(r ? { found: true, text: r } : { found: false, text: '' }), executed_tools: [{ type: 'search' }] } }] });
    }
    if (u.includes('anthropic.com')) {
      const r = reply('claude');
      if (r && r.status) return json({ type: 'error', error: { type: 'rate_limit_error', message: 'x' } }, r.status);
      return json({ id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-4-5', stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: JSON.stringify(r ? { found: true, text: r } : { found: false, text: '' }) }] });
    }
    return new Response('unexpected ' + u, { status: 500 });
  };
}

function clearTpt() { if (seeded) getDb().prepare(`DELETE FROM verses WHERE translation = 'TPT'`).run(); }

test.beforeEach(() => { aiVerse._reset(); apiBible._reset(); seen.length = 0; clearTpt(); mock(); });
test.afterEach(() => { global.fetch = realFetch; for (const k of ['GEMINI_API_KEY', 'GROQ_API_KEY', 'ANTHROPIC_API_KEY']) process.env[k] = ''; clearTpt(); });

test('parseReply copes with prose, footnotes and "not found"', () => {
  assert.strictEqual(aiVerse.parseReply('Sure! {"found": true, "text": "16 For God[a] so loved"}'), 'For God so loved');
  assert.strictEqual(aiVerse.parseReply('{"found": false, "text": ""}'), null);
});

test('two providers with the same wording → verified, saved, then served offline', { skip: !seeded }, async () => {
  process.env.GEMINI_API_KEY = 'g'; process.env.GROQ_API_KEY = 'q';
  replies = { gemini: TPT_JOHN_3_16, groq: TPT_JOHN_3_16.replace('—', ' - ') };
  const v = await getVerse('John', 3, 16, 'TPT');
  assert.strictEqual(v.translation, 'TPT');
  assert.strictEqual(v.verification, 'verified');
  assert.deepStrictEqual(v.aiSources.sort(), ['gemini', 'groq']);
  assert.ok(seen.some(u => u.includes('gemini-3.5-flash:generateContent')), 'picks newest non-lite flash model');

  global.fetch = async () => { throw new Error('offline'); };
  const again = await getVerse('John', 3, 16, 'TPT');
  assert.strictEqual(again.source, 'ai_verified');
  assert.strictEqual(again.text, v.text);
});

test('one web-grounded answer → grounded and saved', { skip: !seeded }, async () => {
  process.env.GEMINI_API_KEY = 'g';
  replies = { gemini: TPT_JOHN_3_16 };
  const v = await getVerse('John', 3, 16, 'TPT');
  assert.strictEqual(v.verification, 'grounded');
  assert.strictEqual(getDb().prepare(`SELECT source FROM verses WHERE translation='TPT'`).get().source, 'ai_grounded');
});

test('single recall, nobody confirms → unverified and NOT saved', { skip: !seeded }, async () => {
  process.env.ANTHROPIC_API_KEY = 'a';
  replies = { claude: TPT_JOHN_3_16 };
  const v = await getVerse('John', 3, 16, 'TPT');
  assert.strictEqual(v.verification, 'unverified');
  assert.match(v.note, /UNVERIFIED/);
  assert.strictEqual(getDb().prepare(`SELECT COUNT(*) c FROM verses WHERE translation='TPT'`).get().c, 0);
});

test('providers disagree → unverified, says they disagreed', { skip: !seeded }, async () => {
  process.env.GEMINI_API_KEY = 'g'; process.env.ANTHROPIC_API_KEY = 'a';
  replies = { gemini: TPT_JOHN_3_16, claude: 'God loved everyone so much that he sent his Son so that whoever trusts him has real life forever.' };
  const v = await getVerse('John', 3, 16, 'TPT');
  assert.strictEqual(v.verification, 'unverified');
  assert.match(v.note, /disagreed/);
});

test('one provider out of quota → the others still answer', { skip: !seeded }, async () => {
  process.env.GEMINI_API_KEY = 'g'; process.env.GROQ_API_KEY = 'q'; process.env.ANTHROPIC_API_KEY = 'a';
  replies = { gemini: { status: 429 }, groq: TPT_JOHN_3_16, claude: TPT_JOHN_3_16 };
  const v = await getVerse('John', 3, 16, 'TPT');
  assert.strictEqual(v.verification, 'verified');
  assert.deepStrictEqual(v.aiSources.sort(), ['claude', 'groq']);
});

test('a whole paragraph instead of one verse is rejected; all fail → KJV with reason', { skip: !seeded }, async () => {
  process.env.GROQ_API_KEY = 'q';
  replies = { groq: (TPT_JOHN_3_16 + ' ').repeat(8) };
  const v = await getVerse('John', 3, 16, 'TPT');
  assert.strictEqual(v.translation, 'KJV');
  assert.strictEqual(v.fallback, true);
  assert.match(v.fallbackReason, /No AI provider could find TPT/);
});

test('with an AI key every listed translation is selectable, marked as AI beta', { skip: !seeded }, async () => {
  process.env.GROQ_API_KEY = 'q';
  const list = await listTranslations();
  const tpt = list.find(t => t.code === 'TPT');
  assert.strictEqual(tpt.available, true);
  assert.strictEqual(tpt.provider, 'ai');
});

test('licensed API.Bible text takes over from saved AI text once a key is added', { skip: !seeded }, async () => {
  process.env.GEMINI_API_KEY = 'g'; process.env.GROQ_API_KEY = 'q';
  replies = { gemini: TPT_JOHN_3_16, groq: TPT_JOHN_3_16 };
  assert.strictEqual((await getVerse('John', 3, 16, 'TPT')).verification, 'verified');   // saved from AI

  process.env.APIBIBLE_KEY = 'k';
  const aiFetch = global.fetch;
  global.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('api.bible') && u.endsWith('/bibles?language=eng')) return json({ data: [{ id: 'tpt-id', abbreviation: 'TPT' }] });
    if (u.includes('api.bible')) return json({ data: { content: 'Licensed TPT wording.' }, meta: {} });
    return aiFetch(url, init);
  };
  try {
    const v = await getVerse('John', 3, 16, 'TPT');
    assert.strictEqual(v.source, 'apibible');
    assert.strictEqual(v.text, 'Licensed TPT wording.');
  } finally { process.env.APIBIBLE_KEY = ''; }
});

test('newest Gemini model has no free quota → falls back to an older one', { skip: !seeded }, async () => {
  process.env.GEMINI_API_KEY = 'g';
  replies = { gemini: url => url.includes('gemini-3.5-flash:') ? { status: 429 } : TPT_JOHN_3_16 };
  const v = await getVerse('John', 3, 16, 'TPT');
  assert.strictEqual(v.translation, 'TPT');
  assert.strictEqual(v.aiSources[0], 'gemini');
  assert.ok(seen.some(u => u.includes('gemini-3.5-flash-lite:generateContent')));
});

test('Groq first model declines → second model asked', { skip: !seeded }, async () => {
  process.env.GROQ_API_KEY = 'q';
  let calls = 0;
  replies = { groq: () => (++calls === 1 ? null : TPT_JOHN_3_16) };
  const v = await getVerse('John', 3, 16, 'TPT');
  assert.strictEqual(v.translation, 'TPT');
  assert.strictEqual(calls, 2);
});

test('Gemini web search times out → asks again without search', { skip: !seeded }, async () => {
  process.env.GEMINI_API_KEY = 'g';
  replies = { gemini: TPT_JOHN_3_16 };
  const mocked = global.fetch;
  global.fetch = async (url, init) => {
    if (String(url).includes(':generateContent') && JSON.parse(init.body).tools) {
      const err = new Error('The operation was aborted due to timeout'); err.name = 'TimeoutError'; throw err;
    }
    return mocked(url, init);
  };
  const v = await getVerse('John', 3, 16, 'TPT');
  assert.strictEqual(v.translation, 'TPT');
  assert.strictEqual(v.verification, 'unverified');   // recall only, one source
});

test('Gemini model list too slow → known model names are tried', { skip: !seeded }, async () => {
  process.env.GEMINI_API_KEY = 'g';
  replies = { gemini: url => url.includes('gemini-3.8-flash:') ? { status: 404 } : TPT_JOHN_3_16 };
  const mocked = global.fetch;
  global.fetch = async (url, init) => {
    if (String(url).includes('/models?')) { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; }
    return mocked(url, init);
  };
  const v = await getVerse('John', 3, 16, 'TPT');
  assert.strictEqual(v.translation, 'TPT');
  assert.ok(seen.some(u => u.includes('gemini-3.5-flash:generateContent')), 'moved past the missing model');
});

test('two Groq models with the same wording → verified on their own', { skip: !seeded }, async () => {
  process.env.GROQ_API_KEY = 'q';
  replies = { groq: TPT_JOHN_3_16 };
  const v = await getVerse('John', 3, 16, 'TPT');
  assert.strictEqual(v.verification, 'verified');
  assert.match(v.note, /compound \+ llama-3.3-70b-versatile|llama-3.3-70b-versatile \+ compound/);
});

test('two Groq models disagree (e.g. one gives KJV wording) → unverified', { skip: !seeded }, async () => {
  process.env.GROQ_API_KEY = 'q';
  replies = { groq: model => model === 'groq/compound' ? TPT_JOHN_3_16
    : 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish.' };
  const v = await getVerse('John', 3, 16, 'TPT');
  assert.strictEqual(v.verification, 'unverified');
  assert.match(v.note, /sources disagreed/);
});
