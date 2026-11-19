// Listening harder, the way people do when they didn't quite catch something:
// keep what was half-heard for a few seconds and let what comes next complete it.
//
//  · A book named without numbers ("turn to Romans…") waits 20 s for them:
//    "…chapter eight verse twenty eight" → Romans 8:28, whatever is on screen.
//  · A reference that couldn't be right ("Genesis 32:36") keeps its likely
//    readings for 30 s; if the next words point to one of them — the preacher
//    starts reading it, or says it again — that one goes up.
// One listener at a time (the Operator page that's listening), so one memory.
const BOOK_MS = 20000;
const CANDIDATES_MS = 30000;
let book = null, bookAt = 0, candidates = [], candidatesAt = 0;

function noteBook(name) { book = name; bookAt = Date.now(); }
function pendingBook() { return book && Date.now() - bookAt < BOOK_MS ? book : null; }
function clearBook() { book = null; }

function noteCandidates(list) { candidates = list.map(c => ({ book: c.book, chapter: c.chapter, verse: c.verse })); candidatesAt = Date.now(); }
// The first of `refs` that completes a pending reference, or null
function completes(refs) {
  if (!candidates.length || Date.now() - candidatesAt > CANDIDATES_MS) return null;
  for (const r of refs || []) {
    if (candidates.some(c => c.book === r.book && c.chapter === r.chapter && c.verse === r.verse)) { candidates = []; return r; }
  }
  return null;
}

function pending() { return candidates.length && Date.now() - candidatesAt <= CANDIDATES_MS ? candidates.slice() : []; }

module.exports = { noteBook, pendingBook, clearBook, noteCandidates, completes, pending, _reset: () => { book = null; candidates = []; } };
