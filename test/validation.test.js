const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const seeded = fs.existsSync(path.join(__dirname, '../db/bible.db'));
const { normaliseBook, validateReference } = require('../services/validation');

test('book names normalise to the right book', () => {
  assert.strictEqual(normaliseBook('Judges'), 'Judges');       // was Jude
  assert.strictEqual(normaliseBook('Philemon'), 'Philemon');   // was Philippians
  assert.strictEqual(normaliseBook('Jude'), 'Jude');
  assert.strictEqual(normaliseBook('phil'), 'Philippians');
  assert.strictEqual(normaliseBook('Psalm'), 'Psalms');
  assert.strictEqual(normaliseBook('1 cor'), '1 Corinthians');
  assert.strictEqual(normaliseBook('first john'), '1 John');
  assert.strictEqual(normaliseBook('Reverend'), null);
});

test('references validate against the seeded Bible', { skip: !seeded && 'run npm run seed first' }, () => {
  assert.strictEqual(validateReference('Judges', 6, 12).valid, true);
  assert.strictEqual(validateReference('Psalms', 119, 176).valid, true);
  assert.strictEqual(validateReference('Psalms', 119, 177).code, 'VERSE_EXCEEDS_CHAPTER');
  assert.strictEqual(validateReference('Jude', 2, 1).code, 'CHAPTER_NOT_FOUND');
});
