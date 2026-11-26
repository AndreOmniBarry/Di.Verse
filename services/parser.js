/**
 * Di.Verse Local Bible Reference Parser
 * Runs in under 50ms, zero network, zero cost.
 * Handles 80%+ of all real-world sermon references.
 */

const BOOK_MAP = {
  'genesis':1,'gen':1,'ge':1,
  'exodus':2,'exo':2,'ex':2,
  'leviticus':3,'lev':3,
  'numbers':4,'num':4,'nu':4,
  'deuteronomy':5,'deu':5,'deut':5,'dt':5,
  'joshua':6,'jos':6,'josh':6,
  'judges':7,'jdg':7,'jug':7,
  'ruth':8,'rut':8,
  '1 samuel':9,'1samuel':9,'1sam':9,'1sa':9,'first samuel':9,
  '2 samuel':10,'2samuel':10,'2sam':10,'2sa':10,'second samuel':10,
  '1 kings':11,'1kings':11,'1ki':11,'first kings':11,
  '2 kings':12,'2kings':12,'2ki':12,'second kings':12,
  '1 chronicles':13,'1chronicles':13,'1ch':13,'first chronicles':13,
  '2 chronicles':14,'2chronicles':14,'2ch':14,'second chronicles':14,
  'ezra':15,'ezr':15,
  'nehemiah':16,'neh':16,
  'esther':17,'est':17,
  'job':18,
  'psalms':19,'psalm':19,'psa':19,'ps':19,
  'proverbs':20,'pro':20,'prov':20,
  'ecclesiastes':21,'ecc':21,'eccl':21,
  'song of solomon':22,'song':22,'sos':22,'song of songs':22,
  'isaiah':23,'isa':23,
  'jeremiah':24,'jer':24,
  'lamentations':25,'lam':25,
  'ezekiel':26,'eze':26,'ezk':26,
  'daniel':27,'dan':27,
  'hosea':28,'hos':28,
  'joel':29,
  'amos':30,
  'obadiah':31,'oba':31,'ob':31,
  'jonah':32,'jon':32,
  'micah':33,'mic':33,
  'nahum':34,'nah':34,
  'habakkuk':35,'hab':35,
  'zephaniah':36,'zep':36,
  'haggai':37,'hag':37,
  'zechariah':38,'zec':38,'zech':38,
  'malachi':39,'mal':39,
  'matthew':40,'mat':40,'matt':40,'mt':40,
  'mark':41,'mar':41,'mrk':41,'mk':41,
  'luke':42,'luk':42,'lk':42,
  'john':43,'joh':43,'jn':43,
  'acts':44,'act':44,
  'romans':45,'rom':45,
  '1 corinthians':46,'1corinthians':46,'1co':46,'1cor':46,'first corinthians':46,
  '2 corinthians':47,'2corinthians':47,'2co':47,'2cor':47,'second corinthians':47,
  'galatians':48,'gal':48,
  'ephesians':49,'eph':49,
  'philippians':50,'phi':50,'php':50,'phil':50,
  'colossians':51,'col':51,
  '1 thessalonians':52,'1thessalonians':52,'1th':52,'first thessalonians':52,
  '2 thessalonians':53,'2thessalonians':53,'2th':53,'second thessalonians':53,
  '1 timothy':54,'1timothy':54,'1ti':54,'1tim':54,'first timothy':54,
  '2 timothy':55,'2timothy':55,'2ti':55,'2tim':55,'second timothy':55,
  'titus':56,'tit':56,
  'philemon':57,'phm':57,
  'hebrews':58,'heb':58,
  'james':59,'jam':59,'jas':59,
  '1 peter':60,'1peter':60,'1pe':60,'1pet':60,'first peter':60,
  '2 peter':61,'2peter':61,'2pe':61,'2pet':61,'second peter':61,
  '1 john':62,'1john':62,'1jo':62,'1joh':62,'first john':62,
  '2 john':63,'2john':63,'2jo':63,'second john':63,
  '3 john':64,'3john':64,'3jo':64,'third john':64,
  'jude':65,
  'revelation':66,'rev':66,'revel':66,'revelations':66,
};

