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
  // Prefix match — minimum 3 chars to avoid false positives
  for (const [key, num] of Object.entries(BOOK_MAP)) {
    if (key.length >= 3 && lower.startsWith(key)) {
      return { num, name: BOOK_NAMES[num] };
    }
  }
  return null;
}

function detectTranslation(text) {
  const lower = text.toLowerCase();
  // Sort by length desc so longer phrases match first ("the passion translation" before "passion")
  const sorted = Object.entries(TRANSLATION_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [phrase, code] of sorted) {
    if (lower.includes(phrase)) return code;
  }
  return null;
}

// Common filler words that appear before a book name in natural speech
const FILLER = /\b(can we have|give me|let us go to|let's go to|open to|open up to|turn to|read|we are in|we're in|go to|that is|that's|it is|it's|and|now|also|see|look at|i said)\b/gi;

function parse(text, fallbackTranslation = 'KJV') {
  if (!text || text.trim().length < 3) return null;

  const clean = text
    .replace(/[,;!?]/g, ' ')
    .replace(/\./g, ' ')
    .replace(FILLER, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const detectedTranslation = detectTranslation(clean) || fallbackTranslation;

  // Pattern 1: Book chapter:verse  e.g. "John 3:16", "Rom 8:28"
  const p1 = /\b([1-3]?(?:\s*[a-z]+)+?)\s+(\d+)\s*[:.]\s*(\d+)/gi;
  let m;
  while ((m = p1.exec(clean)) !== null) {
    const book = resolveBook(m[1].trim());
    if (!book) continue;
    const chapter = parseInt(m[2]);
    const verse = parseInt(m[3]);
    if (!chapter || !verse || isNaN(chapter) || isNaN(verse) || verse > 176) continue;
    return { book: book.name, chapter, verse, translation: detectedTranslation, confidence: 0.97, raw: m[0].trim() };
  }

  // Pattern 2: Book chapter verse N  e.g. "John chapter 3 verse 16"
  const p2 = /\b([1-3]?(?:\s*[a-z]+)+?)\s+(?:chapter\s+)?(\w+)\s+verse\s+(\w+)/gi;
  while ((m = p2.exec(clean)) !== null) {
    const book = resolveBook(m[1].trim());
    if (!book) continue;
    const chapter = wordToNum(m[2]);
    const verse = wordToNum(m[3]);
    if (!chapter || !verse || isNaN(chapter) || isNaN(verse)) continue;
    return { book: book.name, chapter, verse, translation: detectedTranslation, confidence: 0.95, raw: m[0].trim() };
  }

  // Pattern 3: Book N and N  e.g. "John 3 and 16"
  const p3 = /\b([1-3]?(?:\s*[a-z]+)+?)\s+(\d+)\s+and\s+(\d+)\b/gi;
  while ((m = p3.exec(clean)) !== null) {
    const book = resolveBook(m[1].trim());
    if (!book) continue;
    const chapter = parseInt(m[2]);
    const verse = parseInt(m[3]);
    if (!chapter || !verse || verse > 176) continue;
    return { book: book.name, chapter, verse, translation: detectedTranslation, confidence: 0.90, raw: m[0].trim() };
  }

  // Pattern 4: Book N N  e.g. "John 3 16" (space separated, sanity-checked)
  const p4 = /\b([1-3]?(?:\s*[a-z]+)+?)\s+(\d{1,3})\s+(\d{1,3})\b/gi;
  while ((m = p4.exec(clean)) !== null) {
    const book = resolveBook(m[1].trim());
    if (!book) continue;
    const chapter = parseInt(m[2]);
    const verse = parseInt(m[3]);
    if (!chapter || !verse || verse > 176 || chapter > 150) continue;
    return { book: book.name, chapter, verse, translation: detectedTranslation, confidence: 0.85, raw: m[0].trim() };
  }

  // Translation-only — preacher switching translation without stating a reference
  // Also catches "King James Version" explicitly since KJV === fallback but still a signal
  const rawTranslation = detectTranslation(clean);
  if (rawTranslation && (rawTranslation !== fallbackTranslation || text.toLowerCase().includes('king james'))) {
    return { translationOnly: true, translation: rawTranslation, confidence: 0.95 };
  }

  return null;
}

module.exports = { parse, detectTranslation, resolveBook };
