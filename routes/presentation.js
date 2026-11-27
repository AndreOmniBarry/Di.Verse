// Presentation history and virtual-set profiles. Writes are operator-only
// (server.js refuses non-GET /api requests from other devices).
const express = require('express');
const router = express.Router();
const store = require('../services/presentationDb');
const vset = require('../services/virtualSet');

router.get('/history', (req, res) => res.json({ items: store.history(Number(req.query.limit) || 200) }));

router.get('/vset', (req, res) => res.json({ profiles: vset.list(), liveId: vset.liveId(), layouts: vset.LAYOUTS, backgrounds: vset.BACKGROUNDS, transitions: vset.TRANSITIONS }));

router.post('/vset/profiles', (req, res) => {
  try { res.json(vset.create((req.body || {}).name, (req.body || {}).settings)); }
  catch (e) { res.status(/UNIQUE/.test(e.message) ? 409 : 400).json({ error: /UNIQUE/.test(e.message) ? 'A profile with that name already exists' : e.message }); }
});

router.put('/vset/profiles/:id', (req, res) => {
  try {
    const p = vset.update(Number(req.params.id), req.body || {});
    if (!p) return res.status(404).json({ error: 'No such profile' });
    // editing the live profile re-applies it, so the screens match what is saved
    if (vset.liveId() === p.id) req.app.locals.broadcast({ action: 'APPLY_PROFILE', profile: p });
    res.json(p);
  } catch (e) { res.status(/UNIQUE/.test(e.message) ? 409 : 400).json({ error: /UNIQUE/.test(e.message) ? 'A profile with that name already exists' : e.message }); }
});

router.delete('/vset/profiles/:id', (req, res) => {
  try { res.json({ removed: vset.remove(Number(req.params.id)) }); }
  catch (e) { res.status(409).json({ error: e.message }); }
});

// operator approval: the previewed profile goes to every screen
router.post('/vset/live', (req, res) => {
  const p = vset.setLive(Number((req.body || {}).id));
  if (!p) return res.status(404).json({ error: 'No such profile' });
  req.app.locals.broadcast({ action: 'APPLY_PROFILE', profile: p });
  res.json({ ok: true, profile: p });
});

module.exports = router;