const BOOK_NAMES = {
  1:'Genesis',2:'Exodus',3:'Leviticus',4:'Numbers',5:'Deuteronomy',
  6:'Joshua',7:'Judges',8:'Ruth',9:'1 Samuel',10:'2 Samuel',
  11:'1 Kings',12:'2 Kings',13:'1 Chronicles',14:'2 Chronicles',
  15:'Ezra',16:'Nehemiah',17:'Esther',18:'Job',19:'Psalms',20:'Proverbs',
  21:'Ecclesiastes',22:'Song of Solomon',23:'Isaiah',24:'Jeremiah',
  25:'Lamentations',26:'Ezekiel',27:'Daniel',28:'Hosea',29:'Joel',
  30:'Amos',31:'Obadiah',32:'Jonah',33:'Micah',34:'Nahum',
  35:'Habakkuk',36:'Zephaniah',37:'Haggai',38:'Zechariah',39:'Malachi',
  40:'Matthew',41:'Mark',42:'Luke',43:'John',44:'Acts',45:'Romans',
  46:'1 Corinthians',47:'2 Corinthians',48:'Galatians',49:'Ephesians',
  50:'Philippians',51:'Colossians',52:'1 Thessalonians',53:'2 Thessalonians',
  54:'1 Timothy',55:'2 Timothy',56:'Titus',57:'Philemon',58:'Hebrews',
  59:'James',60:'1 Peter',61:'2 Peter',62:'1 John',63:'2 John',
  64:'3 John',65:'Jude',66:'Revelation',
};

const TRANSLATION_MAP = {
  'kjv':'KJV','king james':'KJV','king james version':'KJV','king james bible':'KJV',
  'nkjv':'NKJV','new king james':'NKJV','new king james version':'NKJV',
  'amp':'AMP','amplified':'AMP','amplified bible':'AMP',
  'ampc':'AMPC','amplified classic':'AMPC','classic amplified':'AMPC',
  'tpt':'TPT','passion':'TPT','the passion':'TPT','passion translation':'TPT',
  'the passion translation':'TPT','departure translation':'TPT',
  'msg':'MSG','message':'MSG','the message':'MSG','message bible':'MSG',
  'phillips':'PHILLIPS','phillips translation':'PHILLIPS','phillips new testament':'PHILLIPS',
  'j b phillips':'PHILLIPS','jb phillips':'PHILLIPS','new testament in modern english':'PHILLIPS',
  'gnt':'GNT','good news':'GNT','good news translation':'GNT','good news bible':'GNT',
  'tlb':'TLB','living bible':'TLB','the living bible':'TLB',
  'niv':'NIV','new international':'NIV','new international version':'NIV',
  'esv':'ESV','english standard':'ESV','english standard version':'ESV',
  'nlt':'NLT','new living':'NLT','new living translation':'NLT',
  'nasb':'NASB','new american standard':'NASB',
  'csb':'CSB','christian standard':'CSB',
  'cev':'CEV','contemporary english':'CEV',
  'ncv':'NCV','new century':'NCV',
  'hcsb':'HCSB','holman':'HCSB',
  'asv':'ASV','american standard':'ASV',
  'web':'WEB','world english':'WEB',
  'ylt':'YLT',"young's literal":'YLT','youngs literal':'YLT','young literal':'YLT',
  'bbe':'BBE','basic english':'BBE','bible in basic english':'BBE',
  'american standard version':'ASV',
  'nrsv':'NRSV','new revised standard':'NRSV','rsv':'RSV','revised standard':'RSV',
};

const NUMBER_WORDS = {
  'one':1,'two':2,'three':3,'four':4,'five':5,'six':6,'seven':7,'eight':8,
  'nine':9,'ten':10,'eleven':11,'twelve':12,'thirteen':13,'fourteen':14,
  'fifteen':15,'sixteen':16,'seventeen':17,'eighteen':18,'nineteen':19,
  'twenty':20,'thirty':30,'forty':40,'fifty':50,'sixty':60,'seventy':70,
  'eighty':80,'ninety':90,'first':1,'second':2,'third':3,
};

function wordToNum(str) {
  const s = str.toLowerCase().trim();
  if (/^\d+$/.test(s)) return parseInt(s);
  if (NUMBER_WORDS[s] !== undefined) return NUMBER_WORDS[s];
  const parts = s.split(/\s+/);
  if (parts.length === 2 && NUMBER_WORDS[parts[0]] && NUMBER_WORDS[parts[1]]) {
    return NUMBER_WORDS[parts[0]] + NUMBER_WORDS[parts[1]];
  }
  return null;
}

