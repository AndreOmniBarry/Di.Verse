// Manage the local Bible library from Terminal.
//
//   npm run bibles                       list installed + free to add
//   npm run bibles -- add BSB WEB        download free translations (about 1 s each)
//   npm run bibles -- add all            every free translation
//   npm run bibles -- remove BSB
//   npm run bibles -- import FILE --code NKJV --name "New King James Version" --obtained "how you're licensed"
require('dotenv').config({ path: require('../services/paths').ENV_FILE, quiet: true });
const fs = require('fs');
const library = require('../services/library');
const { importFile } = require('../services/importer');

const [cmd, ...args] = process.argv.slice(2);
const flag = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };

(async () => {
  if (!cmd || cmd === 'list') {
    const { installed, free } = library.list();
    console.log('\nInstalled (instant, offline):');
    for (const m of installed) console.log(`  ${m.code.padEnd(8)} ${m.name.padEnd(36)} ${m.coverage || ''}${m.missing ? ` (${m.missing} verses not in this text)` : ''}  [${m.source}]`);
    console.log('  + KJV, ASV, YLT, BBE from npm run seed');
    console.log('\nFree to add (npm run bibles -- add CODE):');
    for (const f of free.filter(f => !f.installed)) console.log(`  ${f.code.padEnd(8)} ${f.name.padEnd(36)} ${f.note}`);
    console.log('');
  } else if (cmd === 'add') {
    const codes = args[0] === 'all' ? library.FREE.map(f => f.code) : args.map(a => a.toUpperCase());
    for (const c of codes) {
      try { const r = await library.install(c, m => console.log('  ' + m)); console.log(`✓ ${r.code}: ${r.coverage}, ${r.verses} verses\n`); }
      catch (err) { console.error(`✗ ${c}: ${err.message}\n`); process.exitCode = 1; }
    }
  } else if (cmd === 'remove') {
    for (const c of args) console.log(`Removed ${c}: ${library.remove(c)} verses`);
  } else if (cmd === 'import') {
    const file = args[0];
    if (!file || !fs.existsSync(file)) throw new Error('Give the file to import: npm run bibles -- import FILE --code X --name "..." --obtained "..."');
    const r = importFile({ content: fs.readFileSync(file), filename: file, code: flag('code'), name: flag('name'), obtained: flag('obtained') });
    console.log(`✓ ${r.code} (${r.format}): ${r.coverage}, ${r.verses} verses` + (r.missingBooks.length && r.missingBooks.length < 66 ? `\n  Books not in the file: ${r.missingBooks.join(', ')}` : ''));
  } else {
    console.log('Commands: list | add CODE… | add all | remove CODE… | import FILE --code X --name "…" --obtained "…"');
  }
})().catch(err => { console.error('✗ ' + err.message); process.exit(1); });
