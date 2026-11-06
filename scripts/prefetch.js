// Load a sermon's verses ahead of time so they are instant and work offline.
// Usage: npm run prefetch -- TPT "John 3:16; Romans 8:28-30; Psalm 23:1-6"
// Confirmed AI answers (verified / web-grounded) are saved; anything
// unverified is listed so you can check it before the service.
require('dotenv').config({ quiet: true });
const { getVerse } = require('../services/bibleDb');
const { resolveBook } = require('../services/parser');

function expand(list) {
  const refs = [];
  for (const part of list.split(/[;\n]+/).map(s => s.trim()).filter(Boolean)) {
    const m = part.match(/^(.+?)\s+(\d+):(\d+)(?:\s*-\s*(\d+))?$/);
    const book = m && resolveBook(m[1]);
    if (!book) { console.log(`  ? Could not read "${part}" — use the form "John 3:16" or "Romans 8:28-30"`); continue; }
    for (let v = +m[3]; v <= +(m[4] || m[3]); v++) refs.push({ book: book.name, chapter: +m[2], verse: v });
  }
  return refs;
}

(async () => {
  const [translation, ...rest] = process.argv.slice(2);
  if (!translation || !rest.length) {
    console.log('Usage: npm run prefetch -- <TRANSLATION> "John 3:16; Romans 8:28-30"');
    process.exit(1);
  }
  const code = translation.toUpperCase();
  const refs = expand(rest.join(' '));
  const check = [];
  console.log(`\nPrefetching ${refs.length} verses in ${code}...\n`);
  for (const r of refs) {
    const v = await getVerse(r.book, r.chapter, r.verse, code);
    const label = !v ? 'NOT FOUND'
      : v.fallback ? `KJV fallback — ${v.fallbackReason}`
      : v.verification ? v.verification.toUpperCase()
      : v.source;
    console.log(`  ${(r.book + ' ' + r.chapter + ':' + r.verse).padEnd(22)} ${label}`);
    if (!v || v.fallback || v.verification === 'unverified') check.push(r);
  }
  console.log(`\n${refs.length - check.length}/${refs.length} ready.`);
  if (check.length) console.log('Check these before the service:', check.map(r => `${r.book} ${r.chapter}:${r.verse}`).join(', '));
  process.exit(0);
})();
