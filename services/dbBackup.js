// Backups of the Bible database (bible.db), and restoring one.
//
// A backup is made with SQLite's own VACUUM INTO, which writes a complete,
// consistent copy from inside a read transaction: it includes changes still
// sitting in the WAL file (bible.db-wal), and nothing written halfway through
// can end up in it. Copying bible.db on its own would miss those changes. It
// works the same on both engines (node:sqlite and better-sqlite3), so there
// is one code path to trust.
//
// Backups live in <data folder>/backups/, one .db file each with a .json
// beside it (when, size, which database it came from). A name is never reused,
// so an existing backup is never overwritten.
//
// Restoring is deliberate: the caller must name the backup twice (the API
// takes `confirm` equal to the name), the backup is integrity-checked first,
// the current database is backed up before it is replaced, and the restored
// file is integrity-checked once it is open. If that check fails, the previous
// database is put back and the restore is reported as failed.
//
// Everything here runs synchronously, so while a backup or restore is under
// way no other request in this process can read or write the database. Another
// program writing bible.db at the same moment (the `npm run bibles` command in
// a second Terminal) is not covered: don't restore while one is running.
const fs = require('fs');
const path = require('path');
const sqlite = require('./sqlite');
const paths = require('./paths');
const bibleDb = require('./bibleDb');

const DIR = path.join(paths.DATA, 'backups');
const NAME = /^bible-[0-9TZ-]+(?:-[a-z0-9-]{1,40})?(?:-\d+)?\.db$/;

