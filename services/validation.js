const { getDb } = require('./bibleDb');

// Normalise book name — handles lowercase, shorthand, common variations
function normaliseBook(input) {
  const map = {
    'gen':'Genesis','exo':'Exodus','lev':'Leviticus','num':'Numbers',
    'deu':'Deuteronomy','deut':'Deuteronomy','jos':'Joshua','jdg':'Judges',
    'jug':'Judges','rut':'Ruth','1sa':'1 Samuel','2sa':'2 Samuel',
    '1ki':'1 Kings','2ki':'2 Kings','1ch':'1 Chronicles','2ch':'2 Chronicles',
    'ezr':'Ezra','neh':'Nehemiah','est':'Esther','job':'Job',
    'psa':'Psalms','pss':'Psalms','pro':'Proverbs','ecc':'Ecclesiastes',
    'sos':'Song of Solomon','song':'Song of Solomon','isa':'Isaiah',
    'jer':'Jeremiah','lam':'Lamentations','eze':'Ezekiel','ezk':'Ezekiel',
    'dan':'Daniel','hos':'Hosea','joe':'Joel','amo':'Amos','oba':'Obadiah',
    'jon':'Jonah','mic':'Micah','nah':'Nahum','hab':'Habakkuk',
    'zep':'Zephaniah','hag':'Haggai','zec':'Zechariah','mal':'Malachi',
    'mat':'Matthew','matt':'Matthew','mar':'Mark','mrk':'Mark',
    'luk':'Luke','joh':'John','jhn':'John','act':'Acts','rom':'Romans',
    '1co':'1 Corinthians','1cor':'1 Corinthians','2co':'2 Corinthians',
    '2cor':'2 Corinthians','gal':'Galatians','eph':'Ephesians',
    'phi':'Philippians','php':'Philippians','col':'Colossians',
    '1th':'1 Thessalonians','2th':'2 Thessalonians','1ti':'1 Timothy',
    '1tim':'1 Timothy','2ti':'2 Timothy','2tim':'2 Timothy',
    'tit':'Titus','phm':'Philemon','heb':'Hebrews','jam':'James',
    'jas':'James','1pe':'1 Peter','1pet':'1 Peter','2pe':'2 Peter',
    '2pet':'2 Peter','1jo':'1 John','1joh':'1 John','2jo':'2 John',
    '3jo':'3 John','jud':'Jude','rev':'Revelation',
  };

  const lower = input.toLowerCase().trim();

  // Try direct shorthand match
  if (map[lower]) return map[lower];

  // Try first 3 chars
  if (map[lower.slice(0,3)]) return map[lower.slice(0,3)];

  // Try title case match against full book names
  const titleCase = lower.charAt(0).toUpperCase() + lower.slice(1);
  const fullNames = [
    'Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Joshua',
    'Judges','Ruth','1 Samuel','2 Samuel','1 Kings','2 Kings',
    '1 Chronicles','2 Chronicles','Ezra','Nehemiah','Esther','Job',
    'Psalms','Proverbs','Ecclesiastes','Song of Solomon','Isaiah',
    'Jeremiah','Lamentations','Ezekiel','Daniel','Hosea','Joel',
    'Amos','Obadiah','Jonah','Micah','Nahum','Habakkuk','Zephaniah',
    'Haggai','Zechariah','Malachi','Matthew','Mark','Luke','John',
    'Acts','Romans','1 Corinthians','2 Corinthians','Galatians',
    'Ephesians','Philippians','Colossians','1 Thessalonians',
    '2 Thessalonians','1 Timothy','2 Timothy','Titus','Philemon',
    'Hebrews','James','1 Peter','2 Peter','1 John','2 John',
    '3 John','Jude','Revelation'
  ];

  // Case-insensitive full match
  const match = fullNames.find(n => n.toLowerCase() === lower);
  if (match) return match;

  // Starts-with match for partial input
  const startMatch = fullNames.find(n => n.toLowerCase().startsWith(lower));
  if (startMatch) return startMatch;

  return null; // Not found
}

function validateReference(rawBook, chapter, verse) {
  const db = getDb();

  // Normalise the book name first
  const book = normaliseBook(rawBook);

  if (!book) return {
    valid: false,
    code: 'BOOK_NOT_FOUND',
    message: `'${rawBook}' is not a recognised Bible book name.`,
    normalised: null
  };

  const chapterRow = db.prepare(
    `SELECT max_verse FROM bible_structure WHERE book = ? AND chapter = ?`
  ).get(book, chapter);

  if (!chapterRow) {
    const maxChapter = db.prepare(
      `SELECT MAX(chapter) as m FROM bible_structure WHERE book = ?`
    ).get(book)?.m;
    return {
      valid: false,
      code: 'CHAPTER_NOT_FOUND',
      message: `${book} only has ${maxChapter} chapter${maxChapter > 1 ? 's' : ''}. Chapter ${chapter} does not exist.`,
      normalised: book
    };
  }

  if (verse > chapterRow.max_verse) return {
    valid: false,
    code: 'VERSE_EXCEEDS_CHAPTER',
    message: `${book} chapter ${chapter} ends at verse ${chapterRow.max_verse}. Verse ${verse} does not exist.`,
    normalised: book
  };

  return { valid: true, normalised: book };
}

module.exports = { validateReference, normaliseBook };