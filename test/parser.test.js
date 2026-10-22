const test = require('node:test');
const assert = require('node:assert');
const { parse, normaliseNumbers } = require('../services/parser');

function ref(text) {
  const r = parse(text);
  return r && !r.translationOnly ? `${r.book} ${r.chapter}:${r.verse}` : null;
}

test('explicit references in natural speech', () => {
  assert.strictEqual(ref('John 3:16'), 'John 3:16');
  assert.strictEqual(ref('turn to John 3:16'), 'John 3:16');
  assert.strictEqual(ref('the gospel of John 3:16'), 'John 3:16');
  assert.strictEqual(ref('in John 3 16 says'), 'John 3:16');
  assert.strictEqual(ref('turn with me to Judges 6 verse 12'), 'Judges 6:12');
  assert.strictEqual(ref('John chapter three verse sixteen'), 'John 3:16');
  assert.strictEqual(ref('Romans 8 and 28'), 'Romans 8:28');
  assert.strictEqual(ref('First Corinthians 13 verse 4'), '1 Corinthians 13:4');
  assert.strictEqual(ref('second Timothy two fifteen'), '2 Timothy 2:15');
  assert.strictEqual(ref('Song of Solomon 2:4'), 'Song of Solomon 2:4');
  assert.strictEqual(ref('Philemon 1:6'), 'Philemon 1:6');
  assert.strictEqual(ref('Revelation twenty one verse four'), 'Revelation 21:4');
});

test('spelled-out hundreds are read in full, not truncated', () => {
  assert.strictEqual(ref('Psalm 119 verse one hundred and five'), 'Psalms 119:105');
  assert.strictEqual(ref('Psalm one hundred and nineteen verse one hundred and five'), 'Psalms 119:105');
  assert.strictEqual(normaliseNumbers('twenty three'), '23');
  assert.strictEqual(normaliseNumbers('three sixteen'), '3 16');
});

test('ordinary speech is not turned into a reference', () => {
  assert.strictEqual(ref('Reverend 3 16 people'), null);
  assert.strictEqual(ref('I have 2 kids and 3 dogs'), null);
  assert.strictEqual(ref('we sang twenty three songs'), null);
  assert.strictEqual(ref('God so loved the world'), null);
});

test('translation requests', () => {
  assert.strictEqual(parse('John 3 verse 16 in the Amplified').translation, 'AMP');
  assert.deepStrictEqual(parse('let us read from the amplified'), { translationOnly: true, translation: 'AMP', confidence: 0.95 });
});

test('long sentences without numbers return instantly (old pattern froze the server)', () => {
  const sentence = 'for god so loved the world that he gave his only begotten son that whosoever believeth in him should not perish but have everlasting life';
  const t = Date.now();
  assert.strictEqual(parse(sentence + ' ' + sentence), null);
  assert.strictEqual(ref(sentence + ' and turn with me to the gospel of John 3:16'), 'John 3:16');
  assert.ok(Date.now() - t < 200, `took ${Date.now() - t} ms`);
});
