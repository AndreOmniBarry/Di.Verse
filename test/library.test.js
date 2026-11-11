// The local Bible library: importing files and storing translations.
// Uses throwaway codes (ZZ…) so running the tests never touches a real
// translation in this computer's bible.db.
const test = require('node:test');
const assert = require('node:assert');
const { getDb, getVerse, listTranslations } = require('../services/bibleDb');
const library = require('../services/library');
const { parse, importFile } = require('../services/importer');

const kjv = (book) => getDb().prepare(`SELECT chapter, verse, text FROM verses WHERE translation = 'KJV' AND book = ? ORDER BY chapter, verse`).all(book);
const cleanup = () => { for (const c of ['ZZU', 'ZZO', 'ZZJ', 'ZZM']) try { library.remove(c); } catch (e) {} };
test.after(cleanup);

test('USFM: one book, footnotes and markers stripped, coverage reported', () => {
  let usfm = '\\id JHN John\n\\h John\n\\mt1 The Gospel of John\n';
  let ch = 0;
  for (const r of kjv('John')) {
    if (r.chapter !== ch) { ch = r.chapter; usfm += `\\c ${ch}\n\\s1 A heading\n\\p\n`; }
    const text = r.chapter === 3 && r.verse === 16 ? r.text.replace('world,', 'world,\\f + \\fr 3:16 \\ft a footnote\\f*') : r.text;
    usfm += `\\v ${r.verse} ${text}\n`;
  }
  const rep = importFile({ content: usfm, filename: 'JHN.usfm', code: 'zzu', name: 'Test USFM', obtained: 'Test fixture built from KJV' });
  assert.strictEqual(rep.format, 'USFM');
  assert.strictEqual(rep.verses, 879);
  assert.strictEqual(rep.coverage, '1 books (0 OT, 1 NT)');
  assert.ok(rep.missingBooks.includes('Genesis') && !rep.missingBooks.includes('John'));
  return getVerse('John', 3, 16, 'ZZU').then(v => {
    assert.strictEqual(v.text, kjv('John').find(r => r.chapter === 3 && r.verse === 16).text);
    assert.strictEqual(v.translation, 'ZZU');
  });
});

test('OSIS (container and milestone forms) and JSON (flat and nested)', () => {
  const rows = kjv('Mark');
  const osis = '<osis><osisText>' + rows.map(r => `<verse osisID="Mark.${r.chapter}.${r.verse}">${r.text.replace('&', '&amp;')}<note>n</note></verse>`).join('') + '</osisText></osis>';
  assert.strictEqual(parse(osis, 'mark.xml').rows.length, rows.length);
  const mile = rows.map(r => `<verse sID="Mark.${r.chapter}.${r.verse}" osisID="Mark.${r.chapter}.${r.verse}"/>${r.text}<verse eID="Mark.${r.chapter}.${r.verse}"/>`).join('\n');
  assert.strictEqual(parse('<osis>' + mile + '</osis>', 'm.osis').rows.length, rows.length);
  const flat = JSON.stringify(kjv('Romans').map(r => ({ book: 'Rom', chapter: r.chapter, verse: r.verse, text: r.text })));
  const pf = parse(flat, 'rom.json');
  assert.strictEqual(pf.format, 'JSON'); assert.strictEqual(pf.rows[0].book, 'Romans');
  const byCh = {}; for (const r of kjv('Jude')) (byCh[r.chapter] = byCh[r.chapter] || []).push(r.text);
  const nested = JSON.stringify([{ abbrev: 'jud', chapters: Object.values(byCh) }]);
  assert.strictEqual(parse(nested, 'x.json').rows.length, kjv('Jude').length);
  const rep = importFile({ content: osis, filename: 'mark.xml', code: 'ZZO', name: 'Test OSIS', obtained: 'Test fixture built from KJV' });
  assert.strictEqual(rep.format, 'OSIS'); assert.strictEqual(rep.verses, rows.length);
});

