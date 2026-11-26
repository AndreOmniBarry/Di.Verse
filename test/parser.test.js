const test = require('node:test');
const assert = require('node:assert');
const { parse, parseAll, normaliseNumbers, detectTranslation } = require('../services/parser');

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

test('installed catalogue aliases recognise full names and spaced spoken codes', () => {
  const catalogue = {
    AKJV: 'American King James Version',
    ESVUK: 'English Standard Version UK',
    NMB: 'New Matthew Bible',
    DLNT: 'Discourse Literal New Testament',
    WE: 'World English Bible'
  };

  for (const [code, name] of Object.entries(catalogue)) {
    assert.strictEqual(detectTranslation('switch to ' + code, catalogue), code, code + ' spoken code');
    assert.strictEqual(detectTranslation('reading from ' + name, catalogue), code, code + ' full name');
  }

  assert.strictEqual(detectTranslation('switch to ESV UK', catalogue), 'ESVUK');
  assert.strictEqual(detectTranslation('W E', catalogue), null);
  assert.strictEqual(detectTranslation('we should keep moving', catalogue), null);
  assert.strictEqual(detectTranslation('switch to WE', catalogue), 'WE');
});

test('MSG and PHILLIPS are recognised in spoken translation requests', () => {
  const namedPhillips = parse('Titus chapter three verses three to eleven in J. B. Phillips');
  assert.strictEqual(namedPhillips.translation, 'PHILLIPS');
  assert.strictEqual(namedPhillips.book, 'Titus');
  assert.strictEqual(namedPhillips.verseEnd, 11);

  const abbreviatedPhillips = parse('Titus 3:3-11 in Phillips');
  assert.strictEqual(abbreviatedPhillips.translation, 'PHILLIPS');
  assert.strictEqual(abbreviatedPhillips.verseEnd, 11);

  assert.deepStrictEqual(parse('let us read from the J. B. Phillips'), {
    translationOnly: true, translation: 'PHILLIPS', confidence: 0.95
  });

  const selectedPhillips = parse('Titus 3:3-11', 'PHILLIPS');
  assert.strictEqual(selectedPhillips.translation, 'PHILLIPS');
  assert.strictEqual(selectedPhillips.verseEnd, 11);

  const selectedMessage = parse('Zephaniah 3:1-5', 'MSG');
  assert.strictEqual(selectedMessage.translation, 'MSG');
  assert.strictEqual(selectedMessage.verseEnd, 5);

  assert.strictEqual(parse('Zephaniah 3:1-5 in the Message').translation, 'MSG');
});

test('long sentences without numbers return instantly (old pattern froze the server)', () => {
  const sentence = 'for god so loved the world that he gave his only begotten son that whosoever believeth in him should not perish but have everlasting life';
  const t = Date.now();
  assert.strictEqual(parse(sentence + ' ' + sentence), null);
  assert.strictEqual(ref(sentence + ' and turn with me to the gospel of John 3:16'), 'John 3:16');
  assert.ok(Date.now() - t < 200, `took ${Date.now() - t} ms`);
});

test('verse ranges', () => {
  const r = t => { const p = parse(t); return p && `${p.book} ${p.chapter}:${p.verse}${p.verseEnd ? '-' + p.verseEnd : ''}`; };
  assert.strictEqual(r('John 3:16-18'), 'John 3:16-18');
  assert.strictEqual(r('John 3:16 to 18'), 'John 3:16-18');
  assert.strictEqual(r('Romans chapter 8 verses 28 through 30'), 'Romans 8:28-30');
  assert.strictEqual(r('Psalm 23 verse one to six'), 'Psalms 23:1-6');
  assert.strictEqual(r('Psalm 119:1-40'), 'Psalms 119:1-10');   // capped at 10 verses for one screen
  assert.strictEqual(r('John 3:16 to 12'), 'John 3:16');          // backwards range ignored
  assert.strictEqual(r('John 3:16 to the end'), 'John 3:16');
});

test('everyday sermon words do not switch the translation', () => {
  for (const t of ['the good news is that Jesus saves', 'his message to the church was clear', 'have compassion on them',
    'what an example of faith', 'the universe declares his glory', 'check our website after service']) {
    assert.strictEqual(parse(t), null, t);
  }
  assert.strictEqual(parse('John 3:16 and the message is simple').translation, 'KJV');
  assert.strictEqual(parse('let us read that in the message').translation, 'MSG');
  assert.strictEqual(parse('John 3:16 in the Message Bible').translation, 'MSG');
  assert.strictEqual(parse('read it from the Passion Translation').translation, 'TPT');
  assert.strictEqual(parse('the good news translation says').translation, 'GNT');
  assert.strictEqual(parse('John 3 16 NKJV').translation, 'NKJV');
});

test('the many ways a reference is said (live testing, Nov 2026)', () => {
  const r = t => { const p = parse(t); return p && `${p.book} ${p.chapter}:${p.verse}${p.verseEnd ? '-' + p.verseEnd : ''}`; };
  const cases = {
    'Psalm 1:1': 'Psalms 1:1', 'Psalm 1 1': 'Psalms 1:1', 'psalm one one': 'Psalms 1:1', 'Psalm 1 verse 1': 'Psalms 1:1', 'Psalm 1-1': 'Psalms 1:1', 'Psalm 1.1': 'Psalms 1:1',
    'Psalm 23': 'Psalms 23:1', 'John 3 vs 16': 'John 3:16', 'John 3 versus 16': 'John 3:16', 'Romans chapter eight from verse twenty eight': 'Romans 8:28',
    'Romans 8 28 to 30': 'Romans 8:28-30', 'Proverbs 3:5 and 6': 'Proverbs 3:5-6', 'Proverbs 3 verse 5 and 6': 'Proverbs 3:5-6',
    'I Corinthians 13:4': '1 Corinthians 13:4', 'II Kings 5:1': '2 Kings 5:1', 'Jude 3': 'Jude 1:3', 'Jude verse 3': 'Jude 1:3', '3 John 2': '3 John 1:2', 'third John verse 2': '3 John 1:2',
    'John 316': 'John 3:16', 'Romans 828': 'Romans 8:28', 'Matthew 1128': 'Matthew 11:28', 'turn to Mark 2': 'Mark 2:1', 'James chapter 4': 'James 4:1',
  };
  for (const [said, want] of Object.entries(cases)) assert.strictEqual(r(said), want, said);
});

test('every reference in a sentence, in order', () => {
  const all = t => parseAll(t).map(p => `${p.book} ${p.chapter}:${p.verse}${p.verseEnd ? '-' + p.verseEnd : ''}`);
  assert.deepStrictEqual(all('Romans 8:28 and Philippians 4:13'), ['Romans 8:28', 'Philippians 4:13']);
  assert.deepStrictEqual(all('read Psalm 23:1 and 2 Kings 5:1'), ['Psalms 23:1', '2 Kings 5:1']);
  assert.deepStrictEqual(all('Genesis 1:1 John 1:1 and Hebrews 11:3'), ['Genesis 1:1', 'John 1:1', 'Hebrews 11:3']);
});

test('book names that are everyday words need a cue when they come with one number', () => {
  for (const t of ['I want you to mark 2 things today', 'John 3 times told me', 'my job 1 is to pray', 'the numbers 5 and 6 are on the board',
    'James 4 kids are here', 'Ruth 2 years ago', 'luke 1 more time', 'song 1 is next', 'daniel 3 of you come', 'James 4 and 5 kids'])
    assert.strictEqual(parse(t), null, t);
});
