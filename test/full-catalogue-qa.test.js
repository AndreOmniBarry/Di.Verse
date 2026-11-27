'use strict';
// Full-catalogue QA: every installed edition in a COPY of the real library.
// Run through scripts/qa-full-catalogue.js (it makes the copy and sets
// DIVERSE_FULL_CATALOGUE_QA=1). Skipped otherwise, e.g. in npm test and CI.
//
// For each edition, ten checks:
//   1 code and display name        6 spoken reference + edition (detect route)
//   2 verse rows, books, coverage  7 local retrieval returns the stored text
//   3 no availability from AI rows 8 no fallback to another edition
//   4 spoken switch by code        9 code in the Whisper prompt
//   5 spoken switch by name/alias 10 partial books + paragraph ranges handled
// plus: importing, removing and restoring an edition updates the catalogue,
// the spoken recognition and the Whisper prompt.
//
// Every edition is checked even after a failure, so the manifest is complete;
// the test fails at the end if any check failed. No verse text is printed or
// written: only references and 8-character fingerprints.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const ENABLED = process.env.DIVERSE_FULL_CATALOGUE_QA === '1';
const OUT = process.env.DIVERSE_QA_OUT;
const MIN = Number(process.env.DIVERSE_QA_MIN || 57);

const fp = text => crypto.createHash('sha256').update(String(text || '').trim()).digest('hex').slice(0, 8);
const PREFERRED = [['John', 3, 16], ['Psalms', 23, 1], ['Romans', 8, 28], ['Philippians', 4, 13], ['Matthew', 5, 3], ['Genesis', 1, 1], ['Mark', 1, 1], ['Titus', 3, 5]];

async function freePort() {
  const p = net.createServer();
  await new Promise((res, rej) => { p.once('error', rej); p.listen(0, '127.0.0.1', res); });
  const port = p.address().port;
  await new Promise(r => p.close(r));
  return port;
}

