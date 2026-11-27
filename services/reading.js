// Reading through: is the preacher reading aloud the passage on screen, or
// has the reading moved on into the next verse?
//
// While the verse on screen is being read, nothing else may replace it: its
// words also appear in parallel passages (Mark 9:9 / Matthew 17:9) and in
// other verses, and those must not interrupt the reading. When the words
// being read belong to the next verse, the screen follows the reading there.
//
// Words are compared the way quoteMatch does it (old and new wording
// meeting in the middle), using the KJV and the translation on screen, so
// "thee" and "you", "sowed" and "sowes" count as the same word.
const { getDb } = require('./bibleDb');
const { words } = require('./quoteMatch');

const STOP = new Set(['the', 'and', 'of', 'to', 'a', 'in', 'that', 'he', 'it', 'is', 'for', 'be', 'shall', 'his', 'they', 'them', 'you', 'your', 'my', 'me', 'we', 'us', 'with', 'not', 'all', 'who', 'this', 'him', 'but', 'from', 'as', 'are', 'was', 'were', 'have', 'has', 'will', 'so', 'on', 'at', 'by', 'or', 'i', 'an', 'which', 'what']);

function verseTexts(book, chapter, from, to, translation) {
  const db = getDb();
  const rows = db.prepare(`SELECT verse, translation, text FROM verses WHERE book = ? AND chapter = ? AND verse BETWEEN ? AND ? AND translation IN ('KJV', ?)`)
    .all(book, chapter, from, to, String(translation || 'KJV').toUpperCase());
  return rows;
}

function grams(ws, n) {
  const out = new Set();
  for (let i = 0; i + n <= ws.length; i++) out.add(ws.slice(i, i + n).join(' '));
  return out;
}

// How much of what was said is in this text: 3-word runs in common, and
// share of the said content words that the text contains
function overlap(saidWords, text) {
  const tw = words(text);
  const tg = grams(tw, 3);
  let runs = 0;
  for (const g of grams(saidWords, 3)) if (tg.has(g)) runs++;
  const content = saidWords.filter(w => !STOP.has(w) && w.length > 2);
  const tset = new Set(tw);
  const share = content.length ? content.filter(w => tset.has(w)).length / content.length : 0;
  return { runs, share, content: content.length };
}

const isReading = o => o.runs >= 2 || (o.content >= 3 && o.share >= 0.6 && o.runs >= 1);

// current: { book, chapter, verse, verseEnd?, translation }
// Returns { state: 'current' | 'next' | null, next?: { book, chapter, verse } }
function relation(text, current) {
  if (!current || !current.book || !current.chapter || !current.verse) return { state: null };
  const said = words(text).slice(-24);           // what was just said
  if (said.length < 3) return { state: null };
  const last = current.verseEnd || current.verse;
  const best = rows => rows.map(r => overlap(said, r.text)).sort((a, b) => b.runs - a.runs || b.share - a.share)[0] || { runs: 0, share: 0, content: 0 };
  const onScreen = best(verseTexts(current.book, current.chapter, current.verse, last, current.translation));
  // the next verse may be in the next chapter (or book)
  const nextRef = require('./navigation').step({ book: current.book, chapter: current.chapter, verse: current.verse, verseEnd: last }, 'next');
  const next = nextRef ? best(verseTexts(nextRef.book, nextRef.chapter, nextRef.verse, nextRef.verse, current.translation)) : { runs: 0, share: 0, content: 0 };
  // the reading has moved into the next verse: more of its words than the
  // current one's in what was just said (its opening, typically)
  if (isReading(next) && next.runs > onScreen.runs) return { state: 'next', next: nextRef };
  if (isReading(onScreen)) return { state: 'current' };
  return { state: null };
}

// Does what was said match this verse's words? (for completing a half-heard
// reference: only a few candidates, so a short match is enough)
function matches(text, book, chapter, verse, translation) {
  const said = words(text);
  if (said.length < 3) return false;
  return verseTexts(book, chapter, verse, verse, translation).some(r => isReading(overlap(said, r.text)));
}

module.exports = { relation, matches };
