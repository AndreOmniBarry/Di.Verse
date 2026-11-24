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

const TEST_EDITION_TEXT = 'This is a deliberately fictional test-edition sentence for the John 3:16 fixture.';
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

function clearFixtures() {
  if (!seeded) return;
  getDb().prepare(`DELETE FROM verses WHERE translation IN ('TPT','ZZT')`).run();
  getDb().prepare(`DELETE FROM translation_meta WHERE code = 'TPT'`).run();
  require('../services/bibleDb').invalidateTranslations();
}

test.beforeEach(() => { aiVerse._reset(); apiBible._reset(); seen.length = 0; clearFixtures(); mock(); });
test.afterEach(() => { global.fetch = realFetch; for (const k of ['GEMINI_API_KEY', 'GROQ_API_KEY', 'ANTHROPIC_API_KEY', 'APIBIBLE_KEY']) process.env[k] = ''; clearFixtures(); });

test('parseReply copes with prose, footnotes and "not found"', () => {
  assert.strictEqual(aiVerse.parseReply('Sure! {"found": true, "text": "16 For God[a] so loved"}'), 'For God so loved');
  assert.strictEqual(aiVerse.parseReply('{"found": false, "text": ""}'), null);
});

test('TPT is never fabricated from agreeing AI providers', { skip: !seeded }, async () => {
  process.env.GEMINI_API_KEY = 'g'; process.env.GROQ_API_KEY = 'q';
  replies = { gemini: TEST_EDITION_TEXT, groq: TEST_EDITION_TEXT };
  const v = await getVerse('John', 3, 16, 'TPT');
  assert.strictEqual(v.translation, 'KJV');
  assert.strictEqual(v.fallback, true);
  assert.match(v.fallbackReason, /licensed edition|not downloaded|not stored/i);
  assert.equal(seen.some(u => u.includes('generativelanguage') || u.includes('api.groq.com')), false);
  assert.strictEqual(getDb().prepare(`SELECT COUNT(*) c FROM verses WHERE translation='TPT'`).get().c, 0);
});

test('TPT remains unavailable in the picker when only AI keys are configured', { skip: !seeded }, async () => {
  process.env.GROQ_API_KEY = 'q';
  const list = await listTranslations();
  const tpt = list.find(t => t.code === 'TPT');
  assert.strictEqual(tpt.available, false);
  assert.strictEqual(tpt.provider, 'apibible');
  assert.match(tpt.reason, /authorised TPT file|API.Bible plan/i);
});

test('legacy AI-cached TPT wording never counts as an installed local translation', { skip: !seeded }, async () => {
  const { store } = require('../services/library');
  process.env.GROQ_API_KEY = 'q';
  store('TPT', 'The Passion Translation', [
    { book: 'John', chapter: 3, verse: 16, text: TEST_EDITION_TEXT },
  ], { source: 'import:old-fixture', licence: 'fixture' });
  getDb().prepare(`UPDATE verses SET source='ai_verified' WHERE translation='TPT'`).run();

  const tpt = (await listTranslations()).find(item => item.code === 'TPT');
  assert.strictEqual(tpt.available, false);
  assert.strictEqual(tpt.provider, 'apibible');

  const v = await getVerse('John', 3, 16, 'TPT');
  assert.strictEqual(v.translation, 'KJV');
  assert.strictEqual(v.fallback, true);
  assert.match(v.fallbackReason, /licensed edition|not included/i);
});

test('an authorised local partial TPT import is available for its stored passages', { skip: !seeded }, async () => {
  const { store } = require('../services/library');
  store('TPT', 'The Passion Translation', [
    { book: 'John', chapter: 3, verse: 16, text: 'Authorised local TPT sample text.' },
    { book: 'Psalms', chapter: 23, verse: 1, text: 'Authorised local TPT sample text for Psalm 23.' },
  ], { source: 'import:authorised-user-copy', licence: 'User supplied authorised copy' });

  const list = await listTranslations();
  const tpt = list.find(t => t.code === 'TPT');
  assert.strictEqual(tpt.available, true);
  assert.strictEqual(tpt.provider, 'local');
  assert.match(tpt.coverage, /2 books/);

  const v = await getVerse('John', 3, 16, 'TPT');
  assert.strictEqual(v.source, 'import:authorised-user-copy');
  assert.strictEqual(v.text, 'Authorised local TPT sample text.');
  const missing = await getVerse('Genesis', 1, 1, 'TPT');
  assert.strictEqual(missing.translation, 'KJV');
  assert.match(missing.fallbackReason, /not part of the TPT text/i);
});

