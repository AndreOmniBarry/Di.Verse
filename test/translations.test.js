// Licensed-translation path with API.Bible mocked (no network, no key needed)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Tests control the key themselves, whatever .env says
require('dotenv').config({ quiet: true });
delete process.env.APIBIBLE_KEY;
delete process.env.APIBIBLE_IDS;
for (const k of ['GEMINI_API_KEY', 'GROQ_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_MODEL', 'GROQ_MODEL']) delete process.env[k];

const seeded = fs.existsSync(path.join(__dirname, '../db/bible.db'));
const apiBible = require('../services/apiBible');
const { getVerse, listTranslations } = require('../services/bibleDb');

const realFetch = global.fetch;
const calls = [];
function mockApiBible() {
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), key: opts.headers['api-key'] });
    const u = new URL(url);
    if (u.pathname.endsWith('/bibles')) {
      return Response.json({ data: [
        { id: 'nkjv-id', abbreviation: 'NKJV', abbreviationLocal: 'NKJV', name: 'New King James Version' },
        { id: 'amp-id', abbreviation: 'AMP', abbreviationLocal: 'AMP', name: 'Amplified Bible' },
      ] });
    }
    if (u.pathname === '/v1/bibles/nkjv-id/verses/JHN.3.16') {
      return Response.json({ data: { content: '  For God so loved the world... everlasting life. ', copyright: 'Scripture taken from the New King James Version®.' }, meta: { fumsId: 'f1' } });
    }
    if (u.pathname === '/v1/bibles/amp-id/verses/PHM.1.6') return new Response('forbidden', { status: 403 });
    return new Response('not found', { status: 404 });
  };
}

test.afterEach(() => { global.fetch = realFetch; delete process.env.APIBIBLE_KEY; apiBible._reset(); calls.length = 0; });

test('local public-domain translations are real stored text', { skip: !seeded && 'run npm run seed first' }, async () => {
  const asv = await getVerse('John', 3, 16, 'ASV');
  assert.strictEqual(asv.source, 'seed');
  assert.match(asv.text, /whosoever believeth on him/);
  const ylt = await getVerse('John', 3, 16, 'YLT');
  assert.match(ylt.text, /only begotten/);
});

test('verse missing from a translation falls back to KJV and says why', { skip: !seeded && 'run npm run seed first' }, async () => {
  const v = await getVerse('Acts', 8, 37, 'ASV');
  assert.strictEqual(v.translation, 'KJV');
  assert.strictEqual(v.fallback, true);
  assert.match(v.fallbackReason, /not part of the ASV text/);
});

test('no key: licensed translation falls back to KJV with the reason, never invented text', { skip: !seeded && 'run npm run seed first' }, async () => {
  const v = await getVerse('John', 3, 16, 'NKJV');
  assert.strictEqual(v.translation, 'KJV');
  assert.match(v.fallbackReason, /APIBIBLE_KEY/);
});

test('with a key: NKJV comes from API.Bible with copyright, USFM ids and the api-key header', { skip: !seeded && 'run npm run seed first' }, async () => {
  process.env.APIBIBLE_KEY = 'test-key';
  mockApiBible();
  const v = await getVerse('John', 3, 16, 'NKJV');
  assert.strictEqual(v.translation, 'NKJV');
  assert.strictEqual(v.source, 'apibible');
  assert.strictEqual(v.text, 'For God so loved the world... everlasting life.');
  assert.match(v.copyright, /New King James/);
  assert.ok(calls.every(c => c.key === 'test-key'));
  assert.ok(calls.some(c => c.url.includes('/verses/JHN.3.16?content-type=text')));

  // second call is served from memory
  const before = calls.length;
  await getVerse('John', 3, 16, 'NKJV');
  assert.strictEqual(calls.length, before);
});

test('with a key: plan without access explains itself', { skip: !seeded && 'run npm run seed first' }, async () => {
  process.env.APIBIBLE_KEY = 'test-key';
  mockApiBible();
  const amp = await getVerse('Philemon', 1, 6, 'AMP');
  assert.strictEqual(amp.translation, 'KJV');
  assert.match(amp.fallbackReason, /plan does not include/);
  const tpt = await getVerse('John', 3, 16, 'TPT');
  assert.match(tpt.fallbackReason, /not available on your API.Bible plan/);
});

test('translation list marks exactly what works', { skip: !seeded && 'run npm run seed first' }, async () => {
  process.env.APIBIBLE_KEY = 'test-key';
  mockApiBible();
  const list = await listTranslations();
  const by = Object.fromEntries(list.map(t => [t.code, t]));
  for (const c of ['KJV', 'ASV', 'YLT', 'BBE', 'NKJV', 'AMP']) assert.strictEqual(by[c].available, true, c);
  assert.strictEqual(by.TPT.available, false);
  assert.strictEqual(by.NIV.available, false);
});

test('passage: range joined with verse numbers, clipped at chapter end', { skip: !seeded && 'run npm run seed first' }, async () => {
  const { getPassage } = require('../services/bibleDb');
  const p = await getPassage('John', 3, 16, 18, 'KJV');
  assert.strictEqual(p.reference, 'John 3:16-18');
  assert.match(p.text, /^¹⁶ For God so loved.*¹⁷ For God sent.*¹⁸ He that believeth/);
  const end = await getPassage('Jude', 1, 24, 30, 'KJV');
  assert.strictEqual(end.reference, 'Jude 1:24-25');
  const mixed = await getPassage('Acts', 8, 36, 38, 'ASV');   // ASV has no 8:37
  assert.strictEqual(mixed.fallback, true);
  assert.match(mixed.fallbackReason, /1 of 3 verses/);
});
