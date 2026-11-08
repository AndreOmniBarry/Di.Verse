const sqlite = require('./sqlite');
const path = require('path');

const DB_PATH = require('./paths').SONGS_DB;
let db;

function getDb() {
  if (!db) {
    db = sqlite.open(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON'); // without this ON DELETE CASCADE never fires
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS songs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL,
      artist     TEXT,
      language   TEXT DEFAULT 'English',
      tags       TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS slides (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      song_id   INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      slide_num INTEGER NOT NULL,
      section   TEXT,
      content   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_slides ON slides(song_id, slide_num);
  `);
}

function searchSongs(query) {
  const db = getDb();
  if (!query || query.trim() === '') {
    return db.prepare(
      `SELECT id, title, artist, language, tags FROM songs ORDER BY title LIMIT 50`
    ).all();
  }
  return db.prepare(`
    SELECT id, title, artist, language, tags FROM songs
    WHERE title LIKE ? OR tags LIKE ? OR artist LIKE ?
    ORDER BY title LIMIT 20
  `).all(`%${query}%`, `%${query}%`, `%${query}%`);
}

function getSongSlides(songId) {
  const db = getDb();
  return db.prepare(`
    SELECT id, slide_num, section, content
    FROM slides WHERE song_id = ?
    ORDER BY slide_num
  `).all(songId);
}

function addSong(title, artist, language = 'English', tags = '') {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO songs (title, artist, language, tags) VALUES (?, ?, ?, ?)
  `).run(title, artist || null, language, tags);
  return result.lastInsertRowid;
}

function addSlide(songId, slideNum, section, content) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO slides (song_id, slide_num, section, content) VALUES (?, ?, ?, ?)
  `).run(songId, slideNum, section || null, content);
  return result.lastInsertRowid;
}

function deleteSong(songId) {
  const db = getDb();
  db.prepare(`DELETE FROM songs WHERE id = ?`).run(songId);
}

// Replace a song's details and all its slides in one transaction, so editing
// a song doesn't append a second copy of every slide
function updateSong(songId, { title, artist, language = 'English', tags = '', slides = [] }) {
  const db = getDb();
  if (!db.prepare(`SELECT 1 FROM songs WHERE id = ?`).get(songId)) return false;
  db.transaction(() => {
    db.prepare(`UPDATE songs SET title = ?, artist = ?, language = ?, tags = ? WHERE id = ?`)
      .run(title, artist || null, language, tags, songId);
    db.prepare(`DELETE FROM slides WHERE song_id = ?`).run(songId);
    const insert = db.prepare(`INSERT INTO slides (song_id, slide_num, section, content) VALUES (?, ?, ?, ?)`);
    slides.forEach((sl, i) => insert.run(songId, i + 1, sl.section || null, sl.content));
  })();
  return true;
}

module.exports = { getDb, searchSongs, getSongSlides, addSong, addSlide, deleteSong, updateSong };