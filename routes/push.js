const express = require('express');
const router = express.Router();
const diag = require('../services/diagnostics');

router.post('/push', (req, res) => {
  const { action, verse, lyrics } = req.body;
  const { broadcast } = req.app.locals;
  if (!action) return res.status(400).json({ error: 'action is required' });
  // Forward the whole payload — theme, fontSize and delta ride alongside verse/lyrics
  // why it went up, for the session report — not sent to the screens
  const { why, listening, detected, ...payload } = req.body;
  broadcast(payload);
  if (action === 'SHOW_VERSE' && verse && why && !['mode', 'upgrade'].includes(why)) diag.record('pushed', { ref: verse.reference, why, listening: Boolean(listening), detected: Boolean(detected) });
  if (action === 'CLEAR') diag.record('cleared');
  console.log(`[PUSH] ${action}`, verse?.reference || lyrics?.songTitle || '');
  res.json({ ok: true });
});

router.post('/clear', (req, res) => {
  const { broadcast } = req.app.locals;
  broadcast({ action: 'CLEAR' });
  console.log('[PUSH] CLEAR');
  res.json({ ok: true });
});

module.exports = router;