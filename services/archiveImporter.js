'use strict';

// Import chapter-per-file JSON ZIP archives using:
// TRANSLATION/TESTAMENT/BOOK/CHAPTER.json
// or bible-imports/TRANSLATION/TESTAMENT/BOOK/CHAPTER.json
// Files are read directly from the ZIP; nothing is extracted to disk.

const crypto = require('node:crypto');
const { findBook } = require('./books');
const defaultLibrary = require('./library');

const LIMITS = Object.freeze({
  archiveBytes: 250 * 1024 * 1024,
  entries: 100000,
  totalUncompressedBytes: 2 * 1024 * 1024 * 1024,
  translationUncompressedBytes: 200 * 1024 * 1024,
  chapterBytes: 2 * 1024 * 1024,
  chapterNumber: 200,
  verseNumber: 300,
});

const TESTAMENTS = new Map([
  ['old', 'old'], ['ot', 'old'], ['oldtestament', 'old'],
  ['new', 'new'], ['nt', 'new'], ['newtestament', 'new'],
]);

// Names are presentation labels only. Unknown codes remain usable and display
// their folder code until an operator chooses a more descriptive name.
const TRANSLATION_NAMES = Object.freeze({
  AMP: 'Amplified Bible',
  AMPC: 'Amplified Bible, Classic Edition',
  ASV: 'American Standard Version',
  CEB: 'Common English Bible',
  CEV: 'Contemporary English Version',
  CJB: 'Complete Jewish Bible',
  CSB: 'Christian Standard Bible',
  DARBY: 'Darby Bible',
  DRA: 'Douay-Rheims Bible',
  EHV: 'Evangelical Heritage Version',
  ERV: 'Easy-to-Read Version',
  ESV: 'English Standard Version',
  ESVUK: 'English Standard Version (UK)',
  GNT: 'Good News Translation',
  GNV: 'Geneva Bible',
  GW: "God's Word Translation",
  HCSB: 'Holman Christian Standard Bible',
  ICB: "International Children's Bible",
  ISV: 'International Standard Version',
  JUB: 'Jubilee Bible 2000',
  KJ21: '21st Century King James Version',
  KJV: 'King James Version',
  LEB: 'Lexham English Bible',
  MEV: 'Modern English Version',
  MSG: 'The Message',
  NABRE: 'New American Bible Revised Edition',
  NASB: 'New American Standard Bible',
  NCV: 'New Century Version',
  NET: 'New English Translation',
  NIRV: "New International Reader's Version",
  NIV: 'New International Version',
  NKJV: 'New King James Version',
  NLT: 'New Living Translation',
  TPT: 'The Passion Translation',
});

function normalizedCode(value) {
  const code = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code && code.length <= 12 ? code : null;
}

function safeEntryPath(fileName) {
  if (typeof fileName !== 'string' || !fileName || fileName.includes('\0')) {
    throw new Error('The ZIP contains an invalid file path.');
  }
  const normalised = fileName.replace(/\\/g, '/');
  if (normalised.startsWith('/') || /^[A-Za-z]:/.test(normalised)) {
    throw new Error(`The ZIP contains an absolute path: ${fileName}`);
  }
  const parts = normalised.split('/');
  if (parts.some(part => part === '..')) {
    throw new Error(`The ZIP contains an unsafe path: ${fileName}`);
  }
  return parts.filter(part => part && part !== '.');
}

function testamentKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z]/g, '');
}

