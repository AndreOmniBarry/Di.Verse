// The verse being talked about, from its telling words: paraphrased, or
// misheard by speech-to-text. Examples from live testing.
const test = require('node:test');
const assert = require('node:assert');
const finder = require('../services/verseFinder');
const ref = r => r && r.book + ' ' + r.chapter + ':' + r.verse;

const SAID = [
  ['the man Isaac sowed in the land', 'Genesis 26:12'],
  ['Isaac sold in that land and received a hundredfold', 'Genesis 26:12'],          // "sowed" misheard
  ['then Isaac souled in that land and received in the same year an hundredfold', 'Genesis 26:12'],
  ['and the man waxed great and went forward', 'Genesis 26:13'],
  ['and the man wasp great and went forward and grew until he became very great', 'Genesis 26:13'], // "waxed" misheard
  ['I wish above all things that thou mayest prosper', '3 John 1:2'],
  ['I pray that you prosper and be in health as your soul prospers', '3 John 1:2'],
  ['Peter walked on the water to go to Jesus', 'Matthew 14:29'],
  ['jesus wept', 'John 11:35'],
  ['no weapon formed against you shall prosper', 'Isaiah 54:17'],
  ['the woman with the issue of blood touched the hem of his garment', 'Matthew 9:20'],
  ['yeah though I walk through the valley of the shadow of death I will fear no evil', 'Psalms 23:4'], // "yea" misheard
  ['delight yourself in the Lord and he will give you the desires of your heart', 'Psalms 37:4'],
];

test('paraphrased and misheard verses are found', () => {
  for (const [said, want] of SAID) {
    const found = finder.find(said, 5);
    assert.strictEqual(ref(found[0]), want, said + ' → ' + found.slice(0, 3).map(ref).join(', '));
    assert.ok(finder.judge(found), 'should at least be suggested: ' + said);
  }
});

test('a long, clear paraphrase goes up on its own; a short one is a suggestion', () => {
  assert.strictEqual(finder.judge(finder.find('then Isaac souled in that land and received in the same year an hundredfold')), 'strong');
  assert.strictEqual(finder.judge(finder.find('jesus wept')), 'suggest');
});

test('ordinary church talk is never suggested', () => {
  for (const t of ['good morning church we are so happy to have you here today', 'please turn off your phones and let us pray together',
    'the offering will be taken after the announcements this morning', 'I went to the market yesterday and bought some tomatoes for my wife',
    'God is good all the time and all the time God is good', 'can we have these on the screen please', 'so let us go back to the King James version',
    'turn to your neighbour and say neighbour you are blessed', 'some of you came here with a heavy heart this morning',
    'I want you to know that this year is your year of increase', 'the choir will come and minister now'])
    assert.strictEqual(finder.judge(finder.find(t)), null, t);
});