const quote = p => "'" + String(p).replace(/'/g, "''") + "'";

// 'ok', or what SQLite found wrong (first few lines)
function integrity(db) {
  const rows = db.prepare('PRAGMA integrity_check').all();
  const msgs = rows.map(r => r.integrity_check != null ? r.integrity_check : Object.values(r)[0]);
  return msgs.length === 1 && msgs[0] === 'ok' ? 'ok' : msgs.slice(0, 5).join('; ');
}

function checkFile(file) {
  let db;
  try {
    db = sqlite.open(file, { readonly: true });
    const result = integrity(db);
    const tables = new Set(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map(r => r.name));
    if (result !== 'ok') return { ok: false, reason: 'integrity check failed: ' + result };
    if (!tables.has('verses')) return { ok: false, reason: 'this is not a Di.Verse Bible database (no verses table)' };
    const verses = db.prepare('SELECT COUNT(*) AS c FROM verses').get().c;
    return { ok: true, verses };
  } catch (e) {
    return { ok: false, reason: e.message };
  } finally {
    try { db && db.close(); } catch (e) {}
  }
}

function stamp() { return new Date().toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-'); }

function freeName(label) {
  const base = 'bible-' + stamp() + (label ? '-' + label : '');
  let name = base + '.db';
  for (let i = 2; fs.existsSync(path.join(DIR, name)); i++) name = base + '-' + i + '.db';
  return name;
}

let busy = false;
function exclusive(fn) {
  if (busy) throw new Error('A backup or restore is already running');
  busy = true;
  try { return fn(); } finally { busy = false; }
}

// label: a few letters for the file name ('manual', 'before-restore', ...)
function create(label = 'manual') {
  return exclusive(() => createUnlocked(label));
}

function createUnlocked(label) {
  label = String(label || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
  fs.mkdirSync(DIR, { recursive: true });
  const name = freeName(label);
  const file = path.join(DIR, name);
  const db = bibleDb.getDb();
  db.exec('VACUUM INTO ' + quote(file)); // refuses to write over an existing file
  const check = checkFile(file);
  if (!check.ok) {
    try { fs.unlinkSync(file); } catch (e) {}
    throw new Error('The backup was written but failed its check (' + check.reason + '), so it was deleted');
  }
  const info = { name, createdAt: new Date().toISOString(), bytes: fs.statSync(file).size, verses: check.verses,
    source: bibleDb.DB_PATH, engine: sqlite.engine, label, integrity: 'ok' };
  fs.writeFileSync(file.replace(/\.db$/, '.json'), JSON.stringify(info, null, 2));
  return info;
}

// Newest first. No full paths: just names and facts.
function list() {
  let files = [];
  try { files = fs.readdirSync(DIR).filter(f => NAME.test(f)); } catch (e) { return []; }
  return files.map(name => {
    let info = {};
    try { info = JSON.parse(fs.readFileSync(path.join(DIR, name.replace(/\.db$/, '.json')), 'utf8')); } catch (e) {}
    const st = fs.statSync(path.join(DIR, name));
    return { name, createdAt: info.createdAt || st.mtime.toISOString(), bytes: st.size, verses: info.verses ?? null, label: info.label || '' };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
}

// Put `from` in place of bible.db. The database must be closed.
function swapIn(from) {
  const target = bibleDb.DB_PATH;
  const tmp = target + '.restoring';
  fs.copyFileSync(from, tmp);
  const fd = fs.openSync(tmp, 'r+'); fs.fsyncSync(fd); fs.closeSync(fd);
  // a stale WAL from the old file must never be applied to the new one
  for (const ext of ['-wal', '-shm']) { try { fs.unlinkSync(target + ext); } catch (e) {} }
  fs.renameSync(tmp, target);
}

function afterReopen() {
  try { require('./navigation')._reset(); } catch (e) {}
  bibleDb.invalidateTranslations();
}

// Returns { restored, safetyBackup, verses } or throws with the reason.
// The current database is left exactly as it was if anything goes wrong.
function restore(name, confirm) {
  return exclusive(() => {
    if (!NAME.test(String(name || ''))) throw new Error('Unknown backup');
    if (confirm !== name) throw new Error('Restore not confirmed: send confirm equal to the backup name');
    const file = path.join(DIR, name);
    if (!fs.existsSync(file)) throw new Error('That backup is not in the backups folder');
    const check = checkFile(file);
    if (!check.ok) throw new Error('That backup can\'t be used: ' + check.reason);

    const safety = createUnlocked('before-restore');
    bibleDb.closeDb();
    try {
      swapIn(file);
      const result = integrity(bibleDb.getDb());
      if (result !== 'ok') throw new Error('integrity check after restore failed: ' + result);
    } catch (err) {
      // put the previous database back
      try { bibleDb.closeDb(); } catch (e) {}
      swapIn(path.join(DIR, safety.name));
      bibleDb.getDb();
      afterReopen();
      throw new Error('Restore failed (' + err.message + '). The previous database is back in place.');
    }
    afterReopen();
    const verses = bibleDb.getDb().prepare('SELECT COUNT(*) AS c FROM verses').get().c;
    return { restored: name, safetyBackup: safety.name, verses };
  });
}

// What the operator sees under Setup → Bible database
function health() {
  const file = bibleDb.DB_PATH;
  const out = {
    mode: paths.packaged ? 'packaged' : 'development',
    dataFolder: paths.DATA, database: file, backupsFolder: DIR, engine: sqlite.engine,
    exists: fs.existsSync(file), readable: false, bytes: null, walBytes: null, integrity: null,
    translations: [], backups: list().length,
  };
  if (!out.exists) return out;
  try { fs.accessSync(file, fs.constants.R_OK); out.readable = true; } catch (e) { return out; }
  out.bytes = fs.statSync(file).size;
  try { out.walBytes = fs.statSync(file + '-wal').size; } catch (e) { out.walBytes = 0; }
  try {
    const db = bibleDb.getDb();
    out.integrity = integrity(db);
    const counts = Object.fromEntries(db.prepare('SELECT translation, COUNT(*) AS c FROM verses WHERE substr(source, 1, 3) != \'ai_\' GROUP BY translation').all().map(r => [r.translation, r.c]));
    const meta = Object.fromEntries(db.prepare('SELECT code, name, coverage, source, installed_at FROM translation_meta').all().map(m => [m.code, m]));
    const local = bibleDb.localTranslations();
    for (const code of new Set([...Object.keys(counts), ...Object.keys(meta)])) {
      const m = meta[code] || {};
      out.translations.push({ code, name: m.name || local[code] || code, verses: counts[code] || 0, coverage: m.coverage || null,
        source: m.source || 'seed', installedAt: m.installed_at || null });
    }
    out.translations.sort((a, b) => a.code.localeCompare(b.code));
  } catch (e) {
    out.integrity = 'could not open: ' + e.message;
  }
  // only backups Di.Verse made and checked (they have a .json record) count as the last backup
  const last = list().find(b => b.verses != null);
  out.lastBackup = last ? last.createdAt : null;
  return out;
}

module.exports = { create, list, restore, health, checkFile, DIR };
