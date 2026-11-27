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

test('local translation navigation keeps missing verse numbers visible and respects explicit ranges', () => {
  const { getDb } = require('../services/bibleDb');
  const db = getDb();
  db.prepare("DELETE FROM verses WHERE translation = 'ZZPTNV'").run();
  const insert = db.prepare(`
    INSERT INTO verses (translation, book, book_num, chapter, verse, verse_end, text, source)
    VALUES ('ZZPTNV', ?, ?, ?, ?, ?, 'fixture', 'zip-import')
  `);
  try {
    insert.run('Luke', 42, 1, 1, 0);
    insert.run('Luke', 42, 1, 5, 0);
    insert.run('Luke', 42, 1, 6, 8);
    insert.run('Luke', 42, 3, 1, 0);
    insert.run('Luke', 42, 3, 3, 0);
    insert.run('Acts', 44, 1, 1, 0);

    // Missing 2–4 are not silently skipped: the application can show its
    // missing-translation fallback/notice for the exact reference.
    assert.deepStrictEqual(
      nav.step({ book: 'Luke', chapter: 1, verse: 1 }, 'next', 'verse', 'ZZPTNV'),
      { book: 'Luke', chapter: 1, verse: 2 }
    );
    assert.deepStrictEqual(
      nav.step({ book: 'Luke', chapter: 1, verse: 5 }, 'prev', 'verse', 'ZZPTNV'),
      { book: 'Luke', chapter: 1, verse: 4 }
    );

    // Explicit source range 6–8 is navigated as one stored paragraph.
    assert.deepStrictEqual(
      nav.step({ book: 'Luke', chapter: 1, verse: 6, verseEnd: 8 }, 'next', 'verse', 'ZZPTNV'),
      { book: 'Luke', chapter: 3, verse: 1 }
    );
    assert.deepStrictEqual(
      nav.step({ book: 'Luke', chapter: 3, verse: 1 }, 'prev', 'verse', 'ZZPTNV'),
      { book: 'Luke', chapter: 1, verse: 8 }
    );
    assert.deepStrictEqual(
      nav.step({ book: 'Luke', chapter: 3, verse: 3 }, 'prev', 'verse', 'ZZPTNV'),
      { book: 'Luke', chapter: 3, verse: 2 }
    );
    assert.deepStrictEqual(
      nav.step({ book: 'Luke', chapter: 1, verse: 1 }, 'next', 'chapter', 'ZZPTNV'),
      { book: 'Luke', chapter: 3, verse: 1 }
    );
    assert.deepStrictEqual(
      nav.step({ book: 'Luke', chapter: 3, verse: 3 }, 'next', 'verse', 'ZZPTNV'),
      { book: 'Acts', chapter: 1, verse: 1 }
    );
    assert.deepStrictEqual(
      nav.resolve({ kind: 'step', dir: 'next', unit: 'verse' },
        { book: 'Luke', chapter: 1, verse: 1, translation: 'ZZPTNV' }),
      { book: 'Luke', chapter: 1, verse: 2 }
    );

    // Existing KJV navigation remains canonical when no local translation is supplied.
    assert.deepStrictEqual(
      nav.step({ book: 'Luke', chapter: 1, verse: 1 }, 'next'),
      { book: 'Luke', chapter: 1, verse: 2 }
    );
  } finally {
    db.prepare("DELETE FROM verses WHERE translation = 'ZZPTNV'").run();
  }
});
