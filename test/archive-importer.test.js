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

test('rejects malformed and empty chapter JSON', () => {
  assert.throws(() => parseChapterJson('{broken'), /Invalid JSON/);
  assert.throws(() => parseChapterJson({ title: 'heading only' }), /No valid verse/i);
  assert.throws(() => parseChapterJson([]), /must be an object/i);
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
