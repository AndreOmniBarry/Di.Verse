// Finds the verse someone is talking about from the words they use, not
// just exact quotes: "the man Isaac sowed in the land" → Genesis 26:12.
//
// Every KJV verse is indexed by its telling words (archaic forms mapped to
// modern ones and endings trimmed, as in quoteMatch). A sentence is scored
// against them with rare words counting most (Isaac, sowed, hundredfold)
// and common ones barely at all (land, man, said). Speech-to-text often
// mishears Bible words ("sowed" → "sold", "waxed" → "wasp"), so each spoken
// word also counts, more weakly, for Bible words that look and sound like it.
// Offline, no AI, a few milliseconds.
const { getDb } = require('./bibleDb');
const { words } = require('./quoteMatch');

const STOP = new Set(('the and of to in that he i a it is for be shall his they them you your my me we us our with not all was who this him ' +
  'but from as are have has will so on at by then there their what when were an or if no yes out up also upon do does did had her she ' +
  'its into than these those thing one now come came let say says said go went unto thee thou ye thy o oh am an any can could would should ' +
  'um uh okay ok yeah church please amen hallelujah alright right know just like gonna wanna really very because about been being ' +
  'here where how why more most some such only own same other another every each again over under even well').split(' ').map(w => words(w)[0]).filter(Boolean));

let verses = null;   // [{ book, chapter, verse, len }]
let postings = null; // stem -> Int32Array of verse ids
let idf = null;      // stem -> weight
let vocab = null;    // [stem] (for near matches)
let avgLen = 1;

function contentWords(text) { return words(text).filter(w => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w)); }

// Modern wording too: preachers quote the NIV / NKJV as often as the KJV.
// A free modern translation stored on this computer (BSB reads close to the
// NIV; WEB otherwise) adds its words to each verse, so "who gives me
// strength" finds Philippians 4:13 as well as "which strengtheneth me".
function modernTexts() {
  const db = getDb();
  for (const code of ['BSB', 'WEB', 'MSB']) {
    const n = db.prepare('SELECT COUNT(*) AS n FROM verses WHERE translation = ?').get(code).n;
    if (n > 30000) {
      const map = new Map();
      for (const r of db.prepare('SELECT book, chapter, verse, text FROM verses WHERE translation = ?').all(code)) map.set(r.book + '|' + r.chapter + '|' + r.verse, r.text);
      return { code, map };
    }
  }
  return null;
}

function build() {
  const rows = getDb().prepare(`SELECT book, chapter, verse, text FROM verses WHERE translation = 'KJV' ORDER BY book_num, chapter, verse`).all();
  const modern = modernTexts();
  verses = [];
  const lists = new Map();
  let total = 0;
  for (const r of rows) {
    const id = verses.length;
    const extra = modern && modern.map.get(r.book + '|' + r.chapter + '|' + r.verse);
    const ws = contentWords(r.text + (extra ? ' ' + extra : ''));
    const distinct = new Set(ws).size;          // KJV and modern wording share most words: count each once
    verses.push({ book: r.book, chapter: r.chapter, verse: r.verse, len: distinct || 1 });
    total += distinct;
    for (const w of new Set(ws)) { const l = lists.get(w); if (l) l.push(id); else lists.set(w, [id]); }
  }
  avgLen = total / Math.max(1, verses.length);
  postings = new Map(); idf = new Map();
  const N = verses.length;
  for (const [w, l] of lists) {
    postings.set(w, Int32Array.from(l));
    idf.set(w, Math.log(1 + (N - l.length + 0.5) / (l.length + 0.5)));
  }
  vocab = [...postings.keys()];
  console.log(`[Finder] Indexed ${N} verses (KJV${modern ? ' + ' + modern.code : ''} wording), ${vocab.length} word stems`);
}

function warmUp() { setImmediate(() => { try { if (!postings) build(); } catch (err) { console.error('[Finder] Index failed:', err.message); } }); }