test('a copyrighted name needs the operator to say where the file came from; KJV can\'t be replaced', () => {
  const content = JSON.stringify(kjv('Luke').map(r => ({ book: 'LUK', chapter: r.chapter, verse: r.verse, text: r.text })));
  assert.throws(() => importFile({ content, code: 'NKJV', name: 'New King James Version', obtained: '' }), /copyrighted: say where this file comes from/);
  assert.throws(() => importFile({ content, code: 'ZZJ', name: 'x', obtained: 'no' }), /Say where this file comes from/);
  assert.throws(() => importFile({ content, code: 'KJV', name: 'King James', obtained: 'Test fixture built from KJV' }), /KJV is built in/);
  assert.throws(() => importFile({ content: '[{"book":"JHN","chapter":1,"verse":1,"text":"x"}]', code: 'ZZJ', name: 'x', obtained: 'Test fixture here' }), /doesn't look like a Bible/);
});

test('an imported translation is offered as local, with what it covers; removing it removes it', async () => {
  importFile({ content: JSON.stringify(kjv('Luke').map(r => ({ book: 'LUK', chapter: r.chapter, verse: r.verse, text: r.text }))), code: 'ZZM', name: 'Test Luke', obtained: 'Test fixture built from KJV' });
  let t = (await listTranslations()).find(x => x.code === 'ZZM');
  assert.ok(t && t.available && t.provider === 'local'); assert.strictEqual(t.coverage, '1 books (0 OT, 1 NT)');
  // a verse it doesn't have: KJV, with the reason
  const v = await getVerse('Genesis', 1, 1, 'ZZM');
  assert.strictEqual(v.translation, 'KJV'); assert.ok(v.fallback); assert.match(v.fallbackReason, /not part of the ZZM text/);
  library.remove('ZZM');
  t = (await listTranslations()).find(x => x.code === 'ZZM');
  assert.strictEqual(t, undefined);
});

test('bible.helloao.org format: verse text joined cleanly round footnote markers', () => {
  const rows = library.rowsFromHelloao({ books: [{ id: 'EST', chapters: [{ chapter: { number: 8, content: [
    { type: 'heading', content: ['The Decree'] },
    { type: 'verse', number: 9, content: ['the third month (the month of Sivan', { noteId: 3 }, '), they recorded'] },
    { type: 'verse', number: 10, content: [{ text: 'He wrote', wordsOfJesus: false }, 'in the name'] }] } }] }, { id: 'TOB', chapters: [] }] });
  assert.deepStrictEqual(rows, [
    { book: 'Esther', chapter: 8, verse: 9, text: 'the third month (the month of Sivan), they recorded' },
    { book: 'Esther', chapter: 8, verse: 10, text: 'He wrote in the name' }]);
});

test('the free list only names translations that are free to use, never licensed ones', () => {
  for (const f of library.FREE) assert.ok(!library.LICENSED_ONLY.has(f.code), f.code);
  assert.ok(!library.FREE.some(f => /good news|gnb|gnt/i.test(f.code + f.name)), 'the catalogue\'s "GNB" is the Noyes Bible, not Good News');
});

test('JSON laid out book → chapter → verse (as many Bible datasets are), plain or wrapped', () => {
  const map = {};
  for (const r of kjv('Ruth')) ((map.Ruth = map.Ruth || {})[r.chapter] = map.Ruth[r.chapter] || {})[r.verse] = r.text;
  const plain = parse(JSON.stringify(map), 'ASV_bible.json');
  assert.strictEqual(plain.format, 'JSON'); assert.strictEqual(plain.rows.length, kjv('Ruth').length);
  assert.deepStrictEqual(plain.rows[0], { book: 'Ruth', chapter: 1, verse: 1, text: kjv('Ruth')[0].text });
  const wrapped = parse(JSON.stringify({ ASV: map }), 'x.json');
  assert.strictEqual(wrapped.rows.length, kjv('Ruth').length);
  assert.throws(() => parse('{"hello": {"world": 1}}', 'x.json'), /No verses found/);
});

test('a translation that numbers verses differently is flagged (e.g. Psalms numbered the Latin way)', () => {
  const ps = kjv('Psalms');
  const same = importFile({ content: JSON.stringify(ps.map(r => ({ book: 'PSA', chapter: r.chapter, verse: r.verse, text: r.text }))), code: 'ZZJ', name: 'Psalms as KJV', obtained: 'Test fixture built from KJV' });
  assert.strictEqual(same.numberingDiffers, false);
  // every verse one later (a psalm title counted as verse 1): 150 verses past chapter ends
  const shifted = importFile({ content: JSON.stringify(ps.map(r => ({ book: 'PSA', chapter: r.chapter, verse: r.verse + 1, text: r.text }))), code: 'ZZJ', name: 'Psalms shifted', obtained: 'Test fixture built from KJV' });
  assert.strictEqual(shifted.numberingDiffers, true);
  assert.match(shifted.coverage, /verse numbering differs from KJV/);
  assert.ok(shifted.differsIn.length > 0 && /^Psalms \d+$/.test(shifted.differsIn[0]));
  library.remove('ZZJ');
});
