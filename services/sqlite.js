// One way to open a SQLite database, whichever engine this Node has.
//
// Node 22.5+ has SQLite built in (node:sqlite), so the packaged Mac and
// Windows apps need no compiled add-on: the same files run everywhere. On an
// older Node, better-sqlite3 (installed as an optional dependency) is used.
// Both offer the same small surface used here: prepare().get/all/run, exec,
// pragma and transaction.

// node:sqlite prints an "experimental" warning on first use; it is stable
// enough for this and the warning only confuses the Terminal
const emitWarning = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  if (/SQLite is an experimental feature/.test(String(warning && warning.message || warning))) return;
  return emitWarning.call(process, warning, ...rest);
};

let builtIn = null;
try { builtIn = require('node:sqlite').DatabaseSync; } catch (e) { builtIn = null; }

function open(file, { readonly = false } = {}) {
  if (builtIn) {
    const db = new builtIn(file, readonly ? { readOnly: true } : {});
    db.exec('PRAGMA busy_timeout = 5000'); // wait for another process's write, as better-sqlite3 does
    return {
      engine: 'node:sqlite',
      prepare: sql => db.prepare(sql),
      exec: sql => db.exec(sql),
      pragma: p => db.exec('PRAGMA ' + p),
      // like better-sqlite3: wrap fn so it runs inside one transaction
      transaction: fn => (...args) => {
        db.exec('BEGIN');
        try { const r = fn(...args); db.exec('COMMIT'); return r; }
        catch (err) { try { db.exec('ROLLBACK'); } catch (e) {} throw err; }
      },
      close: () => db.close(),
    };
  }
  const Database = require('better-sqlite3');
  const db = new Database(file, readonly ? { readonly: true } : undefined);
  return {
    engine: 'better-sqlite3',
    prepare: sql => db.prepare(sql),
    exec: sql => db.exec(sql),
    pragma: p => db.pragma(p),
    transaction: fn => db.transaction(fn),
    close: () => db.close(),
  };
}

module.exports = { open, engine: builtIn ? 'node:sqlite' : 'better-sqlite3' };
