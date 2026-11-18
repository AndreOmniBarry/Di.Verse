// Session report (Settings → Session report). Operator laptop only.
const express = require('express');
const router = express.Router();
const diag = require('../services/diagnostics');

const day = q => /^\d{4}-\d{2}-\d{2}$/.test(q || '') ? q : undefined;

// the listening page reports sound health once a minute
router.post('/diag', (req, res) => {
  const b = req.body || {};
  if (b.kind !== 'audio') return res.status(400).json({ error: 'unknown kind' });
  const n = v => Math.max(0, Math.min(3600, Number(v) || 0));
  diag.record('audio', { okSec: n(b.okSec), whisperSec: n(b.whisperSec), speechSec: n(b.speechSec), rebuilds: Math.min(100, Number(b.rebuilds) || 0),
    level: b.level == null ? null : Math.max(0, Math.min(1, Number(b.level) || 0)) });
  res.json({ ok: true });
});

router.get('/diag/report', (req, res) => {
  if (!req.app.locals.isOperator(req)) return res.status(403).json({ error: 'Operator laptop only' });
  res.json(diag.report(day(req.query.day)));
});

router.get('/diag/export', (req, res) => {
  if (!req.app.locals.isOperator(req)) return res.status(403).send('Operator laptop only');
  const d = day(req.query.day) || new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="diverse-session-${d}.txt"`);
  res.send(diag.exportText(day(req.query.day)));
});

module.exports = router;
