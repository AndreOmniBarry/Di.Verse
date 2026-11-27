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
const ORDINALS = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6,
  seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11,
  twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15,
  sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19,
  twentieth: 20
};

function normaliseCueText(text) {
  let value = String(text || '').toLowerCase().replace(/[’]/g, "'");
  // ASR frequently writes numeric ordinals as "17th".
  value = value.replace(/\b(\d{1,3})(?:st|nd|rd|th)\b/g, '$1');
  // Ordinal words are useful in navigation ("the seventeenth verse").
  value = value.replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth)\b/g,
    word => String(ORDINALS[word]));
  return normaliseNumbers(value);
}

// The bare forms are deliberately anchored: "next point", "next week" and
// ordinary sermon sentences must never advance scripture accidentally.
const CUES = [
  // Explicit next-verse instructions.
  [/\b(?:the\s+)?(?:next|following)\s+(?:verses?|scripture\s+verses?)\b|\bverse\s+after\s+(?:that|this|it)\b|\bmove\s+(?:on\s+)?to\s+the\s+next\s+(?:one|1)\b|\b(?:take|bring)\s+(?:me|us|it)\s+to\s+the\s+next\s+(?:one|1)\b|\b(?:and\s+)?the\s+next\s*$/g, { kind: 'step', dir: 'next', unit: 'verse' }],
  // A short "next" / "the next one" is accepted only as a complete cue.
  [/^(?:(?:okay|ok|alright|right|now|so|and|then|please|let'?s)\s+){0,3}(?:the\s+)?next(?:\s+(?:one|1))?(?:\s+please)?[.!?]*$/g, { kind: 'step', dir: 'next', unit: 'verse', deferInterim: true }],
  // Natural continuation instructions. Exact/command-like forms only.
  [/^(?:(?:okay|ok|alright|right|now|so|please)\s+)*(?:(?:let'?s|let\s+us)\s+)?(?:go\s+on|go\s+ahead|carry\s+on|continue|proceed|keep\s+going|keep\s+reading|read\s+on|move\s+on)(?:\s+please)?[.!?]*$/g, { kind: 'step', dir: 'next', unit: 'verse' }],
  [/\b(?:go\s+on|go\s+ahead|carry\s+on|keep\s+going|keep\s+reading|read\s+on)\s*(?:please)?[.!?]*$/g, { kind: 'step', dir: 'next', unit: 'verse' }],
  // "take it back", "previous verse", "the verse before", "back one".
  [/\btake\s+(?:it|us|that|me)\s+back\b|\b(?:previous|preceding|prior)\s+(?:verses?|1)\b|\b(?:the\s+)?verse\s+before(?:\s+(?:that|this|it))?\b|\b(?:go|come|step)\s+back\s+(?:a|1|one)\s+verse\b|\bback\s+(?:1|one)\s+verse\b|\b(?:go|come)\s+back\s+(?:1|one)\b|\bback\s+(?:1|one)\b|\bthe\s+last\s+(?:1|one)\b/g, { kind: 'step', dir: 'prev', unit: 'verse' }],
  [/^(?:(?:okay|ok|alright|right|now|so|please)\s+)*(?:go\s+back|back\s+one|previous|previous\s+one)(?:\s+please)?[.!?]*$/g, { kind: 'step', dir: 'prev', unit: 'verse' }],
  // Repeat the currently displayed passage; this is not a previous-verse cue.
  [/^(?:(?:okay|ok|alright|right|now|please)\s+)*(?:read|show|repeat)\s+(?:that|it|this|the\s+verse)\s+again(?:\s+please)?[.!?]*$/g, { kind: 'repeat', deferInterim: true }],
  [/^(?:again|repeat)[.!?]*$/g, { kind: 'repeat' }],
  [/\b(?:the\s+)?(?:next|following)\s+chapter\b/g, { kind: 'step', dir: 'next', unit: 'chapter' }],
  [/\b(?:previous|preceding|prior)\s+chapter\b|\bchapter\s+before\s+(?:that|this|it)\b|\bgo\s+back\s+(?:a|one)\s+chapter\b/g, { kind: 'step', dir: 'prev', unit: 'chapter' }],
  // "chapter 5 verse 3", "verse 17", "verses 17 to 19".
  [/\b(?:chapters?\s+(\d{1,3})\s*(?:,|and)?\s*)?(?:verses?|versus|vs)\s+(\d{1,3})(?:\s*(?:to|through|thru|till|until|and|-|–)\s*(?:verses?\s+)?(\d{1,3}))?\b/g, 'goto'],
  // Reversed word order and number-only destinations: "take me to the 17th verse",
  // "go to verse 17", "go to 17". The latter must be at the end of the utterance.
  [/\b(?:go|take|move|jump)\s+(?:(?:me|us)\s+)?to\s+(?:the\s+)?(\d{1,3})\s+verses?\b/g, 'goto_reversed'],
  [/\b(?:go|take|move|jump)\s+(?:(?:me|us)\s+)?to\s+(?:the\s+)?(?:verse\s+)?(\d{1,3})\s*$/g, 'goto_number'],
];

function cue(text) {
  const t = normaliseCueText(text);
  let best = null;
  for (const [re, what] of CUES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(t))) {
      const end = m.index + m[0].length;
      if (best && best.end > end) continue;
      if (what === 'goto' || what === 'goto_reversed' || what === 'goto_number') {
        const verse = parseInt(what === 'goto' ? m[2] : m[1]);
        if (!verse) continue;
        const verseEnd = what === 'goto' && m[3] ? parseInt(m[3]) : undefined;
        const chapter = what === 'goto' && m[1] ? parseInt(m[1]) : undefined;
        // "go to 17" is intentionally accepted only as a completed utterance.
        if (what === 'goto_number' && (m.index + m[0].length) < t.trim().length) continue;
        best = { kind: 'goto', verse, ...(chapter ? { chapter } : {}), ...(verseEnd > verse ? { verseEnd: Math.min(verseEnd, verse + 9) } : {}), ...(what === 'goto_number' ? { deferInterim: true } : {}), end, atEnd: end >= t.trim().length };
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
  if (command.kind === 'repeat') {
    const verse = Number(current.verse);
    if (!Number.isInteger(verse) || verse < 1) return null;
    return {
      book: current.book,
      chapter: Number(current.chapter),
      verse,
      ...(Number(current.verseEnd) > Number(current.verse) ? { verseEnd: Number(current.verseEnd) } : {})
    };
  }
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