test('API.Bible fills TPT passages missing from an authorised partial local import', { skip: !seeded }, async () => {
  const { store } = require('../services/library');
  store('TPT', 'The Passion Translation', [
    { book: 'John', chapter: 3, verse: 16, text: 'Authorised local TPT passage.' },
  ], { source: 'import:authorised-partial', licence: 'User supplied authorised copy' });

  process.env.APIBIBLE_KEY = 'k';
  global.fetch = async url => {
    const u = String(url);
    if (u.includes('/bibles?language=eng')) return json({ data: [{ id: 'tpt-id', abbreviation: 'TPT' }] });
    if (u.includes('/verses/GEN.1.1')) return json({ data: { content: 'API.Bible authorised TPT passage for the missing verse.' }, meta: {} });
    return new Response('unexpected ' + u, { status: 500 });
  };

  const local = await getVerse('John', 3, 16, 'TPT');
  assert.strictEqual(local.source, 'import:authorised-partial');
  assert.strictEqual(local.text, 'Authorised local TPT passage.');

  const remote = await getVerse('Genesis', 1, 1, 'TPT');
  assert.strictEqual(remote.source, 'apibible');
  assert.strictEqual(remote.text, 'API.Bible authorised TPT passage for the missing verse.');
});

test('an empty TPT catalogue record does not block exact API.Bible text when the plan includes it', { skip: !seeded }, async () => {
  const { store } = require('../services/library');
  store('TPT', 'The Passion Translation', [
    { book: 'John', chapter: 3, verse: 16, text: 'temporary placeholder' },
  ], { source: 'import:empty-ghost-fixture', licence: 'fixture' });
  getDb().prepare(`DELETE FROM verses WHERE translation='TPT'`).run();

  process.env.GROQ_API_KEY = 'q';
  process.env.APIBIBLE_KEY = 'k';
  const mocked = global.fetch;
  global.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('api.bible') && u.endsWith('/bibles?language=eng')) {
      return json({ data: [{ id: 'tpt-id', abbreviation: 'TPT' }] });
    }
    if (u.includes('api.bible')) return json({ data: { content: 'Exact publisher-supplied TPT wording.' }, meta: {} });
    return mocked(url, init);
  };
  try {
    const listed = (await listTranslations()).find(item => item.code === 'TPT');
    assert.strictEqual(listed.available, true);
    assert.strictEqual(listed.provider, 'apibible');
    const v = await getVerse('John', 3, 16, 'TPT');
    assert.strictEqual(v.source, 'apibible');
    assert.strictEqual(v.text, 'Exact publisher-supplied TPT wording.');
    assert.equal(seen.some(u => u.includes('generativelanguage') || u.includes('api.groq.com')), false);
  } finally { process.env.APIBIBLE_KEY = ''; }
});

test('unlicensed experimental editions may still use the clearly marked AI beta path', { skip: !seeded }, async () => {
  process.env.GEMINI_API_KEY = 'g'; process.env.GROQ_API_KEY = 'q';
  replies = { gemini: TEST_EDITION_TEXT, groq: TEST_EDITION_TEXT };
  const v = await getVerse('John', 3, 16, 'ZZT');
  assert.strictEqual(v.translation, 'ZZT');
  assert.strictEqual(v.verification, 'verified');
  assert.deepStrictEqual(v.aiSources.sort(), ['gemini', 'groq']);
  assert.ok(seen.some(u => u.includes('gemini-3.5-flash:generateContent')));
});

