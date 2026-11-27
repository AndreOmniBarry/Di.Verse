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

// Local translations can contain only some books/chapters. Use their actual
// chapter order when crossing a chapter boundary, but preserve numeric verse
// steps inside a chapter. A missing local verse must remain visible (getVerse
// will explain/fallback) rather than being silently skipped by navigation.
function stepLocalTranslation(ref, dir, unit, translation) {
  const db = getDb();
  const chapters = db.prepare(`
    SELECT book, book_num, chapter,
      MAX(COALESCE(NULLIF(verse_end, 0), verse)) AS last_verse
    FROM verses
    WHERE translation = ? AND COALESCE(substr(source, 1, 3), '') != 'ai_'
    GROUP BY book, book_num, chapter
    ORDER BY book_num, chapter
  `).all(translation);
  if (!chapters.length) return undefined; // keep the canonical/API navigation path

  const index = chapters.findIndex(c => c.book === ref.book && c.chapter === Number(ref.chapter));
  if (index < 0) return undefined;

  if (unit === 'chapter') {
    const target = chapters[index + (dir === 'next' ? 1 : -1)];
    return target ? { book: target.book, chapter: target.chapter, verse: 1 } : null;
  }

  const here = chapters[index];
  if (dir === 'next') {
    const verse = Number(ref.verseEnd || ref.verse) + 1;
    if (verse <= here.last_verse) return { book: here.book, chapter: here.chapter, verse };
    const next = chapters[index + 1];
    return next ? { book: next.book, chapter: next.chapter, verse: 1 } : null;
  }

  const verse = Number(ref.verse) - 1;
  if (verse >= 1) return { book: here.book, chapter: here.chapter, verse };
  const previous = chapters[index - 1];
  if (!previous) return null;
  // Return to the last verse actually stored in the previous local chapter.
  // This keeps Next/Previous symmetric when a partial translation omits the
  // tail of a chapter; gaps within a stored chapter remain navigable above.
  return { book: previous.book, chapter: previous.chapter, verse: previous.last_verse };
}
// ref: { book, chapter, verse, verseEnd? } → the verse/passage to show next
//   dir: 'next' | 'prev'; unit: 'verse' | 'chapter'
// translation is optional; local translations navigate only through stored
// passages, while remote and canonical translations retain the KJV structure.
function step(ref, dir, unit = 'verse', translation) {
  if (translation) {
    const local = stepLocalTranslation(ref, dir, unit, String(translation).toUpperCase().split('/')[0]);
    if (local !== undefined) return local;
  }

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
  // "next verse", "the next one" (numbers are digits by now: "next 1"), "let's read on", "keep reading"
  [/\b(?:the\s+)?(?:next|following)\s+(?:verses?|scripture\s+verse|1)\b|\bverse\s+after\s+(?:that|this|it)\b|\b(?:read|reading)\s+on\b|\b(?:keep|continue)\s+reading\b|\bmove\s+(?:on\s+)?to\s+the\s+next\b|\b(?:and\s+)?the\s+next\s*$/g, { kind: 'step', dir: 'next', unit: 'verse' }],
  // "take it back", "previous verse", "the verse before", "back one", "the last one"
  [/\btake\s+(?:it|us|that|me)\s+back\b|\b(?:previous|preceding|prior)\s+(?:verse|1)\b|\b(?:the\s+)?verse\s+before\b|\b(?:go|come|step)\s+back\s+(?:a|1)\s+verse\b|\bback\s+1\s+verse\b|\b(?:go|come)\s+back\s+1\b|\bback\s+1\b|\bthe\s+last\s+1\b/g, { kind: 'step', dir: 'prev', unit: 'verse' }],
  [/\b(?:the\s+)?(?:next|following)\s+chapter\b/g, { kind: 'step', dir: 'next', unit: 'chapter' }],
  [/\b(?:previous|preceding)\s+chapter\b|\bchapter\s+before\s+(?:that|this|it)\b|\bgo\s+back\s+(?:a|one)\s+chapter\b/g, { kind: 'step', dir: 'prev', unit: 'chapter' }],
  // "chapter 5 verse 3", "verse 17", "verses 17 to 19", "go back to verse 16"
  [/\b(?:chapters?\s+(\d{1,3})\s*(?:,|and)?\s*)?(?:verses?|versus|vs)\s+(\d{1,3})(?:\s*(?:to|through|thru|till|until|and|-|–)\s*(?:verses?\s+)?(\d{1,3}))?\b/g, 'goto'],
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
  if (command.kind === 'step') return step(current, command.dir, command.unit, current.translation);
  const chapter = command.chapter || Number(current.chapter);
  const c = allChapters().find(x => x.book === current.book && x.chapter === chapter);
  if (!c || command.verse > c.max_verse) return null;
  return { book: current.book, chapter, verse: command.verse, ...(command.verseEnd ? { verseEnd: Math.min(command.verseEnd, c.max_verse) } : {}) };
}

// A reference that doesn't exist (e.g. Matthew 11:35 — chapter 11 ends at 30),
// usually a misheard number. The closest real verses, most likely first:
// the same verse in the chapters either side, look-alike numbers in the same
// chapter (35 → 25, 15, 5, 30), the chapter's last verse, the book's last chapter.
function nearest(book, chapter, verse, limit = 3) {
  const list = allChapters().filter(c => c.book === book);
  if (!list.length) return [];
  const max = c => (list.find(x => x.chapter === c) || {}).max_verse || 0;
  const out = [], seen = new Set();
  const add = (c, v, why) => { const k = c + ':' + v; if (!seen.has(k) && v >= 1 && v <= max(c)) { seen.add(k); out.push({ book, chapter: c, verse: v, why }); } };
  if (max(chapter)) {
    // the chapter was probably heard right: look-alike verse numbers first
    // ("thirty-five" for "twenty-five"), then the chapter's last verse
    add(chapter, verse - 10, `${book} ${chapter}:${verse - 10} — a look-alike number`);
    add(chapter, max(chapter), `${book} ${chapter} ends at verse ${max(chapter)}`);
    const d = String(verse);
    for (const v of [verse - 20, +d.slice(1) || 0, +d.split('').reverse().join('')]) add(chapter, v, `${book} ${chapter}:${v} — a look-alike number`);
    for (const c of [chapter - 1, chapter + 1]) add(c, verse, `chapter ${c} has a verse ${verse}`);
  } else {
    const last = list[list.length - 1].chapter;
    add(last, Math.min(verse, max(last)), `${book} has ${last} chapters`);
    const d = String(chapter);
    if (d.length > 1) for (const c of [+d.slice(1), +d.slice(0, -1)]) add(c, verse, `chapter ${c}, a look-alike number`);
  }
  return out.slice(0, limit);
}

module.exports = { step, cue, resolve, nearest, _reset: () => { chapters = null; } };