function bookFolderName(value) {
  return String(value || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Return archive metadata for a supported chapter file path, or null.
 * Accepts the standard CODE/TESTAMENT/BOOK/CHAPTER.json layout and the
 * testament-less CODE/BOOK/CHAPTER.json layout used by some partial editions.
 * Testament-less imports are only inferred for translations in our known
 * catalogue; unknown folder names are never guessed to be translation codes.
 */
function parseChapterPath(fileName) {
  const parts = safeEntryPath(fileName);
  if (!parts.length || !/^\d+\.json$/i.test(parts[parts.length - 1])) return null;

  const chapter = Number(parts[parts.length - 1].replace(/\.json$/i, ''));
  if (!Number.isSafeInteger(chapter) || chapter < 1 || chapter > LIMITS.chapterNumber) return null;

  // Preferred, explicit testament path. This remains compatible with older
  // archive packs and supports one optional enclosing directory.
  let testamentIndex = -1;
  let testament = null;
  for (let i = 1; i < parts.length - 2; i++) {
    const candidate = TESTAMENTS.get(testamentKey(parts[i]));
    if (candidate) {
      testamentIndex = i;
      testament = candidate;
      break;
    }
  }

  if (testamentIndex >= 1) {
    const code = normalizedCode(parts[testamentIndex - 1]);
    if (!code) return null;
    const book = findBook(bookFolderName(parts[testamentIndex + 1]));
    if (!book) return null;
    const middle = parts.slice(testamentIndex + 2, -1);
    if (middle.length > 1 || (middle.length === 1 && !/^chapters?$/i.test(middle[0]))) return null;
    const expectedTestament = book.num <= 39 ? 'old' : 'new';
    return {
      code, testament, book: book.name, chapter,
      testamentMismatch: testament !== expectedTestament,
      testamentInferred: false,
      fileName,
    };
  }

  // Some sources, including partial translations, package only CODE/BOOK/
  // CHAPTER.json (optionally BOOK/chapters/CHAPTER.json). Allow one wrapper
  // directory, and infer OT/NT from the recognised book rather than requiring
  // a complete 66-book testament tree.
  const hasChaptersFolder = /^chapters?$/i.test(parts[parts.length - 2]);
  const bookIndex = parts.length - (hasChaptersFolder ? 3 : 2);
  const codeIndex = bookIndex - 1;
  if (codeIndex < 0 || codeIndex > 1) return null;
  const code = normalizedCode(parts[codeIndex]);
  if (!code || !TRANSLATION_NAMES[code]) return null;
  const book = findBook(bookFolderName(parts[bookIndex]));
  if (!book) return null;
  if (hasChaptersFolder && parts.length - bookIndex !== 3) return null;
  if (!hasChaptersFolder && parts.length - bookIndex !== 2) return null;

  return {
    code, testament: book.num <= 39 ? 'old' : 'new', book: book.name, chapter,
    testamentMismatch: false, testamentInferred: true, fileName,
  };
}

/** Parse a chapter's {"verseNumber":"text"} object into sorted rows. */
function parseChapterJson(input) {
  let value;
  try {
    if (input && typeof input === 'object' && !Buffer.isBuffer(input)) {
      value = input;
    } else {
      const source = Buffer.isBuffer(input)
        ? input.toString('utf8').replace(/^\uFEFF/, '')
        : String(input).replace(/^\uFEFF/, '');
      value = JSON.parse(source);
    }
  } catch (error) {
    throw new Error(`Invalid JSON: ${error.message}`);
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('A chapter file must be an object whose keys are verse numbers.');
  }

  const verses = [];
  let invalidVerses = 0;
  for (const [key, raw] of Object.entries(value)) {
    // Some editions (notably MSG and PHILLIPS in this archive) group several
    // numbered verses into one paragraph. Preserve that paragraph as a single
    // range record; never fabricate verse-level boundaries or duplicate text.
    const match = key.match(/^(\d+)(?:\s*[-–—]\s*(\d+))?$/u);
    if (!match) {
      invalidVerses++;
      continue;
    }
    const verse = Number(match[1]);
    const verseEnd = match[2] ? Number(match[2]) : verse;
    if (!Number.isSafeInteger(verse) || !Number.isSafeInteger(verseEnd) ||
        verse < 1 || verseEnd < verse || verseEnd > LIMITS.verseNumber) {
      invalidVerses++;
      continue;
    }
    const text = typeof raw === 'string'
      ? raw
      : (raw && typeof raw.text === 'string' ? raw.text : '');
    if (!text.trim()) {
      invalidVerses++;
      continue;
    }
    verses.push({ verse, ...(verseEnd > verse ? { verseEnd } : {}), text });
  }

  verses.sort((a, b) => a.verse - b.verse || (b.verseEnd || b.verse) - (a.verseEnd || a.verse));
  // Overlapping keys cannot both be represented faithfully. Keep the first
  // sorted block and report each later overlapping block as an invalid entry.
  const nonOverlapping = [];
  let lastCoveredVerse = 0;
  for (const item of verses) {
    const end = item.verseEnd || item.verse;
    if (item.verse <= lastCoveredVerse) {
      invalidVerses++;
      continue;
    }
    nonOverlapping.push(item);
    lastCoveredVerse = end;
  }
  verses.splice(0, verses.length, ...nonOverlapping);
  if (!verses.length) throw new Error('No valid verse entries were found in this chapter.');
  return { verses, invalidVerses };
}

function openZip(buffer) {
  // Lazy load so the path/JSON helpers can be unit-tested without installing
  // the optional test environment's ZIP dependency.
  const yauzl = require('yauzl');
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, {
      lazyEntries: true,
      autoClose: false,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: false,
    }, (openError, zipfile) => {
      if (openError) return reject(openError);

      const entries = [];
      let totalUncompressed = 0;
      let settled = false;
      const fail = error => {
        if (settled) return;
        settled = true;
        try { zipfile.close(); } catch (_) { /* ZIP may already be closed */ }
        reject(error);
      };

      zipfile.on('error', fail);
      zipfile.on('entry', entry => {
        try {
          safeEntryPath(entry.fileName);
          const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
          if ((unixMode & 0xf000) === 0xa000) {
            throw new Error(`Symbolic links are not supported in ZIP archives: ${entry.fileName}`);
          }
          const uncompressedSize = Number(entry.uncompressedSize || 0);
          if (!Number.isSafeInteger(uncompressedSize) || uncompressedSize < 0) {
            throw new Error(`Invalid uncompressed size in ZIP entry: ${entry.fileName}`);
          }
          totalUncompressed += uncompressedSize;
          if (entries.length >= LIMITS.entries) throw new Error('The ZIP contains too many entries.');
          if (totalUncompressed > LIMITS.totalUncompressedBytes) {
            throw new Error('The ZIP expands beyond the 2 GB safety limit.');
          }
          if (/\.json$/i.test(entry.fileName) && uncompressedSize > LIMITS.chapterBytes) {
            throw new Error(`Chapter file exceeds the 2 MB limit: ${entry.fileName}`);
          }
          entries.push(entry);
          zipfile.readEntry();
        } catch (error) {
          fail(error);
        }
      });
      zipfile.on('end', () => {
        if (settled) return;
        settled = true;
        resolve({ zipfile, entries });
      });
      zipfile.readEntry();
    });
  });
}

