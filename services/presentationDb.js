// Presentation data: sermon sessions and notes, the presentation history and
// virtual-set profiles. Kept in its own file (db/presentation.db in the data
// folder) so it never touches bible.db or songs.db.
//
// Schema version 1 (created on first open; later versions add migrations to
// MIGRATIONS below, each run once and recorded in schema_version).
const sqlite = require('./sqlite');
const paths = require('./paths');

let db;

const MIGRATIONS = [
  // 1: sermon sessions and notes, presentation history, virtual-set profiles
  `CREATE TABLE IF NOT EXISTS sermon_sessions (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     title       TEXT,
     started_at  TEXT NOT NULL,
     ended_at    TEXT
   );
   CREATE TABLE IF NOT EXISTS sermon_notes (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     session_id   INTEGER NOT NULL REFERENCES sermon_sessions(id) ON DELETE CASCADE,
     kind         TEXT NOT NULL CHECK (kind IN ('title', 'point', 'highlight')),
     number       INTEGER,
     original     TEXT NOT NULL,
     display      TEXT,
     status       TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'approved', 'dismissed')),
     source       TEXT NOT NULL DEFAULT 'speech' CHECK (source IN ('speech', 'manual')),
     refs         TEXT NOT NULL DEFAULT '[]',
     heard_at     TEXT,
     created_at   TEXT NOT NULL,
     updated_at   TEXT NOT NULL,
     shown_count  INTEGER NOT NULL DEFAULT 0,
     last_shown_at TEXT
   );
   CREATE INDEX IF NOT EXISTS idx_notes_session ON sermon_notes(session_id, id);
   CREATE TABLE IF NOT EXISTS presentation_history (
     id      INTEGER PRIMARY KEY AUTOINCREMENT,
     at      TEXT NOT NULL,
     kind    TEXT NOT NULL,
     label   TEXT NOT NULL,
     detail  TEXT NOT NULL DEFAULT '{}'
   );
   CREATE INDEX IF NOT EXISTS idx_history_at ON presentation_history(at);
   CREATE TABLE IF NOT EXISTS vset_profiles (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     name        TEXT NOT NULL UNIQUE,
     settings    TEXT NOT NULL,
     updated_at  TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS presentation_settings (
     key    TEXT PRIMARY KEY,
     value  TEXT
   );`,
];

function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get();
  let version = (row && row.v) || 0;
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(i + 1);
    })();
    version = i + 1;
  }
  return version;
}

function getDb() {
  if (!db) {
    db = sqlite.open(paths.PRESENTATION_DB);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate();
  }
  return db;
}

function schemaVersion() { return getDb().prepare('SELECT MAX(version) AS v FROM schema_version').get().v; }

function closeDb() { if (db) { db.close(); db = null; } }

const now = () => new Date().toISOString();

function getSetting(key, fallback = null) {
  const r = getDb().prepare('SELECT value FROM presentation_settings WHERE key = ?').get(key);
  return r ? r.value : fallback;
}
function setSetting(key, value) {
  getDb().prepare('INSERT INTO presentation_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value == null ? null : String(value));
}

// ── presentation history: what went on screen, newest first ──
const HISTORY_KEEP = 5000;
function recordHistory(kind, label, detail = {}) {
  if (!label) return;
  const d = getDb();
  d.prepare('INSERT INTO presentation_history (at, kind, label, detail) VALUES (?, ?, ?, ?)').run(now(), kind, String(label).slice(0, 300), JSON.stringify(detail));
  d.prepare('DELETE FROM presentation_history WHERE id <= (SELECT MAX(id) FROM presentation_history) - ?').run(HISTORY_KEEP);
}
function history(limit = 200) {
  return getDb().prepare('SELECT id, at, kind, label, detail FROM presentation_history ORDER BY id DESC LIMIT ?').all(Math.min(1000, limit))
    .map(r => ({ ...r, detail: safeJson(r.detail, {}) }));
}

function safeJson(s, fallback) { try { return JSON.parse(s); } catch (e) { return fallback; } }

module.exports = { getDb, closeDb, schemaVersion, getSetting, setSetting, recordHistory, history, safeJson, now };
