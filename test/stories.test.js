// Bible stories → reference suggestions
const test = require('node:test');
const assert = require('node:assert');
const stories = require('../services/stories');
const { getDb } = require('../services/bibleDb');

test('every story points at verses that exist', () => {
  const max = (b, c) => { const r = getDb().prepare('SELECT max_verse m FROM bible_structure WHERE book = ? AND chapter = ?').get(b, c); return r && r.m; };
  for (const s of stories.STORIES) {
    const a = max(s.book, s.chapter), z = max(s.book, s.endChapter);
    assert.ok(a && z, s.ref + ': chapter exists');
    assert.ok(s.verse <= a && s.endVerse <= z, s.ref + ': verses exist');
    assert.ok(s.endChapter > s.chapter || s.endVerse >= s.verse, s.ref + ': ends after it starts');
  }
  assert.ok(stories.STORIES.length >= 120);
});

test('a story being told is recognised', () => {
  const told = {
    'remember when Abraham was told to sacrifice his son Isaac': 'Genesis 22:1–19',
    'Peter walked on the water to go to Jesus': 'Matthew 14:22–33',
    'Jabez prayed that God would enlarge his coast': '1 Chronicles 4:9–10',
    'and Hannah cried unto the Lord and prayed for a son': '1 Samuel 1:9–28',
    'David killed Goliath with a sling and a stone': '1 Samuel 17:1–58',
    'Daniel was thrown into the den of lions': 'Daniel 6:10–23',
    'Zacchaeus climbed the sycamore tree': 'Luke 19:1–10',
    'Paul and Silas prayed and sang at midnight in prison': 'Acts 16:25–34',
    'Noah built the ark before the flood': 'Genesis 6:9–9:17',
  };
  for (const [said, ref] of Object.entries(told)) {
    const m = stories.match(said);
    assert.ok(m.length, said);
    assert.strictEqual(stories.display(m[0]), ref, said);
  }
});

test('ordinary preaching does not suggest a story', () => {
  for (const t of ['God created you for a purpose in this world', 'Jesus is the living water walk with him daily', 'you must be born again says Jesus',
    'the Lord is my rock in this house', 'sit at the feet of Jesus this morning', 'God is love and he is patient with us', 'Jesus died on the cross for your sins',
    'let us pray our father in heaven', 'the storm in your life will pass because Jesus is with you', 'your house will be built on the solid rock of Christ',
    'give your offering and God will bless you', 'he is risen indeed hallelujah'])
    assert.deepStrictEqual(stories.match(t), [], t);
});
