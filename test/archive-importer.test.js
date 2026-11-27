'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const {
  parseChapterPath,
  parseChapterJson,
  safeEntryPath,
  inspectArchive,
  importArchive,
} = require('../services/archiveImporter');

let hasYauzl = false;
try { require.resolve('yauzl'); hasYauzl = true; } catch (_) { /* npm install supplies this for the full ZIP tests */ }

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Small standards-compliant ZIP fixture builder using Node built-ins only.
function makeZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const filename = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const compressed = zlib.deflateRawSync(data);
    const crc = crc32(data);

    const local = Buffer.alloc(30 + filename.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    local.writeUInt16LE(0, 28);
    filename.copy(local, 30);

    const central = Buffer.alloc(46 + filename.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    filename.copy(central, 46);

    localParts.push(local, compressed);
    centralParts.push(central);
    offset += local.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const centralOffset = offset;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(centralParts.length, 8);
  end.writeUInt16LE(centralParts.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function fakeLibrary(installed = []) {
  const saved = [];
  return {
    saved,
    list() { return { installed }; },
    store(code, name, rows, info) {
      saved.push({ code, name, rows, info });
      return { code, name, verses: rows.length, coverage: 'Partial Bible', missingBooks: [] };
    },
  };
}

test('recognises chapter JSON paths with and without an enclosing directory', () => {
  const direct = parseChapterPath('AMP/old/Genesis/1.json');
  assert.equal(direct.code, 'AMP');
  assert.equal(direct.testament, 'old');
  assert.equal(direct.book, 'Genesis');
  assert.equal(direct.chapter, 1);

  const wrapped = parseChapterPath('bible-imports/AMPC/new/Matthew/chapters/28.json');
  assert.equal(wrapped.code, 'AMPC');
  assert.equal(wrapped.testament, 'new');
  assert.equal(wrapped.book, 'Matthew');
  assert.equal(wrapped.chapter, 28);

  const numberedBook = parseChapterPath('NKJV/old/1_Samuel/31.json');
  assert.equal(numberedBook.book, '1 Samuel');
});

test('accepts common testament folder spellings and flags mismatch without losing metadata', () => {
  assert.equal(parseChapterPath('ESV/Old Testament/Genesis/1.json').testament, 'old');
  assert.equal(parseChapterPath('ESV/NT/John/1.json').testamentMismatch, false);
  assert.equal(parseChapterPath('ESV/new/Genesis/1.json').testamentMismatch, true);
});

test('recognises partial translation archives without testament folders', () => {
  const tptOt = parseChapterPath('TPT/Psalms/23.json');
  assert.equal(tptOt.code, 'TPT');
  assert.equal(tptOt.book, 'Psalms');
  assert.equal(tptOt.testament, 'old');
  assert.equal(tptOt.testamentInferred, true);

  const tptNt = parseChapterPath('bible-imports/TPT/John/chapters/3.json');
  assert.equal(tptNt.code, 'TPT');
  assert.equal(tptNt.book, 'John');
  assert.equal(tptNt.testament, 'new');
  assert.equal(tptNt.testamentInferred, true);

  assert.equal(parseChapterPath('random/Psalms/23.json'), null);
  assert.equal(parseChapterPath('TPT/unknown-book/1.json'), null);
});

test('ignores paths outside the chapter archive convention', () => {
  assert.equal(parseChapterPath('AMP/old/Genesis/README.md'), null);
  assert.equal(parseChapterPath('AMP/old/NotABook/1.json'), null);
  assert.equal(parseChapterPath('AMP/old/Genesis/chapters.json'), null);
  assert.equal(parseChapterPath('random/1.json'), null);
  assert.equal(parseChapterPath('AMP/old/Genesis/201.json'), null);
});

test('rejects unsafe and absolute ZIP paths', () => {
  assert.throws(() => parseChapterPath('AMP/old/../Genesis/1.json'), /unsafe path/i);
  assert.throws(() => parseChapterPath('/AMP/old/Genesis/1.json'), /absolute path/i);
  assert.throws(() => safeEntryPath('C:\\temp\\file.json'), /absolute path/i);
  assert.throws(() => safeEntryPath('AMP/old/Genesis/\0.json'), /invalid file path/i);
});

test('parses and numerically sorts chapter verse maps', () => {
  const parsed = parseChapterJson({ '10': 'ten', '2': 'two', '1': 'one' });
  assert.deepEqual(parsed.verses, [
    { verse: 1, text: 'one' },
    { verse: 2, text: 'two' },
    { verse: 10, text: 'ten' },
  ]);
});

test('accepts text objects and counts invalid verse entries', () => {
  const parsed = parseChapterJson({ '1': { text: 'one' }, '0': 'zero', heading: 'title', '2': '' });
  assert.deepEqual(parsed.verses, [{ verse: 1, text: 'one' }]);
  assert.equal(parsed.invalidVerses, 3);
});

test('preserves MSG and PHILLIPS verse ranges as single text blocks', () => {
  const msg = parseChapterJson({ '1-5': 'MSG paragraph one', '6': 'MSG verse six', '9-13': 'MSG paragraph two' });
  assert.deepEqual(msg.verses, [
    { verse: 1, verseEnd: 5, text: 'MSG paragraph one' },
    { verse: 6, text: 'MSG verse six' },
    { verse: 9, verseEnd: 13, text: 'MSG paragraph two' },
  ]);
  assert.equal(msg.invalidVerses, 0);

  const phillips = parseChapterJson({ '1-2': 'Opening paragraph', '3-11': 'Long paragraph with editorial markers a and b-11', '12-13': 'Closing paragraph' });
  assert.deepEqual(phillips.verses.map(v => [v.verse, v.verseEnd || v.verse]), [[1, 2], [3, 11], [12, 13]]);
  assert.equal(phillips.invalidVerses, 0);
});

test('rejects malformed and empty chapter JSON', () => {
  assert.throws(() => parseChapterJson('{broken'), /Invalid JSON/);
  assert.throws(() => parseChapterJson({ title: 'heading only' }), /No valid verse/i);
  assert.throws(() => parseChapterJson([]), /must be an object/i);
});

test('previews and imports testament-less partial TPT chapters without assuming all 66 books', { skip: !hasYauzl }, async () => {
  const zip = makeZip({
    'bible-imports/TPT/Psalms/23.json': JSON.stringify({ '1': 'The Lord is my best friend and my shepherd.' }),
    'TPT/John/chapters/3.json': JSON.stringify({ '16': 'A verse supplied by the authorised source.' }),
  });
  const lib = fakeLibrary();
  const preview = await inspectArchive(zip, { library: lib });
  const tpt = preview.translations.find(item => item.code === 'TPT');
  assert.equal(tpt.canImport, true);
  assert.equal(tpt.books, 2);
  assert.deepEqual(tpt.bookNames, ['John', 'Psalms']);
  assert.equal(tpt.testamentInferredFiles, 2);
  assert.equal(tpt.verses, 2);

  const imported = await importArchive(zip, {
    library: lib,
    includeCodes: ['TPT'],
    expectedHash: preview.archiveHash,
  });
  assert.equal(imported.imported, 1);
  assert.deepEqual(lib.saved[0].rows.map(row => [row.book, row.chapter, row.verse]), [
    ['Psalms', 23, 1], ['John', 3, 16],
  ]);
});

test('previews and imports selected ZIP translations one at a time', { skip: !hasYauzl }, async () => {
  const zip = makeZip({
    'bible-imports/AMP/old/Genesis/1.json': JSON.stringify({ '2': 'two', '1': 'one' }),
    'bible-imports/AMP/old/Genesis/2.json': JSON.stringify({ '1': 'chapter two one' }),
    'bible-imports/ASV/new/John/1.json': JSON.stringify({ '1': 'In the beginning', '2': 'The next verse' }),
    'README.txt': 'not a chapter file',
  });
  const lib = fakeLibrary();
  const preview = await inspectArchive(zip, { library: lib });
  assert.equal(preview.translations.length, 2);
  assert.equal(preview.translations.find(t => t.code === 'AMP').verses, 3);
  assert.equal(preview.translations.find(t => t.code === 'ASV').books, 1);

  const imported = await importArchive(zip, {
    library: lib,
    includeCodes: ['AMP'],
    expectedHash: preview.archiveHash,
  });
  assert.equal(imported.imported, 1);
  assert.equal(lib.saved.length, 1);
  assert.equal(lib.saved[0].code, 'AMP');
  assert.deepEqual(lib.saved[0].rows.map(r => [r.chapter, r.verse]), [[1, 1], [1, 2], [2, 1]]);
});

test('previews and imports MSG and PHILLIPS chapter files with verse ranges intact', { skip: !hasYauzl }, async () => {
  const zip = makeZip({
    'bible-imports/MSG/old/Zephaniah/3.json': JSON.stringify({
      '1-5': 'MSG opening paragraph', '6': 'MSG verse six', '7': 'MSG verse seven', '8': 'MSG verse eight',
      '9-13': 'MSG restoration paragraph', '14-15': 'MSG rejoicing paragraph', '16-17': 'MSG comfort paragraph', '18-20': 'MSG promise paragraph',
    }),
    'bible-imports/PHILLIPS/new/Titus/3.json': JSON.stringify({
      '1-2': 'PHILLIPS first paragraph', '3-11': 'PHILLIPS long paragraph', '12-13': 'PHILLIPS travel paragraph',
      '14': 'PHILLIPS verse fourteen', '15': 'PHILLIPS closing verse',
    }),
  });
  const lib = fakeLibrary();
  const preview = await inspectArchive(zip, { library: lib });
  const msg = preview.translations.find(t => t.code === 'MSG');
  const phillips = preview.translations.find(t => t.code === 'PHILLIPS');
  assert.equal(msg.invalidFiles, 0);
  assert.equal(msg.invalidVerses, 0);
  assert.equal(msg.verses, 20);
  assert.equal(msg.canImport, true);
  assert.equal(phillips.invalidFiles, 0);
  assert.equal(phillips.invalidVerses, 0);
  assert.equal(phillips.verses, 15);
  assert.equal(phillips.canImport, true);

  const result = await importArchive(zip, {
    library: lib,
    includeCodes: ['MSG', 'PHILLIPS'],
    expectedHash: preview.archiveHash,
  });
  assert.equal(result.imported, 2);
  const msgRows = lib.saved.find(item => item.code === 'MSG').rows;
  const phillipsRows = lib.saved.find(item => item.code === 'PHILLIPS').rows;
  assert.deepEqual(msgRows.filter(r => r.verseEnd).map(r => [r.verse, r.verseEnd]), [[1, 5], [9, 13], [14, 15], [16, 17], [18, 20]]);
  assert.deepEqual(phillipsRows.filter(r => r.verseEnd).map(r => [r.verse, r.verseEnd]), [[1, 2], [3, 11], [12, 13]]);
  assert.equal(phillipsRows.find(r => r.verse === 3).text, 'PHILLIPS long paragraph');
});

test('requires explicit confirmation before replacing an installed ZIP translation', { skip: !hasYauzl }, async () => {
  const zip = makeZip({ 'AMP/old/Genesis/1.json': JSON.stringify({ '1': 'one' }) });
  const lib = fakeLibrary([{ code: 'AMP', name: 'Existing Amplified' }]);
  const preview = await inspectArchive(zip, { library: lib });
  await assert.rejects(
    importArchive(zip, { library: lib, includeCodes: ['AMP'], expectedHash: preview.archiveHash }),
    error => error.status === 409 && error.replaceRequired.includes('AMP'),
  );
  const result = await importArchive(zip, {
    library: lib,
    includeCodes: ['AMP'],
    replaceCodes: ['AMP'],
    expectedHash: preview.archiveHash,
  });
  assert.equal(result.imported, 1);
});

test('refuses import when the archive differs from the preview', { skip: !hasYauzl }, async () => {
  const zip = makeZip({ 'AMP/old/Genesis/1.json': JSON.stringify({ '1': 'one' }) });
  const lib = fakeLibrary();
  await assert.rejects(
    importArchive(zip, { library: lib, includeCodes: ['AMP'], expectedHash: 'not-the-same-archive' }),
    /changed since preview/i,
  );
  assert.equal(lib.saved.length, 0);
});