// Cardinal number words only — ordinals (first/second/third) stay as words so
// book names like "First Corinthians" still resolve.
const CARDINALS = Object.fromEntries(
  Object.entries(NUMBER_WORDS).filter(([w]) => !['first', 'second', 'third'].includes(w))
);

// Rewrites spelled-out numbers as digits: "one hundred and five" -> "105",
// "twenty three" -> "23". Speech-to-text often spells numbers out, and the
// reference patterns below only read the first word of a phrase otherwise.
function normaliseNumbers(text) {
  const tokens = text.split(/(\s+)/);
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    const word = tokens[i].toLowerCase().replace(/-/g, ' ');
    const isNumWord = w => CARDINALS[w] !== undefined || w === 'hundred';
    if (!isNumWord(word) && !(word === 'a' && (tokens[i + 2] || '').toLowerCase() === 'hundred')) {
      out.push(tokens[i]); i++; continue;
    }
    let total = 0, current = 0, j = i, lastNumIdx = i;
    while (j < tokens.length) {
      const w = tokens[j].toLowerCase();
      if (/^\s+$/.test(tokens[j])) { j++; continue; }
      if (w === 'a' && j === i) { current = 1; lastNumIdx = j; j++; continue; }
      if (w === 'hundred') { current = (current || 1) * 100; lastNumIdx = j; j++; continue; }
      // "and" only joins numbers after "hundred" ("one hundred and five")
      if (w === 'and' && current >= 100 && CARDINALS[(tokens[j + 2] || '').toLowerCase()] !== undefined) { j++; continue; }
      if (CARDINALS[w] !== undefined) {
        const n = CARDINALS[w];
        // "twenty three" combines; "three sixteen" is two separate numbers
        if (current % 100 !== 0 && !(current % 10 === 0 && current % 100 >= 20 && n < 10)) break;
        if (current % 100 >= 20 && n >= 10) break;
        current += n; lastNumIdx = j; j++; continue;
      }
      break;
    }
    total += current;
    out.push(String(total));
    i = lastNumIdx + 1;
  }
  return out.join('');
}

function resolveBook(raw) {
  if (!raw) return null;
  let lower = raw.toLowerCase().trim()
    .replace(/\s+/g, ' ')
    .replace(/^(the\s+|book\s+of\s+)/i, '')
    .trim();
  // Normalize numbered prefixes: "1st" -> "1", "2nd" -> "2"
  lower = lower.replace(/^(1st|first)\s+/, '1 ').replace(/^(2nd|second)\s+/, '2 ').replace(/^(3rd|third)\s+/, '3 ');

  if (BOOK_MAP[lower] !== undefined) {
    return { num: BOOK_MAP[lower], name: BOOK_NAMES[BOOK_MAP[lower]] };
  }
  // Partial book name, e.g. "revel", "1 corinthian" — the spoken word must be a
  // prefix of exactly one full book name. Never the reverse: "reverend" must
  // not resolve to Revelation just because it starts with "rev".
  if (lower.length >= 3) {
    const hits = Object.entries(BOOK_NAMES).filter(([, name]) => name.toLowerCase().startsWith(lower));
    if (hits.length === 1) return { num: Number(hits[0][0]), name: hits[0][1] };
  }
  return null;
}

// The reference patterns capture every word before the numbers ("the gospel of
// John"), so try the trailing 1-4 words, longest first, to find the book name.
function resolveBookTail(raw) {
  const words = raw.trim().split(/\s+/);
  for (let n = Math.min(4, words.length); n >= 1; n--) {
    const book = resolveBook(words.slice(-n).join(' '));
    if (book) return book;
  }
  return null;
}

// Translation names can also be ordinary sermon words ("the message", "the voice",
// "good news", "the web"). These only count when the speaker clearly asks for
// that version, not when the same words occur naturally in a sermon.
const AMBIGUOUS = new Set([
  'message', 'the message', 'good news', 'passion', 'the passion', 'web', 'amp',
  'living bible', 'the living bible', 'american standard', 'world english',
  'basic english', 'voice', 'the voice', 'net', 'we', 'common english',
  'new living', 'revised standard', 'modern english'
]);
const AMBIGUOUS_CODES = new Set(['AMP', 'GW', 'NET', 'VOICE', 'WE', 'WEB']);