function readEntry(zipfile, entry) {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (openError, stream) => {
      if (openError) return reject(openError);
      const chunks = [];
      let size = 0;
      let failed = false;
      stream.on('data', chunk => {
        if (failed) return;
        size += chunk.length;
        if (size > LIMITS.chapterBytes) {
          failed = true;
          stream.destroy(new Error(`Chapter file exceeds the 2 MB limit: ${entry.fileName}`));
          return;
        }
        chunks.push(chunk);
      });
      stream.once('error', reject);
      stream.once('end', () => {
        if (!failed) resolve(Buffer.concat(chunks));
      });
    });
  });
}

function archiveGroups(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (entry.fileName.endsWith('/')) continue;
    const meta = parseChapterPath(entry.fileName);
    if (!meta) continue;
    if (!groups.has(meta.code)) groups.set(meta.code, []);
    groups.get(meta.code).push({ entry, meta });
  }

  for (const [code, files] of groups) {
    const totalBytes = files.reduce((sum, item) => sum + Number(item.entry.uncompressedSize || 0), 0);
    if (totalBytes > LIMITS.translationUncompressedBytes) {
      throw new Error(`${code} expands beyond the 200 MB per-translation safety limit.`);
    }
  }
  return groups;
}

async function withArchive(buffer, work) {
  if (!Buffer.isBuffer(buffer)) throw new Error('Upload a ZIP archive.');
  if (!buffer.length || buffer.length > LIMITS.archiveBytes) {
    throw new Error('ZIP archive must be between 1 byte and 250 MB.');
  }
  const opened = await openZip(buffer);
  try {
    return await work(opened.zipfile, opened.entries);
  } finally {
    try { opened.zipfile.close(); } catch (_) { /* fromBuffer readers may already be closed */ }
  }
}

function installedTranslations(lib) {
  const installed = lib.list().installed || [];
  return new Map(installed.map(item => [String(item.code).toUpperCase(), item]));
}

async function inspectArchive(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer)) throw new Error('Upload a ZIP archive.');
  const lib = options.library || defaultLibrary;
  const archiveHash = crypto.createHash('sha256').update(buffer).digest('hex');

  return withArchive(buffer, async (zipfile, entries) => {
    const groups = archiveGroups(entries);
    const installed = installedTranslations(lib);
    const translations = [];

    for (const [code, files] of groups) {
      const books = new Set();
      const chapters = new Set();
      const seenChapters = new Set();
      const invalidDetails = [];
      let verses = 0;
      let invalidFiles = 0;
      let invalidVerses = 0;
      let duplicateChapterFiles = 0;
      let testamentMismatches = 0;
      let testamentInferredFiles = 0;

      for (const { entry, meta } of files) {
        const key = `${meta.book}|${meta.chapter}`;
        if (seenChapters.has(key)) duplicateChapterFiles++;
        seenChapters.add(key);
        books.add(meta.book);
        chapters.add(key);
        if (meta.testamentMismatch) testamentMismatches++;
        if (meta.testamentInferred) testamentInferredFiles++;
        try {
          const parsed = parseChapterJson(await readEntry(zipfile, entry));
          verses += parsed.verses.reduce((sum, item) => sum + (item.verseEnd || item.verse) - item.verse + 1, 0);
          invalidVerses += parsed.invalidVerses;
        } catch (error) {
          invalidFiles++;
          if (invalidDetails.length < 20) invalidDetails.push({ file: entry.fileName, error: error.message });
        }
      }

      const existing = installed.get(code);
      translations.push({
        code,
        name: TRANSLATION_NAMES[code] || (existing && existing.name) || code,
        files: files.length,
        books: books.size,
        bookNames: [...books].sort((a, b) => a.localeCompare(b)),
        chapters: chapters.size,
        verses,
        invalidFiles,
        invalidVerses,
        duplicateChapterFiles,
        testamentMismatches,
        testamentInferredFiles,
        invalidDetails,
        alreadyInstalled: Boolean(existing),
        canImport: code !== 'KJV' && verses > 0 && invalidFiles === 0 && duplicateChapterFiles === 0,
      });
    }

    translations.sort((a, b) => a.code.localeCompare(b.code));
    return {
      archiveHash,
      archiveEntries: entries.length,
      chapterFiles: translations.reduce((sum, item) => sum + item.files, 0),
      translations,
      ignoredEntries: entries.length - translations.reduce((sum, item) => sum + item.files, 0),
    };
  });
}

