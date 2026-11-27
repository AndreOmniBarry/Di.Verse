// Spoken translation switching, server side: what the parser hears and what a
// lookup in the new translation returns. The Operator page's part (re-showing
// the verse on screen, refusing a KJV stand-in, newest request wins) is driven
// in a real browser by test/browser/translations.js.
for (const k of ['APIBIBLE_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) process.env[k] = '';
const temp = require('./helpers/tempBible');
const test = require('node:test');
const assert = require('node:assert');
const { parse } = require('../services/parser');
const bibleDb = require('../services/bibleDb');
const library = require('../services/library');

test.after(() => { bibleDb.closeDb(); temp.cleanup(); });

const only = (text, active = 'KJV') => { const r = parse(text, active); return r && r.translationOnly ? r.translation : null; };

test('translation-only requests, by name and by abbreviation', () => {
  assert.strictEqual(only('Can we have that in the NKJV?'), 'NKJV');
  assert.strictEqual(only("Let's read from the Passion Translation."), 'TPT');
  assert.strictEqual(only('Give us that in the Amplified.'), 'AMP');
  assert.strictEqual(only('read it in the message bible'), 'MSG');
  assert.strictEqual(only("let's see it in Young's Literal"), 'YLT');
});

test('switching back to KJV is heard while another translation is active', () => {
  assert.strictEqual(only('back to the King James', 'NKJV'), 'KJV');
  assert.strictEqual(only('read it in KJV', 'ASV'), 'KJV');
});

test('everyday words are not taken for a translation', () => {
  for (const t of ['the message of the cross is power', 'that was good news for them', 'he was full of passion for God', 'search the web for it'])
    assert.strictEqual(only(t), null, t);
});

test('a reference with a translation keeps both, with its range', () => {
  let r = parse('Genesis 4:3 TPT.');
  assert.deepStrictEqual([r.book, r.chapter, r.verse, r.translation], ['Genesis', 4, 3, 'TPT']);
  r = parse('John 3:16 to 18 in the amplified');
  assert.deepStrictEqual([r.book, r.chapter, r.verse, r.verseEnd, r.translation], ['John', 3, 16, 18, 'AMP']);
});

test('a lookup in the new translation returns its own text for the whole range', async () => {
  temp.seed();
  library.store('ASV', 'American Standard Version (1901)', temp.rows('ASV'), { source: 'test' });
  const v = await bibleDb.getPassage('John', 3, 16, 18, 'ASV');
  assert.strictEqual(v.translation, 'ASV');
  assert.ok(!v.fallback);
  assert.match(v.text, /ASV John 3:16.*ASV John 3:17.*ASV John 3:18/);
  const back = await bibleDb.getPassage('John', 3, 16, 18, 'KJV');
  assert.strictEqual(back.translation, 'KJV');
  assert.match(back.text, /KJV John 3:16/);
});

test('an unavailable translation is flagged, never labelled as itself', async () => {
  // the Operator page refuses any answer with fallback set, so the screen keeps what it shows
  const v = await bibleDb.getPassage('John', 3, 16, undefined, 'NKJV');
  assert.strictEqual(v.fallback, true);
  assert.strictEqual(v.requestedTranslation, 'NKJV');
  assert.strictEqual(v.translation, 'KJV');
  const r = await bibleDb.getPassage('John', 3, 16, 18, 'TPT');
  assert.strictEqual(r.fallback, true);
  assert.notStrictEqual(r.translation, 'TPT');
});

test('a passage the translation does not contain is flagged too', async () => {
  library.store('PART', 'Partial', temp.rows('PART').filter(x => x.book !== 'John'), { source: 'test' });
  const v = await bibleDb.getPassage('John', 3, 16, undefined, 'PART');
  assert.strictEqual(v.fallback, true);
  assert.match(v.fallbackReason, /not part of the PART text/);
});
