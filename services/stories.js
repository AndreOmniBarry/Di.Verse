// Bible stories → where they are. "Remember Abraham sacrificing Isaac?" →
// Genesis 22:1–19, offered to the operator (never put up on its own) to show
// as a reference for note-takers or to open as a passage when the preacher
// goes there. Data: services/stories-data.js.
const { words } = require('./quoteMatch');
const DATA = require('./stories-data');

const REF = /^(.+?) (\d+):(\d+)(?:-(?:(\d+):)?(\d+))?$/;

// Each alternative becomes a list of word stems; several = a phrase, in order
const STORIES = DATA.map(s => {
  const m = s.ref.match(REF);
  return {
    title: s.title, ref: s.ref,
    book: m[1], chapter: +m[2], verse: +m[3], endChapter: m[4] ? +m[4] : +m[2], endVerse: m[5] ? +m[5] : +m[3],
    groups: s.keys.map(g => g.map(alt => words(alt))),
  };
});

function hasPhrase(seq, phrase) {
  if (phrase.length === 1) return seq.includes(phrase[0]);
  outer: for (let i = 0; i + phrase.length <= seq.length; i++) {
    for (let j = 0; j < phrase.length; j++) if (seq[i + j] !== phrase[j]) continue outer;
    return true;
  }
  return false;
}

// Stories whose every word group is heard in `text`, best first
function match(text) {
  const seq = words(text);
  if (seq.length < 3) return [];
  const out = [];
  for (const s of STORIES) {
    let hits = 0;
    const all = s.groups.every(g => { const n = g.filter(alt => hasPhrase(seq, alt)).length; hits += n; return n > 0; });
    if (all) out.push({ ...s, hits });
  }
  return out.sort((a, b) => b.groups.length - a.groups.length || b.hits - a.hits).slice(0, 2);
}

// The same story isn't offered again for 3 minutes (it's still being told)
const offered = new Map();
function fresh(list) {
  const now = Date.now();
  return list.filter(s => { const t = offered.get(s.title); if (t && now - t < 180000) return false; offered.set(s.title, now); return true; });
}

// How it's written on screen: "Genesis 22:1–19", "Genesis 6:9–9:17"
function display(s) {
  if (s.endChapter !== s.chapter) return `${s.book} ${s.chapter}:${s.verse}–${s.endChapter}:${s.endVerse}`;
  return s.endVerse !== s.verse ? `${s.book} ${s.chapter}:${s.verse}–${s.endVerse}` : `${s.book} ${s.chapter}:${s.verse}`;
}

module.exports = { match, fresh, display, STORIES, _reset: () => offered.clear() };
