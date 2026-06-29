const express = require('express');
const router = express.Router();

router.post('/push', (req, res) => {
  const { action, verse, lyrics } = req.body;
  const { broadcast } = req.app.locals;
  if (!action) return res.status(400).json({ error: 'action is required' });
  broadcast({ action, verse, lyrics });
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