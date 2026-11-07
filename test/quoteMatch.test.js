const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const seeded = fs.existsSync(path.join(__dirname, '../db/bible.db'));
const quotes = require('../services/quoteMatch');
const ref = m => m.length ? `${m[0].book} ${m[0].chapter}:${m[0].verse}${m[0].strong ? '' : ' (suggest)'}` : null;

test('quoted verses are recognised without a reference', { skip: !seeded && 'run npm run seed first' }, () => {
  assert.strictEqual(ref(quotes.match('I wish above all things that thou mayest prosper')), '3 John 1:2');
  assert.strictEqual(ref(quotes.match('the Lord is my shepherd I shall not want')), 'Psalms 23:1');
  assert.strictEqual(ref(quotes.match('I can do all things through Christ which strengtheneth me')), 'Philippians 4:13');
  assert.strictEqual(ref(quotes.match('they that wait upon the Lord shall renew their strength')), 'Isaiah 40:31');
  assert.strictEqual(ref(quotes.match('the joy of the Lord is your strength')), 'Nehemiah 8:10 (suggest)');
});

test('ordinary speech and stock phrases are not matched', { skip: !seeded && 'run npm run seed first' }, () => {
  assert.strictEqual(ref(quotes.match('we thank God for this beautiful morning and we bless his name')), null);
  assert.strictEqual(ref(quotes.match('and it came to pass that the lord spake unto moses saying')), null);
  assert.strictEqual(ref(quotes.match('I wish above all tales that that may prosper and be in helps')), null);
});

test('matching is fast', { skip: !seeded && 'run npm run seed first' }, () => {
  quotes.match('warm up');
  const t = Date.now();
  for (let i = 0; i < 100; i++) quotes.match('Trust in the Lord with all thine heart and lean not unto thine own understanding');
  assert.ok(Date.now() - t < 200, `${Date.now() - t} ms for 100`);
});