test('a single AI recall for an experimental edition is not saved', { skip: !seeded }, async () => {
  process.env.ANTHROPIC_API_KEY = 'a';
  replies = { claude: TEST_EDITION_TEXT };
  const v = await getVerse('John', 3, 16, 'ZZT');
  assert.strictEqual(v.translation, 'KJV');
  assert.match(v.fallbackReason, /could not be confirmed \(UNVERIFIED \(claude only\)/);
  assert.strictEqual(getDb().prepare(`SELECT COUNT(*) c FROM verses WHERE translation='ZZT'`).get().c, 0);
});

test('AI providers disagreeing on an experimental edition is reported', { skip: !seeded }, async () => {
  process.env.GEMINI_API_KEY = 'g'; process.env.ANTHROPIC_API_KEY = 'a';
  replies = { gemini: TEST_EDITION_TEXT, claude: 'A different sentence from the second test source.' };
  const v = await getVerse('John', 3, 16, 'ZZT');
  assert.strictEqual(v.translation, 'KJV');
  assert.match(v.fallbackReason, /disagreed/);
});

test('one AI provider out of quota does not block the other providers', { skip: !seeded }, async () => {
  process.env.GEMINI_API_KEY = 'g'; process.env.GROQ_API_KEY = 'q'; process.env.ANTHROPIC_API_KEY = 'a';
  replies = { gemini: { status: 429 }, groq: TEST_EDITION_TEXT, claude: TEST_EDITION_TEXT };
  const v = await getVerse('John', 3, 16, 'ZZT');
  assert.strictEqual(v.verification, 'verified');
  assert.deepStrictEqual(v.aiSources.sort(), ['claude', 'groq']);
});

test('a paragraph instead of one verse is rejected for an experimental edition', { skip: !seeded }, async () => {
  process.env.GROQ_API_KEY = 'q';
  replies = { groq: (TEST_EDITION_TEXT + ' ').repeat(20) };
  const v = await getVerse('John', 3, 16, 'ZZT');
  assert.strictEqual(v.translation, 'KJV');
  assert.strictEqual(v.fallback, true);
  assert.match(v.fallbackReason, /No AI provider could find ZZT/);
});

test('Groq first model declines → second model asked', { skip: !seeded }, async () => {
  process.env.GROQ_API_KEY = 'q';
  let calls = 0;
  replies = { groq: () => (++calls === 1 ? null : TEST_EDITION_TEXT) };
  const v = await aiVerse.getVerse('John', 3, 16, 'TPT');
  assert.strictEqual(v.text, TEST_EDITION_TEXT);
  assert.strictEqual(calls, 2);
});

test('Gemini web search times out → asks again without search', { skip: !seeded }, async () => {
  process.env.GEMINI_API_KEY = 'g';
  replies = { gemini: TEST_EDITION_TEXT };
  const mocked = global.fetch;
  global.fetch = async (url, init) => {
    if (String(url).includes(':generateContent') && JSON.parse(init.body).tools) {
      const err = new Error('The operation was aborted due to timeout'); err.name = 'TimeoutError'; throw err;
    }
    return mocked(url, init);
  };
  const v = await aiVerse.getVerse('John', 3, 16, 'TPT');
  assert.strictEqual(v.text, TEST_EDITION_TEXT);
  assert.strictEqual(v.verification, 'unverified');   // recall only, one source
});

test('Gemini model list too slow → known model names are tried', { skip: !seeded }, async () => {
  process.env.GEMINI_API_KEY = 'g';
  replies = { gemini: url => url.includes('gemini-3.8-flash:') ? { status: 404 } : TEST_EDITION_TEXT };
  const mocked = global.fetch;
  global.fetch = async (url, init) => {
    if (String(url).includes('/models?')) { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; }
    return mocked(url, init);
  };
  const v = await aiVerse.getVerse('John', 3, 16, 'TPT');
  assert.strictEqual(v.text, TEST_EDITION_TEXT);
  assert.ok(seen.some(u => u.includes('gemini-3.5-flash:generateContent')), 'moved past the missing model');
});

test('two Groq models with the same wording → verified on their own', { skip: !seeded }, async () => {
  process.env.GROQ_API_KEY = 'q';
  replies = { groq: TEST_EDITION_TEXT };
  const v = await aiVerse.getVerse('John', 3, 16, 'TPT');
  assert.strictEqual(v.verification, 'verified');
  assert.match(v.note, /compound \+ llama-3.3-70b-versatile|llama-3.3-70b-versatile \+ compound/);
});

test('two Groq models disagree (e.g. one gives KJV wording) → unverified', { skip: !seeded }, async () => {
  process.env.GROQ_API_KEY = 'q';
  replies = { groq: model => model === 'groq/compound' ? TEST_EDITION_TEXT
    : 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish.' };
  const v = await aiVerse.getVerse('John', 3, 16, 'TPT');
  assert.strictEqual(v.verification, 'unverified');
  assert.match(v.note, /sources disagreed/);
});

test('live: answers as soon as two sources agree, without waiting for a slow Gemini', { skip: !seeded }, async () => {
  process.env.GEMINI_API_KEY = 'g'; process.env.GROQ_API_KEY = 'q';
  replies = { gemini: TEST_EDITION_TEXT, groq: TEST_EDITION_TEXT };
  const mocked = global.fetch;
  global.fetch = async (url, init) => {
    if (String(url).includes(':generateContent')) await new Promise(r => setTimeout(r, 3000));
    return mocked(url, init);
  };
  const t = Date.now();
  const v = await aiVerse.getVerse('John', 3, 16, 'TPT', null, { deadlineMs: 2000 });
  assert.strictEqual(v.verification, 'verified');            // the two Groq models agreed
  assert.ok(Date.now() - t < 1500, `took ${Date.now() - t} ms`);
});

test('live: after the deadline shows what it has, and saves a later confirmation', { skip: !seeded }, async () => {
  process.env.GEMINI_API_KEY = 'g'; process.env.ANTHROPIC_API_KEY = 'a';
  replies = { gemini: TEST_EDITION_TEXT, claude: TEST_EDITION_TEXT };
  const mocked = global.fetch;
  global.fetch = async (url, init) => {
    if (String(url).includes(':generateContent')) await new Promise(r => setTimeout(r, 1200));
    return mocked(url, init);
  };
  let late = null;
  const t = Date.now();
  const v = await aiVerse.getVerse('John', 3, 16, 'TPT', null, { deadlineMs: 300, onLateResult: r => { late = r; } });
  assert.ok(Date.now() - t < 1000, `took ${Date.now() - t} ms`);
  assert.strictEqual(v.verification, 'unverified');          // Claude alone so far
  await new Promise(r => setTimeout(r, 1500));
  assert.strictEqual(late && late.verification, 'verified'); // Gemini agreed later
});

test('AI_SHOW_UNVERIFIED=true lets flagged single-source wording into the queue', { skip: !seeded }, async () => {
  process.env.ANTHROPIC_API_KEY = 'a'; process.env.AI_SHOW_UNVERIFIED = 'true';
  replies = { claude: TEST_EDITION_TEXT };
  try {
    const v = await getVerse('John', 3, 16, 'ZZT');
    assert.strictEqual(v.verification, 'unverified');
  } finally { delete process.env.AI_SHOW_UNVERIFIED; }
});

test('backup Gemini key takes over when the first is rejected', { skip: !seeded }, async () => {
  process.env.GEMINI_API_KEY = 'AIza_bad1, AIza_good2';
  replies = { gemini: TEST_EDITION_TEXT };
  const mocked = global.fetch;
  global.fetch = async (url, init) => {
    if (init && init.headers && init.headers['x-goog-api-key'] === 'AIza_bad1') return json({ error: { message: 'API key not valid' } }, 400 + 3);
    return mocked(url, init);
  };
  const v = await aiVerse.getVerse('John', 3, 16, 'TPT');
  assert.strictEqual(v.text, TEST_EDITION_TEXT);
});
