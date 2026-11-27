// Browser check: Setup -> Bible database, driven through the real page.
//   health rows, Back up now, cancelling a restore, a confirmed restore,
//   a damaged backup refused, and lookups still working afterwards.
//
//   node test/browser/setup-database.js [screenshot.png]
//
// Starts its own Di.Verse on a free port with a throwaway copy of
// db/bible.db (seed it first with `npm run seed`). Never touches db/bible.db.
const { spawn, execSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const assert = require('assert');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require(execSync('npm root -g').toString().trim() + '/playwright').chromium; }
const ROOT = path.join(__dirname, '..', '..');
const shot = process.argv[2];

const freePort = () => new Promise((resolve, reject) => {
  const p = net.createServer(); p.once('error', reject);
  p.listen(0, '127.0.0.1', () => { const port = p.address().port; p.close(() => resolve(port)); });
});

let passed = 0;
const ok = (cond, label) => { assert.ok(cond, label); passed++; console.log('  ✓ ' + label); };

(async () => {
  const src = path.join(ROOT, 'db', 'bible.db');
  if (!fs.existsSync(src)) throw new Error('db/bible.db not found: run npm run seed first');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'diverse-setup-db-'));
  fs.mkdirSync(path.join(data, 'db'));
  execSync(`sqlite3 "${src}" ".backup '${path.join(data, 'db', 'bible.db')}'"`); // consistent copy
  const PORT = await freePort(), base = 'http://localhost:' + PORT;
  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: { ...process.env, PORT: String(PORT), DIVERSE_DATA: data, DIVERSE_NO_BROWSER: '1', NODE_NO_WARNINGS: '1',
    OPENAI_API_KEY: '', GROQ_API_KEY: '', GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '', APIBIBLE_KEY: '' }, stdio: 'ignore' });
  const cleanup = () => { srv.kill(); fs.rmSync(data, { recursive: true, force: true }); };
  try {
    for (let i = 0; i < 150; i++) { try { await fetch(base + '/api/translations'); break; } catch (e) { await new Promise(r => setTimeout(r, 100)); } }
    const b = await chromium.launch();
    const p = await b.newPage({ viewport: { width: 900, height: 1400 } });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    let dialogAnswer = true, dialogs = 0;
    p.on('dialog', d => { dialogs++; dialogAnswer ? d.accept() : d.dismiss(); });
    await p.goto(base + '/setup/'); await p.waitForTimeout(1200);
    const text = id => p.textContent(id);
    const backups = async () => (await (await fetch(base + '/api/db/backups')).json()).backups;

    console.log('— Health —');
    ok(/integrity not checked yet/.test(await text('#dbHealth')), 'opening Setup does not run the slow full check');
    await p.click('h2:has-text("Bible database") >> text=Check again'); await p.waitForTimeout(1500);
    const h = await text('#dbHealth');
    ok(/Healthy/.test(h) && /Integrity checked/.test(h), 'Check again runs it: Healthy, with the time of the check');
    ok(h.includes(path.join(data, 'db', 'bible.db')), 'shows the active database (the throwaway copy)');
    ok(/Installed app|development/.test(h), 'shows packaged / development mode');
    ok(/engine node:sqlite|engine better-sqlite3/.test(h), 'shows the SQLite engine');
    ok(/translations? stored/.test(h) && /KJV/.test(h), 'lists stored translations with verse counts');
    ok(/No backup yet/.test(h), 'backup status: none yet');

    console.log('— Back up now —');
    await p.click('text=Back up now'); await p.waitForTimeout(2500);
    ok(/Backed up \(.+ MB, checked\)/.test(await text('#dbMsg')), 'reports the backup with its size, checked');
    const list = await backups();
    ok(list.length === 1, 'one backup listed');
    ok(/Last backup/.test(await text('#dbHealth')), 'backup status updated');
    ok(fs.existsSync(path.join(data, 'backups', list[0].name.replace(/\.db$/, '.json'))), 'metadata file written beside it');

    console.log('— Restore, cancelled —');
    dialogAnswer = false;
    const before = (await backups()).length;
    await p.click('#dbBackups button >> nth=0'); await p.waitForTimeout(800);
    ok(dialogs === 1 && (await backups()).length === before, 'cancelling the confirmation changes nothing');

    console.log('— Restore, confirmed —');
    dialogAnswer = true;
    await p.click('#dbBackups button >> nth=0'); await p.waitForTimeout(3000);
    ok(/Restored\. .+ verses stored, integrity checked/.test(await text('#dbMsg')), 'reports the restore, integrity checked');
    ok((await backups()).some(x => x.label === 'before-restore'), 'safety backup of the replaced database listed');
    ok(/Healthy/.test(await text('#dbHealth')), 'still healthy after restore');
    const v = await (await fetch(base + '/api/verse?book=John&chapter=3&verse=16')).json();
    ok(v.reference === 'John 3:16' && v.translation === 'KJV' && v.text.length > 20, 'verse lookups work after restore');

    console.log('— Damaged backup —');
    const bad = 'bible-2026-01-01T00-00-00Z-damaged.db';
    fs.writeFileSync(path.join(data, 'backups', bad), 'not a database'.repeat(500));
    await p.click('h2:has-text("Bible database") >> text=Check again'); await p.waitForTimeout(1200);
    const badButton = `#dbBackups button[onclick*="${bad}"]`;
    ok(await p.$(badButton), 'damaged file appears in the list with its own Restore button');
    await p.click(badButton); await p.waitForTimeout(1500);
    const refusal = await text('#dbMsg'); if (!/can't be used/.test(refusal)) console.log('   message was: ' + refusal);
    ok(/can't be used/.test(refusal), 'damaged backup refused with the reason');
    const v2 = await (await fetch(base + '/api/verse?book=John&chapter=3&verse=16')).json();
    ok(v2.reference === 'John 3:16' && /Healthy/.test(await text('#dbHealth')), 'current database unchanged and healthy');

    if (shot) {
      const el = await p.$('h2:has-text("Bible database")'); const bb = await el.boundingBox();
      await p.screenshot({ path: shot, fullPage: true, clip: { x: 0, y: bb.y - 10, width: 900, height: 470 } });
    }
    ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
    console.log(`\n${passed} checks passed`);
    await b.close();
  } finally { cleanup(); }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
