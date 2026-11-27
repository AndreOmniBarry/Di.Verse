const test = require('node:test');
const assert = require('node:assert');
const nav = require('../services/navigation');

test('next / previous verse crosses chapters and books', () => {
  assert.deepStrictEqual(nav.step({ book: 'Romans', chapter: 8, verse: 28 }, 'next'), { book: 'Romans', chapter: 8, verse: 29 });
  assert.deepStrictEqual(nav.step({ book: 'Romans', chapter: 8, verse: 28, verseEnd: 30 }, 'next'), { book: 'Romans', chapter: 8, verse: 31 });
  assert.deepStrictEqual(nav.step({ book: 'Romans', chapter: 8, verse: 39 }, 'next'), { book: 'Romans', chapter: 9, verse: 1 });
  assert.deepStrictEqual(nav.step({ book: 'Romans', chapter: 8, verse: 1 }, 'prev'), { book: 'Romans', chapter: 7, verse: 25 });
  assert.deepStrictEqual(nav.step({ book: 'Malachi', chapter: 4, verse: 6 }, 'next'), { book: 'Matthew', chapter: 1, verse: 1 });
  assert.strictEqual(nav.step({ book: 'Genesis', chapter: 1, verse: 1 }, 'prev'), null);
  assert.strictEqual(nav.step({ book: 'Revelation', chapter: 22, verse: 21 }, 'next'), null);
});

test('next / previous chapter', () => {
  assert.deepStrictEqual(nav.step({ book: 'Esther', chapter: 8, verse: 9 }, 'next', 'chapter'), { book: 'Esther', chapter: 9, verse: 1 });
  assert.deepStrictEqual(nav.step({ book: 'Exodus', chapter: 1, verse: 5 }, 'prev', 'chapter'), { book: 'Genesis', chapter: 50, verse: 1 });
});

test('the preacher\'s cues are understood', () => {
  const kind = t => { const c = nav.cue(t); return c && (c.kind === 'step' ? c.dir + ' ' + c.unit : 'goto ' + (c.chapter ? c.chapter + ':' : '') + c.verse + (c.verseEnd ? '-' + c.verseEnd : '')); };
  assert.strictEqual(kind('let us go to the next verse'), 'next verse');
  assert.strictEqual(kind('take it back'), 'prev verse');
  assert.strictEqual(kind('can you take us back'), 'prev verse');
  assert.strictEqual(kind('the previous verse please'), 'prev verse');
  assert.strictEqual(kind('go to the next chapter'), 'next chapter');
  assert.strictEqual(kind('previous chapter'), 'prev chapter');
  assert.strictEqual(kind('go back one chapter'), 'prev chapter');
  assert.strictEqual(kind('take us to the next chapter'), 'next chapter');
  assert.strictEqual(kind('look at verse seventeen'), 'goto 17');
  assert.strictEqual(kind('verses 17 to 19'), 'goto 17-19');
  assert.strictEqual(kind('chapter five verse three'), 'goto 5:3');
  assert.strictEqual(kind('the universe declares his glory'), null);
  assert.strictEqual(kind('what is the next step for this church'), null);
});

test('a cue resolves against the verse on screen, never past the chapter', () => {
  const here = { book: 'Romans', chapter: 8, verse: 1 };
  assert.deepStrictEqual(nav.resolve(nav.cue('verse 17'), here), { book: 'Romans', chapter: 8, verse: 17 });
  assert.deepStrictEqual(nav.resolve(nav.cue('verses 38 to 45'), here), { book: 'Romans', chapter: 8, verse: 38, verseEnd: 39 });
  assert.strictEqual(nav.resolve(nav.cue('verse 99'), here), null);
  assert.strictEqual(nav.resolve(nav.cue('next verse'), null), null);
});

test('natural next-verse variations are recognised without stealing sermon phrases', () => {
  const kind = t => {
    const c = nav.cue(t);
    return c && (c.kind === 'step' ? c.dir + ' ' + c.unit : c.kind);
  };
  [
    'next', 'the next', 'the next one', 'okay next', 'and the next one',
    'go on', 'go ahead', 'carry on', 'continue', 'keep going',
    'keep reading', 'read on', 'let us proceed', "let's proceed",
    "let's move on", 'what is the next verse?', 'take us to the next verse'
  ].forEach(text => assert.strictEqual(kind(text), 'next verse', text));
  assert.strictEqual(nav.cue('next').deferInterim, true);
  assert.strictEqual(nav.cue('next verse').deferInterim, undefined);

  [
    'next point', 'the next point is important', 'next week',
    'the next generation', 'next subject', 'we need the next chapter of the project',
    'continue the discussion', 'move on to the next topic', 'the work must go on', 'we need to go on',
    'the next verse is important', 'he referenced the previous verse'
  ].forEach(text => assert.strictEqual(nav.cue(text), null, text));
});

test('specific verse instructions accept natural word order and ordinals', () => {
  const command = text => nav.cue(text);
  assert.strictEqual(command('take me to the 17th verse').verse, 17);
  assert.strictEqual(command('take us to the seventeenth verse').verse, 17);
  assert.strictEqual(command('go to verse 17').verse, 17);
  assert.strictEqual(command('go to 17').verse, 17);
  assert.strictEqual(command('go to 17').deferInterim, true);
  assert.strictEqual(command('verses twenty one to twenty three').verse, 21);
  assert.strictEqual(command('verses 17 through 19').verseEnd, 19);
});

test('repeat cues re-show the current passage instead of stepping backwards', () => {
  const here = { book: 'Romans', chapter: 8, verse: 28, verseEnd: 30 };
  const command = nav.cue('read that again');
  assert.deepStrictEqual(command && command.kind, 'repeat');
  assert.deepStrictEqual(nav.resolve(command, here), {
    book: 'Romans', chapter: 8, verse: 28, verseEnd: 30
  });
  assert.strictEqual(nav.resolve(nav.cue('read that again'), null), null);
});