test('every installed edition passes the ten catalogue checks', { skip: !ENABLED ? 'run through scripts/qa-full-catalogue.js' : false, timeout: 30 * 60 * 1000 }, async () => {
  assert.ok(process.env.DIVERSE_DATA, 'must run on a copy (DIVERSE_DATA)');
  const bibleDb = require('../services/bibleDb');
  const { parse } = require('../services/parser');
  const transcribe = require('../routes/transcribe');
  const db = bibleDb.getDb();

  const catalogue = bibleDb.localTranslations();
  const entries = Object.entries(catalogue).sort(([a], [b]) => a.localeCompare(b));
  const listed = Object.fromEntries((await bibleDb.listTranslations()).map(t => [t.code, t]));
  const prompt = transcribe.buildWhisperPrompt(catalogue);
  const meta = Object.fromEntries(db.prepare('SELECT code, name, source, coverage, verses, books FROM translation_meta').all().map(m => [m.code, m]));

  const norm = v => String(v || '').replace(/\([^)]*\)/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const nameCount = new Map();
  for (const [, name] of entries) nameCount.set(norm(name), (nameCount.get(norm(name)) || 0) + 1);

  const stats = db.prepare(`SELECT COUNT(*) AS rows_, COUNT(DISTINCT book_num) AS books,
      SUM(COALESCE(NULLIF(verse_end, 0), verse) - verse + 1) AS covered,
      SUM(CASE WHEN COALESCE(NULLIF(verse_end, 0), verse) > verse THEN 1 ELSE 0 END) AS ranges,
      COUNT(DISTINCT CASE WHEN book_num <= 39 THEN book_num END) AS ot,
      COUNT(DISTINCT CASE WHEN book_num >= 40 THEN book_num END) AS nt
    FROM verses WHERE translation = ? AND substr(COALESCE(source, ''), 1, 3) != 'ai_' AND length(trim(text)) > 0`);
  const aiRows = db.prepare(`SELECT COUNT(*) AS c FROM verses WHERE translation = ? AND substr(COALESCE(source, ''), 1, 3) = 'ai_'`);
  const rowAt = db.prepare(`SELECT book, chapter, verse, COALESCE(NULLIF(verse_end, 0), verse) AS verse_end, text FROM verses
    WHERE translation = ? AND book = ? AND chapter = ? AND verse <= ? AND COALESCE(NULLIF(verse_end, 0), verse) >= ?
      AND substr(COALESCE(source, ''), 1, 3) != 'ai_' AND length(trim(text)) > 0 LIMIT 1`);
  const firstRow = db.prepare(`SELECT book, chapter, verse, COALESCE(NULLIF(verse_end, 0), verse) AS verse_end, text FROM verses
    WHERE translation = ? AND substr(COALESCE(source, ''), 1, 3) != 'ai_' AND length(trim(text)) > 0 ORDER BY book_num, chapter, verse LIMIT 1`);
  const rangeRow = db.prepare(`SELECT book, chapter, verse, verse_end, text FROM verses
    WHERE translation = ? AND verse_end > verse AND substr(COALESCE(source, ''), 1, 3) != 'ai_' ORDER BY book_num, chapter, verse LIMIT 1`);
  const booksOf = db.prepare(`SELECT DISTINCT book FROM verses WHERE translation = ? AND substr(COALESCE(source, ''), 1, 3) != 'ai_'`);
  const allBooks = db.prepare(`SELECT DISTINCT book, book_num FROM bible_structure ORDER BY book_num`).all();

  const results = [];
  for (const [code, name] of entries) {
    const r = { code, name, source: (meta[code] && meta[code].source) || 'seed', checks: {}, notes: [] };
    const check = (n, ok, note) => { r.checks[n] = ok ? 'pass' : 'FAIL'; if (!ok && note) r.notes.push(n + ': ' + note); };
    const s = stats.get(code);
    Object.assign(r, { rows: s.rows_, covered: s.covered || 0, books: s.books, ot: s.ot, nt: s.nt, ranges: s.ranges || 0, aiRows: aiRows.get(code).c });
    r.coverage = s.books === 66 ? 'Full Bible' : s.nt === 27 && s.ot === 0 ? 'New Testament' : s.ot === 39 && s.nt === 0 ? 'Old Testament' : `${s.books} books (${s.ot} OT, ${s.nt} NT)`;

    // 1. code and display name
    check(1, /^[A-Z0-9]{1,12}$/.test(code) && String(name).trim().length > 0, 'code or name missing');
    // 2. counts and coverage agree with what was recorded at import
    const m = meta[code];
    check(2, s.rows_ > 0 && (!m || m.verses == null || m.verses === s.covered || m.verses === s.rows_),
      s.rows_ === 0 ? 'no stored text' : `recorded ${m && m.verses} verses, stored ${s.covered} (${s.rows_} rows)`);
    // 3. AI cache rows never make an edition available
    const l = listed[code];
    check(3, !(s.rows_ === 0 && l && l.available && l.provider === 'local'), 'listed as available with AI rows only');

    // sample reference: a well-known verse if stored, else the first stored passage
    let sample = null;
    for (const [b, c, v] of PREFERRED) { const row = rowAt.get(code, b, c, v, v); if (row) { sample = { ...row, verse: v, rowVerse: row.verse }; break; } }
    if (!sample) { const row = firstRow.get(code); if (row) sample = { ...row, rowVerse: row.verse }; }
    r.sample = sample ? `${sample.book} ${sample.chapter}:${sample.verse}` : null;

    const spokenName = nameCount.get(norm(name)) === 1 ? String(name).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim() : code;
    r.spokenName = spokenName;
    // 4. switch by code; 5. switch by name/alias
    const byCode = parse('switch to ' + code, '__ACTIVE__');
    check(4, byCode && byCode.translationOnly && byCode.translation === code, 'got ' + JSON.stringify(byCode && byCode.translation));
    const byName = parse('switch to ' + spokenName, '__ACTIVE__');
    check(5, byName && byName.translationOnly && byName.translation === code, `"${spokenName}" got ` + JSON.stringify(byName && byName.translation));

    // 7 + 8. local retrieval: the stored text, under this edition, no fallback
    if (sample) {
      const v = await bibleDb.getVerse(sample.book, sample.chapter, sample.verse, code);
      check(7, v && fp(v.text) === fp(sample.text), v ? 'text differs from the stored row' : 'nothing returned');
      check(8, v && v.translation === code && !v.fallback, v ? `got ${v.translation}${v.fallback ? ' (fallback)' : ''}` : 'nothing returned');
      r.sampleFingerprint = fp(sample.text);
    } else { check(7, false, 'no sample'); check(8, false, 'no sample'); }
    // 9. Whisper prompt
    check(9, new RegExp('\\b' + code + '\\b').test(prompt), 'code missing from the Whisper prompt');

    // 10. partial books and paragraph ranges
    const ok10 = [];
    const range = rangeRow.get(code);
    if (range) {
      const mid = Math.floor((range.verse + range.verse_end) / 2);
      const v = await bibleDb.getVerse(range.book, range.chapter, mid, code);
      r.rangeSample = `${range.book} ${range.chapter}:${range.verse}-${range.verse_end}`;
      ok10.push(!!v && v.translation === code && !v.fallback && fp(v.text) === fp(range.text) || `verse ${mid} inside the paragraph ${r.rangeSample} not served from it`);
    }
    if (s.books < 66) {
      const have = new Set(booksOf.all(code).map(x => x.book));
      const missing = allBooks.find(b => !have.has(b.book));
      if (missing) {
        r.missingBookSample = `${missing.book} 1:1`;
        const v = await bibleDb.getVerse(missing.book, 1, 1, code);
        ok10.push(!v || (v.translation !== code && (v.fallback || v.requestedTranslation === code)) || `${missing.book} 1:1 (not in this edition) was labelled ${code}`);
      }
    }
    const bad10 = ok10.filter(x => x !== true);
    check(10, bad10.length === 0, bad10.join('; '));
    r.sampleRequest = sample ? `Turn to ${sample.book} chapter ${sample.chapter} verse ${sample.verse} in ${spokenName}` : '';
    results.push(r);
  }

  // 3 (library-wide): an edition whose only rows are AI cache is never offered as installed text
  const aiOnly = db.prepare(`SELECT translation FROM verses GROUP BY translation
    HAVING SUM(CASE WHEN substr(COALESCE(source, ''), 1, 3) = 'ai_' THEN 0 ELSE 1 END) = 0`).all().map(x => x.translation);
  const aiOnlyOffered = aiOnly.filter(code => listed[code] && listed[code].available && listed[code].provider === 'local');

  // 4, 5 (route) and 6 through the running server's detect route
  const port = await freePort();
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), DIVERSE_STATE_FILE: path.join(process.env.DIVERSE_DATA, 'qa-state.json') }, stdio: 'pipe' });
  let log = ''; server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  const detect = body => fetch(`http://127.0.0.1:${port}/api/detect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fast: true, cues: false, ...body }) }).then(x => x.json());
  try {
    for (let i = 0; i < 300; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) break; } catch (e) {} await new Promise(x => setTimeout(x, 100)); }
    for (const r of results) {
      const sw = await detect({ text: 'switch to ' + r.spokenName, activeTranslation: '__ACTIVE__' });
      const okSwitch = sw.type === 'translation_change' && sw.new_translation === r.code;
      if (!okSwitch) { r.checks[5] = 'FAIL'; r.notes.push('5: detect route switch got ' + JSON.stringify(sw.new_translation || sw.type)); }
      if (!r.sampleRequest) { r.checks[6] = 'FAIL'; continue; }
      const d = await detect({ text: r.sampleRequest, activeTranslation: r.code === 'KJV' ? 'ASV' : 'KJV' });
      const ok6 = d.type === 'explicit' && d.verseData && d.verseData.translation === r.code && !d.verseData.fallback && d.reference && d.reference.translation === r.code;
      r.checks[6] = ok6 ? 'pass' : 'FAIL';
      if (!ok6) r.notes.push('6: ' + JSON.stringify({ type: d.type, ref: d.verseData && d.verseData.reference, tr: d.verseData && d.verseData.translation, fallback: d.verseData && d.verseData.fallback }));
    }
  } finally {
    const exited = new Promise(x => server.once('exit', x)); server.kill('SIGTERM'); await Promise.race([exited, new Promise(x => setTimeout(x, 5000))]);
  }

  // import, remove and restore update the catalogue, spoken recognition and Whisper prompt
  const lifecycle = [];
  {
    const library = require('../services/library');
    const backup = require('../services/dbBackup');
    const code = 'QAZZ', name = 'Quality Assurance Zeta Zeta Edition';
    const heard = () => parse('switch to ' + name, '__ACTIVE__');
    const inPrompt = () => /\bQAZZ\b/.test(transcribe.buildWhisperPrompt());
    const john = db.prepare(`SELECT max_verse FROM bible_structure WHERE book = 'John' AND chapter = 3`).get();
    const rows = [];
    for (const ch of [1, 2, 3, 4, 5]) {
      const mx = (db.prepare(`SELECT max_verse FROM bible_structure WHERE book = 'Genesis' AND chapter = ?`).get(ch) || {}).max_verse || 0;
      for (let v = 1; v <= mx; v++) rows.push({ book: 'Genesis', chapter: ch, verse: v, text: `Synthetic QA wording ${ch}:${v}.` });
    }
    for (let v = 1; v <= (john ? john.max_verse : 0); v++) rows.push({ book: 'John', chapter: 3, verse: v, text: `Synthetic QA wording John 3:${v}.` });
    const before = backup.create('qa-before-import');
    library.store(code, name, rows, { source: 'qa-synthetic', licence: 'synthetic test text' });
    lifecycle.push(['import: listed, heard by name, in the Whisper prompt', !!bibleDb.localTranslations()[code] && (heard() || {}).translation === code && inPrompt()]);
    const withIt = backup.create('qa-with-import');
    library.remove(code);
    lifecycle.push(['remove: gone from list, speech and prompt', !bibleDb.localTranslations()[code] && !(heard() || {}).translation && !inPrompt()]);
    backup.restore(withIt.name, withIt.name);
    lifecycle.push(['restore (with it): back in list, speech and prompt', !!bibleDb.localTranslations()[code] && (heard() || {}).translation === code && inPrompt()]);
    backup.restore(before.name, before.name);
    lifecycle.push(['restore (before it): gone again', !bibleDb.localTranslations()[code] && !(heard() || {}).translation && !inPrompt()]);
    lifecycle.push(['catalogue size back to the original', Object.keys(bibleDb.localTranslations()).length === entries.length]);
  }

  // write the manifest, the voice test list and a summary
  const failed = results.filter(r => Object.values(r.checks).includes('FAIL'));
  if (OUT) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'translation-manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), editions: results, aiOnly, aiOnlyOffered, lifecycle }, null, 2));
    const md = [`# Di.Verse translation QA manifest`, ``, `Generated ${new Date().toISOString()} from a read-only copy of the library. ${results.length} editions, ${failed.length} with a failed check.`, `No verse text is included: "fp" is an 8-character fingerprint of the stored text.`, ``,
      `Checks: 1 code/name · 2 counts · 3 no AI-only availability · 4 switch by code · 5 switch by name · 6 reference + edition · 7 stored text · 8 no fallback · 9 Whisper prompt · 10 partial books / paragraph ranges`, ``,
      `| Code | Name | Coverage | Rows | Verses covered | Ranges | AI rows | Sample | fp | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | Notes |`, `|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`,
      ...results.map(r => `| ${r.code} | ${r.name} | ${r.coverage} | ${r.rows} | ${r.covered} | ${r.ranges} | ${r.aiRows} | ${r.sample || '—'}${r.rangeSample ? ' (range ' + r.rangeSample + ')' : ''} | ${r.sampleFingerprint || ''} | ${[1,2,3,4,5,6,7,8,9,10].map(n => r.checks[n] === 'pass' ? '✓' : r.checks[n] ? '✗' : '—').join(' | ')} | ${r.notes.join('; ').replace(/\|/g, '/')} |`),
      ``, `## AI cache rows`, ``, aiOnly.length ? `Editions with AI cache rows only (never installed text): ${aiOnly.join(', ')}. Offered as installed: ${aiOnlyOffered.length ? aiOnlyOffered.join(', ') + ' ✗' : 'none ✓'}` : 'No edition consists of AI cache rows only. ✓',
      ``, `## Import, remove and restore`, ``, ...lifecycle.map(([l, ok]) => `- ${ok ? '✓' : '✗'} ${l}`), ``];
    fs.writeFileSync(path.join(OUT, 'translation-manifest.md'), md.join('\n'));
    const csv = ['code,name,say_to_switch,say_reference_with_edition,expected_reference,heard_correctly(Y/N),projected_correctly(Y/N),notes',
      ...results.map(r => [r.code, r.name, `switch to ${r.spokenName}`, r.sampleRequest, r.sample || '', '', '', ''].map(x => `"${String(x).replace(/"/g, '""')}"`).join(','))];
    fs.writeFileSync(path.join(OUT, 'voice-test-list.csv'), csv.join('\n') + '\n');
  }
  console.log(`[Catalogue QA] ${results.length} editions checked; ${failed.length} with failures; lifecycle ${lifecycle.filter(x => x[1]).length}/${lifecycle.length}.`);
  for (const r of failed) console.log(`  ✗ ${r.code}: ${r.notes.join('; ')}`);

  assert.deepEqual(aiOnlyOffered, [], 'editions with only AI cache rows offered as installed text');
  assert.ok(results.length >= MIN, `expected at least ${MIN} installed editions, found ${results.length}`);
  for (const [label, ok] of lifecycle) assert.ok(ok, label);
  assert.equal(failed.length, 0, failed.map(r => r.code).join(', ') + ' failed (see the manifest)');
});