const escapeRe = str => str.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');

function normaliseTranslationPhrase(value) {
  return String(value || '').toLowerCase()
    .replace(/[’']/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\\s+/g, ' ')
    .trim();
}

// Include every translation actually installed in bible.db. Names come from
// translation_meta, so a newly imported edition becomes speakable without a
// second hand-maintained list in this parser.
function buildTranslationPatterns() {
  const aliases = new Map();
  const add = (phrase, code, requiresCue = false) => {
    const key = normaliseTranslationPhrase(phrase);
    if (!key) return;
    const existing = aliases.get(key);
    if (existing) {
      if (existing.code !== code) {
        existing.conflicted = true;
        return;
      }
      existing.requiresCue = existing.requiresCue && requiresCue;
      return;
    }
    aliases.set(key, { code, requiresCue: requiresCue || AMBIGUOUS.has(key), conflicted: false });
  };

  for (const [phrase, code] of Object.entries(TRANSLATION_MAP)) {
    add(phrase, code, AMBIGUOUS.has(normaliseTranslationPhrase(phrase)));
  }

  try {
    const { localTranslations } = require('./bibleDb');
    for (const [rawCode, rawName] of Object.entries(localTranslations())) {
      const code = String(rawCode).trim().toUpperCase();
      if (!code) continue;

      add(code, code, AMBIGUOUS_CODES.has(code) || code.length <= 2);

      // ASR may insert a space in suffixes/numbers: "NIV UK", "RSV CE", "KJ 21".
      const spacedSuffix = code
        .replace(/([A-Z])([0-9]+)/g, '$1 $2')
        .replace(/^([A-Z]{2,})(UK|US|CE)$/, '$1 $2');
      if (spacedSuffix !== code) add(spacedSuffix, code, AMBIGUOUS_CODES.has(code) || code.length <= 2);

      // Also accept letter-by-letter output ("N I V"), but only after a cue.
      if (/^[A-Z]{3,6}$/.test(code)) add(code.split('').join(' '), code, true);

      // Drop parenthetical catalogue notes such as "(1901)" from the spoken name.
      const name = String(rawName || '').replace(/\\([^)]*\\)/g, ' ');
      const namePhrase = normaliseTranslationPhrase(name);
      if (namePhrase) add(namePhrase, code, namePhrase.split(' ').length === 1);
    }
  } catch (error) {
    // Reference parsing remains usable if the local catalogue is unavailable.
  }

  return [...aliases.entries()]
    .filter(([, item]) => !item.conflicted)
    .sort((a, b) => b[0].length - a[0].length)
    .map(([phrase, item]) => {
      const escaped = phrase.split(' ').map(escapeRe).join('\\\\s+');
      if (!item.requiresCue) return { code: item.code, re: new RegExp('\\\\b' + escaped + '\\\\b') };

      const base = phrase.replace(/^the\\s+/, '').split(' ').map(escapeRe).join('\\\\s+');
      return {
        code: item.code,
        re: new RegExp(
          '\\\\b' + base + '\\\\s+(?:bible|translation|version|edition)\\\\b' +
          '|\\\\b(?:in|from|using|with|switch(?:ing)?\\\\s+to|read(?:ing)?\\\\s+from|turn(?:ing)?\\\\s+to|use)\\\\s+(?:the\\\\s+)?' + base + '\\\\s*$'
        )
      };
    });
}

function detectTranslation(text) {
  const lower = normaliseTranslationPhrase(text);
  for (const { code, re } of buildTranslationPatterns()) {
    if (re.test(lower)) return code;
  }
  return null;
}

// ── Finding references in what was said ──
//
// One pass over the words. At each word, see whether a book name starts there
// (up to 4 words: "1 John", "Song of Solomon", "the gospel of John"), then
// read the numbers that follow in any of the ways pastors say them:
//   John 3:16 · John 3 16 · John 3 verse 16 · John chapter 3 verse 16 ·
//   John 3 and 16 · John 3 vs 16 · John 3 versus 16 (captions) · John 3, from verse 16
//   ranges: 16-18 · 16 to 18 · through 18 · 16 and 17 · verses 5 and 6
//   one number: Psalm 23 → 23:1 · Jude 3 / 3 John 2 → verse 3 / 2 (one-chapter books)
//   run-together numbers from captions: John 316 → 3:16 · Romans 828 → 8:28
// Every reference in the sentence is returned, in order.

// Chapters in each book (1–66), for one-chapter books and splitting run-together numbers
const CHAPTERS = [0, 50, 40, 27, 36, 34, 24, 21, 4, 31, 24, 22, 25, 29, 36, 10, 13, 10, 42, 150, 31, 12, 8, 66, 52, 5, 48, 12, 14, 3, 9, 1, 4, 7, 3, 3, 3, 2, 14, 4,
  28, 16, 24, 21, 28, 16, 16, 13, 6, 6, 4, 4, 5, 3, 6, 4, 3, 1, 13, 5, 5, 3, 5, 1, 1, 1, 22];

// Verses per chapter, from the local Bible database when there is one
let verseCounts;
function maxVerse(bookName, chapter) {
  if (verseCounts === undefined) {
    try {
      verseCounts = new Map();
      for (const r of require('./bibleDb').getDb().prepare('SELECT book, chapter, max_verse FROM bible_structure').all()) verseCounts.set(r.book + '|' + r.chapter, r.max_verse);
      if (!verseCounts.size) verseCounts = null;
    } catch (e) { verseCounts = null; }
  }
  return verseCounts ? verseCounts.get(bookName + '|' + chapter) || 0 : 176;
}
function exists(book, chapter, verse) {
  return chapter >= 1 && chapter <= CHAPTERS[book.num] && verse >= 1 && verse <= maxVerse(book.name, chapter);
}

// Book names that are also everyday words or first names. Alone with one
// number ("mark 2 things", "John 3 times") they need a cue to count as a
// reference: "chapter", or "turn to / open / read / in / book of…" before them.
const COMMON_WORD_BOOKS = new Set(['mark', 'john', 'james', 'acts', 'act', 'job', 'numbers', 'ruth', 'amos', 'jude', 'joel', 'titus', 'daniel', 'luke', 'jonah', 'micah', 'song', 'ezra', 'esther', 'hosea', 'nahum', 'mar', 'jon', 'pro', 'lam', 'num', 'gen', 'col', 'gal', 'dan', 'mal', 'hag', 'tit', 'jam', 'heb', 'rev', 'phil', 'mat', 'matt', 'eph']);
const CUE_BEFORE = new Set(['in', 'of', 'from', 'open', 'read', 'reading', 'chapter', 'book', 'gospel', 'says', 'said', 'see', 'unto']);
const TO_AFTER = new Set(['turn', 'open', 'go', 'back', 'over', 'bibles', 'bible', 'flip', 'me', 'us', 'move', 'come']); // "turn to", "go with me to"

// Is the word before token i a sign that a reference follows?
function cuedAt(tokens, i) {
  const prev = tokens[i - 1];
  if (CUE_BEFORE.has(prev)) return true;
  if (prev === 'to' || prev === 'at') return tokens.slice(Math.max(0, i - 4), i - 1).some(w => TO_AFTER.has(w) || w === 'look');
  return false;
}

const VERSE_WORD = new Set(['verse', 'verses', 'vs', 'v', 'vv', 'versus', 'vers', 'vss']);
const CHAPTER_WORD = new Set(['chapter', 'chapters', 'ch', 'chap', 'chapt']);
const RANGE_WORD = new Set(['-', '–', 'to', 'through', 'thru', 'till', 'until', 'unto']);
const LEAD_IN = new Set(['and', 'from', 'at', 'starting', 'beginning', 'reading']); // "chapter 8, from verse 28"
const MAX_RANGE = 10; // verses on one screen

const isNum = t => t !== undefined && /^\d{1,4}$/.test(t);

function tokenize(clean) {
  return clean.match(/\d+(?:st|nd|rd|th)\b|\d+|[a-z']+|[:\-–]/g) || [];
}

// The longest book name that starts at token i: { book, next }
function bookAt(tokens, i) {
  for (let n = 4; n >= 1; n--) {
    const words = tokens.slice(i, i + n);
    if (words.length < n || words.some(w => /^[:\-–]$/.test(w))) continue;
    if (n > 1 && isNum(words[n - 1])) continue;
    if (isNum(words[0]) && !(n > 1 && /^[1-3]$/.test(words[0]))) continue; // a number only as "1 John"
    const book = resolveBook(words.join(' '));
    if (book) return { book: { ...book, spoken: words.join(' ').replace(/^(the|book of|the book of)\s+/, '') }, next: i + n };
  }
  return null;
}

// Reads the numbers after a book starting at token j.
// Returns { chapter, verse, verseEnd, confidence, next, chapterOnly, alternatives } or null.
function readNumbers(tokens, j, book, cued) {
  const one = CHAPTERS[book.num] === 1;
  let k = j, sawChapterWord = false;
  if (CHAPTER_WORD.has(tokens[k])) { sawChapterWord = true; k++; }
  // one-chapter book: "Jude verse 3", "3 John verse 2"
  if (one && VERSE_WORD.has(tokens[k]) && isNum(tokens[k + 1])) return finish(1, +tokens[k + 1], k + 2, 0.93);
  if (!isNum(tokens[k])) return null;
  const n1 = +tokens[k];
  k++;

  // the second number, after a separator
  let m = k, sep = null;
  if (tokens[m] === ':' ) { sep = ':'; m++; }
  else if ((tokens[m] === '-' || tokens[m] === '–') && isNum(tokens[m + 1]) && !one) { sep = ':'; m++; }        // "Psalm 1-1"
  else {
    let p = m;
    while (LEAD_IN.has(tokens[p]) && p < m + 2) p++;
    if (VERSE_WORD.has(tokens[p])) { sep = 'verse'; m = p + 1; }
    // "John 3 and 16" yes; "the numbers 5 and 6" no (everyday-word book, small second number, no cue)
    else if (tokens[m] === 'and' && isNum(tokens[m + 1]) && (cued || !COMMON_WORD_BOOKS.has(book.spoken) || +tokens[m + 1] >= 10)) { sep = 'and'; m++; }
  }
  if (sep && isNum(tokens[m])) {
    // one-chapter book: "Jude 3 and 4" are verses — but "Jude chapter 2 verse 1"
    // names a chapter that doesn't exist; keep it, so the closest verses are offered
    if (one && sep !== ':' && !(sawChapterWord && sep === 'verse')) return finish(1, n1, k, 0.9);
    return finish(n1, +tokens[m], m + 1, sep === ':' ? 0.97 : sep === 'verse' ? 0.95 : 0.9);
  }
  if (!sep && isNum(tokens[m]) && +tokens[m] <= 176 && n1 <= 150 && !bookAt(tokens, m) && !one) {
    return finish(n1, +tokens[m], m + 1, 0.88);                         // "John 3 16"
  }

  // only one number
  if (one) return finish(1, n1, k, 0.9);                                // "Jude 3", "3 John 2"
  const splits = splitDigits(book, tokens[k - 1]);
  if (n1 <= CHAPTERS[book.num]) {
    // "Psalm 23" → 23:1. A bare book that's also an everyday word needs a cue.
    if (!cued && !sawChapterWord && COMMON_WORD_BOOKS.has(book.spoken)) return null;
    const r = finish(n1, 1, k, 0.88);
    // "Psalm 11" may have been "Psalm 1:1" run together (repeated digits only)
    if (r) { r.chapterOnly = true; if (splits.length && /^(\d)\1+$/.test(tokens[k - 1])) r.alternatives = splits; }
    return r;
  }
  // more than the book's chapters: run-together numbers ("John 316" → 3:16)
  if (splits.length) {
    const r = finish(splits[0].chapter, splits[0].verse, k, 0.86);
    if (r && splits.length > 1) r.alternatives = splits.slice(1);
    return r;
  }
  return null;

  function finish(chapter, verse, next, confidence) {
    if (!chapter || !verse || verse > 176) return null;
    // a range: "16-18", "16 to 18", "verses 5 and 6" (not "and 2 Kings")
    let verseEnd, q = next;
    const rangeWord = RANGE_WORD.has(tokens[q]) || (tokens[q] === 'and' && isNum(tokens[q + 1]));
    if (rangeWord) {
      let r = q + 1;
      if (VERSE_WORD.has(tokens[r])) r++;
      if (isNum(tokens[r]) && +tokens[r] > verse && !bookAt(tokens, r)) {
        const end = +tokens[r];
        if (tokens[q] !== 'and' || end - verse <= 3) { verseEnd = Math.min(end, verse + MAX_RANGE - 1); next = r + 1; }
      }
    }
    return { chapter, verse, verseEnd, confidence, next };
  }
}

// "316" for John → [{3,16}]; "1191" for Psalms → [{119,1}]; only splits that exist
function splitDigits(book, digits) {
  const out = [];
  if (!digits || digits.length < 2) return out;
  for (let c = digits.length - 1; c >= 1; c--) {
    const vs = digits.slice(c);
    if (vs[0] === '0') continue;
    const chapter = +digits.slice(0, c), verse = +vs;
    if (exists(book, chapter, verse)) out.push({ chapter, verse });
  }
  return out;
}

function cleanText(text) {
  return normaliseNumbers(String(text).replace(/[,;!?"“”]/g, ' '))
    .toLowerCase()
    .replace(/(\d)\.(\d)/g, '$1:$2')                                    // "3.16"
    .replace(/\./g, ' ')
    .replace(/\b(iii|ii|i)\s+(samuel|kings|chronicles|corinthians|thessalonians|timothy|peter|john)\b/g,
      (m, r, b) => ({ i: '1', ii: '2', iii: '3' })[r] + ' ' + b)         // "I Corinthians", "II Kings"
    .replace(/\s+/g, ' ')
    .trim();
}

// Every reference in the text, in order
function parseAll(text, fallbackTranslation = 'KJV') {
  if (!text || text.trim().length < 3) return [];
  const clean = cleanText(text);
  const translation = detectTranslation(clean) || fallbackTranslation;
  const tokens = tokenize(clean);
  const out = [], seen = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const hit = bookAt(tokens, i);
    if (!hit) continue;
    const cued = i > 0 && cuedAt(tokens, i);
    const r = readNumbers(tokens, hit.next, hit.book, cued);
    if (!r) continue;
    const key = `${hit.book.name} ${r.chapter}:${r.verse}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ book: hit.book.name, chapter: r.chapter, verse: r.verse, verseEnd: r.verseEnd, translation, confidence: r.confidence,
        raw: tokens.slice(i, r.next).join(' '), ...(r.chapterOnly ? { chapterOnly: true } : {}), ...(r.alternatives ? { alternatives: r.alternatives } : {}) });
    }
    i = r.next - 1;
  }
  return out;
}

// Does this sentence sound like it names a reference? (for the session report:
// "named a book and a number but no verse came up"). A book name followed
// closely by a number, or "chapter/verse N", or "N:N".
function looksLikeReference(text) {
  const tokens = tokenize(cleanText(text || ''));
  for (let i = 0; i < tokens.length; i++) {
    if (CHAPTER_WORD.has(tokens[i]) || (VERSE_WORD.has(tokens[i]) && tokens[i] !== 'v')) { if (isNum(tokens[i + 1])) return true; continue; }
    if (tokens[i] === ':' && isNum(tokens[i - 1]) && isNum(tokens[i + 1])) return true;
    const hit = bookAt(tokens, i);
    if (hit && !COMMON_WORD_BOOKS.has(hit.book.spoken) && tokens.slice(hit.next, hit.next + 3).some(isNum)) return true;
  }
  return false;
}

function parse(text, fallbackTranslation = 'KJV') {
  if (!text || text.trim().length < 3) return null;
  const all = parseAll(text, fallbackTranslation);
  if (all.length) return all.length > 1 ? { ...all[0], more: all.slice(1) } : all[0];

  // Translation-only — preacher switching translation without stating a reference
  // Also catches "King James Version" explicitly since KJV === fallback but still a signal
  const clean = cleanText(text);
  const rawTranslation = detectTranslation(clean);
  if (rawTranslation && (rawTranslation !== fallbackTranslation || text.toLowerCase().includes('king james'))) {
    return { translationOnly: true, translation: rawTranslation, confidence: 0.95 };
  }
  return null;
}

module.exports = { parse, parseAll, looksLikeReference, detectTranslation, resolveBook, normaliseNumbers, CHAPTERS };
