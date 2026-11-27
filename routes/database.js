// The Bible database: its health, backups and restoring one (Setup →
// Bible database). Every route is operator-laptop only, reads included,
// because the answers name folders on this computer.
const express = require('express');
const router = express.Router();
const backup = require('../services/dbBackup');

router.use('/db', (req, res, next) => req.app.locals.isOperator(req) ? next()
  : res.status(403).json({ error: 'Operator laptop only' }));

// ?integrity=1 runs a full integrity check now (Setup -> Check again)
router.get('/db/health', (req, res) => res.json(backup.health({ integrity: req.query.integrity === '1' })));

router.get('/db/backups', (req, res) => res.json({ backups: backup.list() }));

router.post('/db/backups', (req, res) => {
  try { res.json(backup.create('manual')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// body: { name, confirm } where confirm must equal name
router.post('/db/restore', (req, res) => {
  const { name, confirm } = req.body || {};
  try {
    const r = backup.restore(name, confirm);
    console.log(`[Database] Restored ${r.restored} (previous database saved as ${r.safetyBackup})`);
    res.json(r);
  } catch (e) {
    res.status(/not confirmed|Unknown backup|not in the backups|can't be used/.test(e.message) ? 400 : 500).json({ error: e.message });
  }
});

module.exports = router;
