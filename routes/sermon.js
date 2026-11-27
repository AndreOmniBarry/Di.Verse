// Sermon notes: titles, points and highlights (services/sermonIntel.js).
// Reads are open like the rest of the API; every write is operator-only
// (server.js refuses non-GET /api requests from other devices).
//
// A note goes on screen as its own layer (SHOW_NOTE / HIDE_NOTE): it never
// replaces or clears the scripture or lyrics underneath.
const express = require('express');
const router = express.Router();
const sermon = require('../services/sermonIntel');

const TITLE_DEFAULT_MS = 10000;   // a title shows for 10 seconds by default
const MAX_MS = 10 * 60000;

const fail = (res, e, code = 400) => res.status(code).json({ error: e.message || String(e) });

router.get('/sermon', (req, res) => {
  const session = sermon.currentSession();
  res.json({ session, notes: sermon.notes(session.id), titleDurationMs: TITLE_DEFAULT_MS });
});

router.post('/sermon/session', (req, res) => {
  const session = sermon.newSession((req.body || {}).title);
  if ((req.body || {}).title) sermon.addNote({ kind: 'title', original: req.body.title, source: 'manual', sessionId: session.id });
  res.json({ session: sermon.currentSession(), notes: sermon.notes(session.id) });
});

// a finished sentence from listening: returns the new suggestions
router.post('/sermon/observe', (req, res) => {
  const { text, heardAt } = req.body || {};
  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'text is required' });
  const screen = req.app.locals.screen ? req.app.locals.screen() : null;
  const created = sermon.observe(text.slice(0, 2000), { screen, heardAt: heardAt ? new Date(Number(heardAt)).toISOString() : null });
  if (created.length && req.app.locals.alertOperator) req.app.locals.alertOperator({ action: 'SERMON_NOTES', notes: created });
  res.json({ notes: created });
});

router.post('/sermon/notes', (req, res) => {
  try {
    const b = req.body || {};
    const refs = typeof b.refText === 'string' && b.refText.trim() ? sermon.parseRefText(b.refText) : [];
    if (b.refText && !refs.length) throw new Error(`"${b.refText}" is not a reference that exists`);
    const note = sermon.addNote({ kind: b.kind, number: b.number, original: b.original, display: b.display, source: 'manual', refs });
    if (req.app.locals.alertOperator) req.app.locals.alertOperator({ action: 'SERMON_NOTES', notes: [note] });
    res.json(note);
  } catch (e) { fail(res, e); }
});

router.patch('/sermon/notes/:id', (req, res) => {
  try {
    const note = sermon.updateNote(Number(req.params.id), req.body || {});
    if (!note) return res.status(404).json({ error: 'No such note' });
    if (req.app.locals.alertOperator) req.app.locals.alertOperator({ action: 'SERMON_NOTES', notes: [note] });
    res.json(note);
  } catch (e) { fail(res, e); }
});

// attach a reference typed by the operator (it must exist; nothing is guessed)
router.post('/sermon/notes/:id/refs', (req, res) => {
  const note = sermon.getNote(Number(req.params.id));
  if (!note) return res.status(404).json({ error: 'No such note' });
  const refs = sermon.parseRefText(String((req.body || {}).reference || ''));
  if (!refs.length) return res.status(422).json({ error: 'Not a reference that exists. Type it like "John 3:16" or "Romans 8:28-30".' });
  res.json(sermon.updateNote(note.id, { refs: [...note.refs, ...refs] }));
});

router.delete('/sermon/notes/:id', (req, res) => {
  res.json({ removed: sermon.deleteNote(Number(req.params.id)) });
});

// show a note (replay any time); a title defaults to 10 seconds
router.post('/sermon/notes/:id/show', (req, res) => {
  const note = sermon.getNote(Number(req.params.id));
  if (!note) return res.status(404).json({ error: 'No such note' });
  const b = req.body || {};
  let duration = b.durationMs != null ? Number(b.durationMs) : (note.kind === 'title' ? TITLE_DEFAULT_MS : 0);
  if (!Number.isFinite(duration) || duration < 0) duration = 0;
  duration = Math.min(duration, MAX_MS);
  const shown = sermon.markShown(note.id);
  const payload = { action: 'SHOW_NOTE', note: { id: note.id, kind: note.kind, number: note.number, text: note.display || note.original, refs: note.refs.map(r => r.reference) }, durationMs: duration };
  req.app.locals.broadcast(payload);
  res.json({ ok: true, note: shown, durationMs: duration });
});

// remove the note layer only: scripture or lyrics underneath stay
router.post('/sermon/hide', (req, res) => {
  req.app.locals.broadcast({ action: 'HIDE_NOTE' });
  res.json({ ok: true });
});

module.exports = router;