async function importArchive(buffer, options = {}) {
  if (options.authorized !== true) {
    const error = new Error('Confirm that you are authorized to import these Bible files before continuing.');
    error.status = 403;
    throw error;
  }
  const sourceNote = String(options.sourceNote || '').trim();
  if (!sourceNote) {
    const error = new Error('Enter the source or permission basis for this Bible archive.');
    error.status = 400;
    throw error;
  }
  const lib = options.library || defaultLibrary;
  const preview = await inspectArchive(buffer, { library: lib });
  if (options.expectedHash && options.expectedHash !== preview.archiveHash) {
    const error = new Error('The selected ZIP has changed since preview. Preview it again before importing.');
    error.status = 409;
    throw error;
  }

  const available = new Map(preview.translations.map(item => [item.code, item]));
  const requested = Array.isArray(options.includeCodes) && options.includeCodes.length
    ? options.includeCodes.map(normalizedCode).filter(Boolean)
    : preview.translations.filter(item => item.canImport).map(item => item.code);
  const selectedCodes = [...new Set(requested)];
  if (!selectedCodes.length) throw new Error('Select at least one importable translation.');

  for (const code of selectedCodes) {
    const item = available.get(code);
    if (!item) throw new Error(`Translation ${code} was not found in this ZIP archive.`);
    if (!item.canImport) throw new Error(`${code} is not importable. Review its preview errors first.`);
  }

  const replaceCodes = new Set((options.replaceCodes || []).map(normalizedCode).filter(Boolean));
  const installed = installedTranslations(lib);
  const conflicts = selectedCodes.filter(code => installed.has(code));
  const unconfirmed = conflicts.filter(code => !replaceCodes.has(code));
  if (unconfirmed.length) {
    const error = new Error(`Replacement confirmation required for: ${unconfirmed.join(', ')}`);
    error.status = 409;
    error.replaceRequired = unconfirmed;
    throw error;
  }

  return withArchive(buffer, async (zipfile, entries) => {
    const groups = archiveGroups(entries);
    const results = [];
    const failed = [];

    // One translation at a time: memory use is bounded to one translation,
    // and library.store() gives each translation its own SQLite transaction.
    for (const code of selectedCodes) {
      try {
        const files = groups.get(code) || [];
        const rows = [];
        const chapterKeys = new Set();
        for (const { entry, meta } of files) {
          const chapterKey = `${meta.book}|${meta.chapter}`;
          if (chapterKeys.has(chapterKey)) throw new Error(`Duplicate chapter file for ${meta.book} ${meta.chapter}.`);
          chapterKeys.add(chapterKey);
          const parsed = parseChapterJson(await readEntry(zipfile, entry));
          for (const verse of parsed.verses) {
            rows.push({ book: meta.book, chapter: meta.chapter, verse: verse.verse,
              ...(verse.verseEnd ? { verseEnd: verse.verseEnd } : {}), text: verse.text });
          }
        }

        const prior = installed.get(code);
        const name = TRANSLATION_NAMES[code] || (prior && prior.name) || code;
        const report = lib.store(code, name, rows, {
          source: 'zip-import',
          licence: `Operator attested: ${sourceNote}`,
          note: `Imported from ZIP archive (${files.length} chapter files)`,
        });
        results.push({ ...report, chapterFiles: files.length });
      } catch (error) {
        failed.push({ code, error: error.message });
      }
    }

    return { imported: results.length, translations: results, failed };
  });
}

module.exports = {
  inspectArchive,
  importArchive,
  parseChapterPath,
  parseChapterJson,
  normalizedCode,
  safeEntryPath,
  LIMITS,
};
