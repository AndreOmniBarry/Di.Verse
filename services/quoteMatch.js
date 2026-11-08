// Recognises verses the preacher quotes without naming them
// ("I wish above all things that thou mayest prosper" → 3 John 1:2) by
// matching runs of words against the full KJV stored in bible.db.
// Offline, no AI, and a few milliseconds per sentence.
//
// Every verse is broken into overlapping 4-word phrases. Phrases found in
// many verses ("and it came to", "saith the lord of") are dropped, so what's
// left is specific: five matching phrases means about eight consecutive words
// quoted exactly, which pins the verse down.
const { getDb } = require('./bibleDb');

const SHINGLE = 4;
const COMMON_LIMIT = 25;   // phrase in more verses than this = too common to count
const STRONG_HITS = 5;     // ≈ 8 consecutive words quoted: confident enough to show
const WEAK_HITS = 4;       // ≈ 7 words: suggest, operator decides

let verses = null;  // [{ book, chapter, verse }]
let index = null;   // phrase -> array of verse ids

// Old and new wording meet in the middle: "which strengtheneth me" and
// "who strengthens me" both become "who strengthen me". Archaic words are
// mapped to modern ones and endings are trimmed, on the Bible text and on
// what was said alike.
const MODERN = {
  thou: 'you', thee: 'you', ye: 'you', thy: 'your', thine: 'your', unto: 'to', art: 'are',
  hath: 'has', hast: 'have', doth: 'does', dost: 'do', shalt: 'shall', wilt: 'will', saith: 'says',
  spake: 'spoke', which: 'who', whosoever: 'whoever', amongst: 'among', yea: 'yes', nay: 'no',
  shew: 'show', shewed: 'showed', wherefore: 'therefore', thereof: 'of', mine: 'my', whom: 'who',
};
function stem(w) {
  if (w.length > 4) {
    const m = w.match(/^(.{3,}?)(eth|est|ing|ed|es|s)$/);
    if (m) w = m[1];
  }
  return w.length > 3 ? w.replace(/e$/, '') : w;
}
function words(text) {
  return String(text).toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => stem(MODERN[w] || w));
}

function phrases(ws) {
  const out = new Set();
  for (let i = 0; i + SHINGLE <= ws.length; i++) out.add(ws.slice(i, i + SHINGLE).join(' '));
  return out;
}

function build() {
  const rows = getDb().prepare(`SELECT book, chapter, verse, text FROM verses WHERE translation = 'KJV' ORDER BY book_num, chapter, verse`).all();
  verses = [];
  index = new Map();
  for (const r of rows) {
    const id = verses.length;
    verses.push({ book: r.book, chapter: r.chapter, verse: r.verse });
    for (const p of phrases(words(r.text))) {
      const list = index.get(p);
      if (list) list.push(id); else index.set(p, [id]);
    }
  }
  for (const [p, list] of index) if (list.length > COMMON_LIMIT) index.delete(p);
  console.log(`[Quotes] Indexed ${verses.length} KJV verses for quote matching`);
}

// Builds the index in the background at startup so the first sermon
// sentence doesn't pay for it
function warmUp() {
  setImmediate(() => { try { if (!index) build(); } catch (err) { console.error('[Quotes] Index failed:', err.message); } });
}

// Returns the best matching verse(s): [{ book, chapter, verse, hits, strong }]
// Empty when nothing is quoted. Two equally good matches (parallel passages)
// are both returned and neither is marked strong.
function match(text) {
  if (!index) build();
  if (!verses.length) return [];
  const counts = new Map();
  for (const p of phrases(words(text))) {
    const ids = index.get(p);
    if (!ids) continue;
    for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
  }
  const ranked = [...counts.entries()]
    .filter(([, hits]) => hits >= WEAK_HITS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  if (!ranked.length) return [];
  const top = ranked[0][1];
  const tied = ranked.filter(([, hits]) => hits === top).length > 1;
  return ranked
    .filter(([, hits]) => hits >= top - 1)
    .slice(0, 2)
    .map(([id, hits]) => ({ ...verses[id], hits, strong: !tied && hits === top && hits >= STRONG_HITS }));
}

module.exports = { match, warmUp, words, _reset: () => { verses = null; index = null; } };
