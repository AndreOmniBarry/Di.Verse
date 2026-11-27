// The backup and restore checks, run once per SQLite engine
// (test/db-backup.test.js and test/db-backup-better-sqlite3.test.js).
module.exports = function run(expectedEngine) {
  const temp = require('./tempBible');
  const test = require('node:test');
  const assert = require('node:assert');
  const fs = require('fs');
  const path = require('path');
  const sqlite = require('../../services/sqlite');
  const bibleDb = require('../../services/bibleDb');
  const library = require('../../services/library');
  const backup = require('../../services/dbBackup');
  const parser = require('../../services/parser');
  const spoken = () => parser.detectTranslation('can we have that in the Test Translation');

  test.after(() => { bibleDb.closeDb(); temp.cleanup(); });

  const count = (code) => bibleDb.getDb().prepare('SELECT COUNT(*) AS c FROM verses WHERE translation = ?').get(code).c;
  const countIn = (file, code) => { const db = sqlite.open(file, { readonly: true }); try { return db.prepare('SELECT COUNT(*) AS c FROM verses WHERE translation = ?').get(code).c; } finally { db.close(); } };

  test(`engine is ${expectedEngine}`, () => assert.strictEqual(sqlite.engine, expectedEngine));

  test('uses a temporary data folder, never the real database', () => {
    assert.ok(bibleDb.DB_PATH.startsWith(temp.dir));
    assert.ok(backup.DIR.startsWith(temp.dir));
  });

  let first;
  test('a backup includes changes still in the WAL file', () => {
    temp.seed();
    library.store('TST', 'Test Translation', temp.rows('TST'), { source: 'test' });
    const wal = bibleDb.DB_PATH + '-wal';
    assert.ok(fs.existsSync(wal) && fs.statSync(wal).size > 0, 'expected uncheckpointed WAL data');
    first = backup.create('manual');
    const file = path.join(backup.DIR, first.name);
    assert.strictEqual(countIn(file, 'TST'), count('TST'));
    assert.ok(count('TST') > 100);
    assert.strictEqual(first.integrity, 'ok');
    assert.strictEqual(first.source, bibleDb.DB_PATH);
    assert.ok(first.bytes > 0 && first.createdAt);
    assert.ok(fs.existsSync(file.replace(/\.db$/, '.json')));
  });

  test('a backup never overwrites another, even in the same second', () => {
    const a = backup.create('manual'), b = backup.create('manual');
    assert.notStrictEqual(a.name, b.name);
    assert.ok(backup.list().length >= 3);
  });

  test('the list gives names and facts, not folder paths', () => {
    const json = JSON.stringify(backup.list());
    assert.ok(!json.includes(temp.dir));
  });

  test('restore refuses without confirmation and leaves the database alone', () => {
    library.remove('TST');
    assert.strictEqual(count('TST'), 0);
    assert.strictEqual(spoken(), null, 'removed translation is no longer recognised');
    assert.throws(() => backup.restore(first.name), /not confirmed/);
    assert.throws(() => backup.restore(first.name, 'something else'), /not confirmed/);
    assert.throws(() => backup.restore('../bible.db', '../bible.db'), /Unknown backup/);
    assert.strictEqual(count('TST'), 0);
  });

  test('restore brings the backup back and saves the replaced database first', () => {
    const before = backup.list().length;
    const r = backup.restore(first.name, first.name);
    assert.strictEqual(r.restored, first.name);
    assert.ok(count('TST') > 100, 'restored translation is readable');
    assert.strictEqual(backup.list().length, before + 1);
    assert.match(r.safetyBackup, /before-restore/);
    assert.strictEqual(countIn(path.join(backup.DIR, r.safetyBackup), 'TST'), 0, 'safety backup is the database that was replaced');
    assert.strictEqual(backup.health().integrity, 'ok');
    assert.ok(!fs.existsSync(bibleDb.DB_PATH + '.restoring'));
  });

  test('restored text comes back through the normal lookup and translation list', async () => {
    const v = await bibleDb.getVerse('John', 3, 16, 'TST');
    assert.strictEqual(v.text, 'TST John 3:16');
    assert.ok(!v.fallback);
    assert.ok(bibleDb.localTranslations().TST);
  });

  test('after a restore, the catalogue parser recognises the restored translation again', () => {
    // the v1.11.0 parser builds its spoken-translation list from the installed catalogue
    assert.strictEqual(spoken(), 'TST');
  });

  test('a damaged backup is refused and the current database stays', () => {
    const bad = 'bible-2026-01-01T00-00-00Z-damaged.db';
    fs.writeFileSync(path.join(backup.DIR, bad), 'this is not a database'.repeat(200));
    const n = count('TST');
    assert.throws(() => backup.restore(bad, bad), /can't be used/);
    assert.strictEqual(count('TST'), n);
    assert.strictEqual(backup.health().integrity, 'ok');
  });

  test('a missing backup and a database that is not a Bible are refused', () => {
    const n = count('TST');
    const missing = 'bible-2026-01-01T00-00-00Z-missing.db';
    assert.throws(() => backup.restore(missing, missing), /not in the backups folder/);
    const other = 'bible-2026-01-01T00-00-01Z-notbible.db';
    const db = sqlite.open(path.join(backup.DIR, other));
    db.exec('CREATE TABLE songs (id INTEGER PRIMARY KEY, title TEXT)');
    db.close();
    assert.throws(() => backup.restore(other, other), /not a Di\.Verse Bible database/);
    assert.strictEqual(count('TST'), n, 'current database untouched');
  });

  test('if the restored database fails to open, the previous one is put back', () => {
    library.remove('TST');
    const real = bibleDb.getDb;
    let calls = 0;
    bibleDb.getDb = () => { if (++calls === 2) throw new Error('simulated broken file'); return real(); };
    try {
      assert.throws(() => backup.restore(first.name, first.name), /Restore failed \(simulated broken file\)\. The previous database is back/);
    } finally { bibleDb.getDb = real; }
    assert.strictEqual(count('TST'), 0, 'the database from before the restore is in place');
    assert.strictEqual(backup.health().integrity, 'ok');
  });

  test('health reports the active database and its translations', () => {
    const h = backup.health();
    assert.strictEqual(h.database, bibleDb.DB_PATH);
    assert.strictEqual(h.mode, 'packaged'); // DIVERSE_DATA is set
    assert.ok(h.exists && h.readable);
    assert.strictEqual(h.engine, expectedEngine);
    assert.ok(h.translations.find(x => x.code === 'KJV' && x.verses > 100));
  });
};
