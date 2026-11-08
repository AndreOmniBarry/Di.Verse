// Moving through scripture from what's on screen: next / previous verse or
// chapter (crossing chapter and book boundaries), and the preacher's spoken
// cues for it ("next verse", "take it back", "verse 17", "next chapter").
const { getDb } = require('./bibleDb');
const { normaliseNumbers } = require('./parser');

function structure() {
  return getDb().prepare('SELECT book_num, book, chapter, max_verse FROM bible_structure ORDER BY book_num, chapter').all();
}
let chapters = null; // every chapter in order: [{ book, chapter, max_verse }]
function allChapters() { return chapters || (chapters = structure()); }

function chapterIndex(book, chapter) {
  return allChapters().findIndex(c => c.book === book && c.chapter === chapter);
}

// ref: { book, chapter, verse, verseEnd? } → the verse to show next
//   dir: 'next' | 'prev'; unit: 'verse' | 'chapter'
// Returns { book, chapter, verse } or null at the very start / end of the Bible.
function step(ref, dir, unit = 'verse') {
  const list = allChapters();
  const i = chapterIndex(ref.book, Number(ref.chapter));
  if (i < 0) return null;
  if (unit === 'chapter') {
    const c = list[i + (dir === 'next' ? 1 : -1)];
    return c ? { book: c.book, chapter: c.chapter, verse: 1 } : null;
  }
  const here = list[i];
  if (dir === 'next') {
    const v = Number(ref.verseEnd || ref.verse) + 1;
    if (v <= here.max_verse) return { book: here.book, chapter: here.chapter, verse: v };
    const c = list[i + 1];
    return c ? { book: c.book, chapter: c.chapter, verse: 1 } : null;
  }
  const v = Number(ref.verse) - 1;
  if (v >= 1) return { book: here.book, chapter: here.chapter, verse: v };
  const c = list[i - 1];
  return c ? { book: c.book, chapter: c.chapter, verse: c.max_verse } : null;
}

// Spoken cues, checked only when no book is named (a full reference is the
// parser's job). Returns the LAST cue in the text, with where it ends, or null:
//   { kind: 'step', dir, unit } | { kind: 'goto', chapter?, verse, verseEnd? }
const CUES = [
  [/\b(?:the\s+)?(?:next|following)\s+verses?\b|\bverse\s+after\s+(?:that|this)\b/g, { kind: 'step', dir: 'next', unit: 'verse' }],
  [/\btake\s+(?:it|us|that)\s+back\b|\b(?:previous|preceding)\s+verse\b|\bverse\s+before\s+(?:that|this|it)\b|\bgo\s+back\s+(?:a|one)\s+verse\b|\bback\s+one\s+verse\b/g, { kind: 'step', dir: 'prev', unit: 'verse' }],
  [/\b(?:the\s+)?(?:next|following)\s+chapter\b/g, { kind: 'step', dir: 'next', unit: 'chapter' }],
  [/\b(?:previous|preceding)\s+chapter\b|\bchapter\s+before\s+(?:that|this|it)\b|\bgo\s+back\s+(?:a|one)\s+chapter\b/g, { kind: 'step', dir: 'prev', unit: 'chapter' }],
  // "chapter 5 verse 3", "verse 17", "verses 17 to 19", "go back to verse 16"
  [/\b(?:chapters?\s+(\d{1,3})\s*(?:,|and)?\s*)?verses?\s+(\d{1,3})(?:\s*(?:to|through|thru|till|until|-|–)\s*(?:verse\s+)?(\d{1,3}))?\b/g, 'goto'],
];

function cue(text) {
  const t = normaliseNumbers(String(text || '').toLowerCase());
  let best = null;
  for (const [re, what] of CUES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(t))) {
      const end = m.index + m[0].length;
      if (best && best.end > end) continue;
      if (what === 'goto') {
        const verse = parseInt(m[2]);
        if (!verse) continue;
        const verseEnd = m[3] ? parseInt(m[3]) : undefined;
        best = { kind: 'goto', verse, ...(m[1] ? { chapter: parseInt(m[1]) } : {}), ...(verseEnd > verse ? { verseEnd: Math.min(verseEnd, verse + 9) } : {}), end, atEnd: end >= t.trim().length };
      } else {
        best = { ...what, end, atEnd: end >= t.trim().length };
      }
    }
  }
  return best;
}

// Where a cue takes us from the verse on screen. null if it doesn't apply.
function resolve(command, current) {
  if (!command || !current || !current.book || !current.chapter) return null;
  if (command.kind === 'step') return step(current, command.dir, command.unit);
  const chapter = command.chapter || Number(current.chapter);
  const c = allChapters().find(x => x.book === current.book && x.chapter === chapter);
  if (!c || command.verse > c.max_verse) return null;
  return { book: current.book, chapter, verse: command.verse, ...(command.verseEnd ? { verseEnd: Math.min(command.verseEnd, c.max_verse) } : {}) };
}

module.exports = { step, cue, resolve, _reset: () => { chapters = null; } };
