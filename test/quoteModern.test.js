const test = require('node:test');
const assert = require('node:assert');
const quotes = require('../services/quoteMatch');

const ref = r => r && r.book + ' ' + r.chapter + ':' + r.verse;

test('quotes in modern wording still find the verse', () => {
  const cases = {
    'I can do all things through Christ who strengthens me': 'Philippians 4:13',
    'trust in the Lord with all your heart and lean not on your own understanding': 'Proverbs 3:5',
    'I wish above all things that you may prosper and be in health even as your soul prospers': '3 John 1:2',
    'they that wait upon the Lord shall renew their strength they shall mount up with wings as eagles': 'Isaiah 40:31',
  };
  for (const [said, want] of Object.entries(cases)) {
    const m = quotes.match(said);
    assert.strictEqual(ref(m[0]), want, said);
    assert.ok(m[0].strong, said);
  }
});

test('everyday church talk matches nothing', () => {
  for (const t of ['good morning church we are so happy to have you here today', 'please turn off your phones and let us pray together',
    'the offering will be taken after the announcements this morning', 'God is good all the time and all the time God is good'])
    assert.deepStrictEqual(quotes.match(t), [], t);
});