// Edit distance, capped (stops early once over max)
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// A spoken word → Bible words it may be: itself, plus near spellings that
// start with the same letter ("sold" → "sow", "wasp" → "wax")
const nearCache = new Map();
function variants(w) {
  if (nearCache.has(w)) return nearCache.get(w);
  const out = [];
  if (postings.has(w)) out.push([w, 1]);
  if (w.length >= 3) {
    const max = w.length >= 5 ? 2 : (w.length >= 4 ? 2 : 1);
    for (const v of vocab) {
      if (v === w || v[0] !== w[0] || v.length < 3) continue;
      const d = distance(w, v, max);
      if (d <= max) out.push([v, d === 1 ? 0.55 : 0.3]);
    }
  }
  if (nearCache.size > 5000) nearCache.clear();
  nearCache.set(w, out);
  return out;
}

// Returns up to `limit` verses: [{ book, chapter, verse, score, confidence, matched }]
// confidence (0–1): how much of what was said is explained by the verse,
// weighted by how telling each word is.
function find(text, limit = 5) {
  if (!postings) build();
  const said = [...new Set(contentWords(text))].slice(-40);
  if (!said.length) return [];
  const scores = new Map(); // id -> { s, m: Map(word -> weight) }
  let possible = 0;
  for (const w of said) {
    const vs = variants(w);
    if (!vs.length) continue;
    const top = Math.max(...vs.map(([v, k]) => idf.get(v) * k));
    possible += Math.min(top, idf.get(vs[0][0]) || top);
    const seen = new Map(); // id -> best contribution for this spoken word
    for (const [v, k] of vs) {
      const weight = idf.get(v) * k;
      if (weight < 0.8) continue; // common words through a near match: noise
      for (const id of postings.get(v)) if ((seen.get(id) || 0) < weight) seen.set(id, weight);
    }
    for (const [id, weight] of seen) {
      let e = scores.get(id);
      if (!e) scores.set(id, e = { s: 0, n: 0 });
      e.s += weight; e.n++;
    }
  }
  if (!possible) return [];
  const ranked = [];
  for (const [id, e] of scores) {
    if (e.n < 2 && said.length > 1) continue;
    const v = verses[id];
    // short verses that are fully said shouldn't lose to long ones that merely contain the words
    const lenNorm = 0.75 + 0.25 * (v.len / avgLen);
    ranked.push({ id, score: e.s / lenNorm, raw: e.s, n: e.n });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit).map(r => ({ book: verses[r.id].book, chapter: verses[r.id].chapter, verse: verses[r.id].verse,
    score: Math.round(r.score * 100) / 100, confidence: Math.round(Math.min(1, r.raw / possible) * 100) / 100, words: r.n, len: verses[r.id].len }));
}

// How sure a result is, for live use:
//   'strong'  — show it like a named reference (many telling words, well
//               ahead of the next best verse)
//   'suggest' — offer it in the queue for the operator to confirm
//   null      — not enough to go on
// Tuned on paraphrases, misheard words and ordinary church talk
// (test/verseFinder.test.js).
function judge(results) {
  const [a, b] = results;
  if (!a) return null;
  const margin = b ? a.score / b.score : 9;
  if (a.score >= 22 && a.confidence >= 0.85 && a.words >= 5 && margin >= 1.5) return 'strong';
  if (a.score >= 14.5 && a.confidence >= 0.75 && a.words >= 3) return 'suggest';
  if (a.words === 2 && a.confidence === 1 && a.score >= 12 && margin >= 1.2) return 'suggest'; // short verses: "Jesus wept"
  // the whole of a very short verse was said ("Jesus wept" is all of John 11:35)
  if (a.words >= 2 && a.confidence === 1 && a.len <= a.words && a.score >= 9) return 'suggest';
  return null;
}

function verseText(book, chapter, verse) {
  const row = getDb().prepare(`SELECT text FROM verses WHERE translation = 'KJV' AND book = ? AND chapter = ? AND verse = ?`).get(book, chapter, verse);
  return row && row.text;
}

module.exports = { find, judge, verseText, warmUp, contentWords, _reset: () => { postings = null; nearCache.clear(); } };
