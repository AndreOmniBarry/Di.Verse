// Reading through the verse on screen, and following it into the next verse
const test = require('node:test');
const assert = require('node:assert');
const reading = require('../services/reading');
const { danglingBook } = require('../services/parser');

const state = (t, cur) => { const r = reading.relation(t, cur); return r.state + (r.next ? ' ' + r.next.book + ' ' + r.next.chapter + ':' + r.next.verse : ''); };

test('reading the verse on screen aloud is recognised, even in a parallel passage\'s words', () => {
  const mark = { book: 'Mark', chapter: 9, verse: 9, translation: 'KJV' };
  assert.strictEqual(state('and as they came down from the mountain he charged them that they should tell no man', mark), 'current');
  assert.strictEqual(state('till the son of man were risen from the dead', mark), 'current');
  assert.strictEqual(state('for we have not an high priest which cannot be touched', { book: 'Hebrews', chapter: 4, verse: 15 }), 'current');
});

test('reading on into the next verse is followed — across chapters and after a range', () => {
  assert.strictEqual(state('and they kept that saying with themselves questioning one with another', { book: 'Mark', chapter: 9, verse: 9 }), 'next Mark 9:10');
  assert.strictEqual(state('let us come boldly to the throne of grace that we may obtain mercy', { book: 'Hebrews', chapter: 4, verse: 15 }), 'next Hebrews 4:16');
  assert.strictEqual(state('for every high priest taken from among men is ordained for men', { book: 'Hebrews', chapter: 4, verse: 16 }), 'next Hebrews 5:1');
  assert.strictEqual(state('and this is the condemnation that light is come into the world', { book: 'John', chapter: 3, verse: 16, verseEnd: 18 }), 'next John 3:19');
});

test('ordinary preaching is not reading', () => {
  assert.strictEqual(state('so church that is what Jesus told them', { book: 'Mark', chapter: 9, verse: 9 }), 'null');
  assert.strictEqual(state('I want to tell you about grace this morning', { book: 'Hebrews', chapter: 4, verse: 15 }), 'null');
});

test('a book named without its numbers yet is noticed (for joining with the next words)', () => {
  assert.strictEqual(danglingBook('turn with me to Romans'), 'Romans');
  assert.strictEqual(danglingBook('open your bibles to the book of Hebrews chapter'), 'Hebrews');
  assert.strictEqual(danglingBook('the book of Job'), 'Job');
  assert.strictEqual(danglingBook('turn to Romans 8:28'), null);
  assert.strictEqual(danglingBook('I want to mark this'), null);
  assert.strictEqual(danglingBook('John told me'), null);
});
