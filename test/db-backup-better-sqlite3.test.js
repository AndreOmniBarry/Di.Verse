// The backup and restore checks on the better-sqlite3 engine (the fallback
// for a Node without node:sqlite). better-sqlite3 is an optional dependency:
// CI installs with --omit=optional, so there these checks are reported as
// skipped, with the reason, rather than silently passing.
let available = true;
try { require('better-sqlite3'); } catch (e) { available = false; }
if (available) {
  process.env.DIVERSE_SQLITE_ENGINE = 'better-sqlite3';
  require('./helpers/backupScenario')('better-sqlite3');
} else {
  require('node:test')('backup and restore on better-sqlite3', { skip: 'better-sqlite3 is not installed (optional dependency)' }, () => {});
}
