// The local Bible library (Admin → Bibles): list, add free translations,
// import licensed files, remove. Changes are operator-only (server.js guard).
const express = require('express');
const router = express.Router();
const library = require('../services/library');
const { importFile } = require('../services/importer');

router.get('/library', (req, res) => res.json(library.list()));

let busy = null; // one download at a time
router.post('/library/install', async (req, res) => {
  const code = String((req.body && req.body.code) || '').toUpperCase();
  if (busy) return res.status(409).json({ error: `Already installing ${busy} — one at a time` });
  busy = code;
  try { res.json(await library.install(code)); }
  catch (err) {
    console.error('[Library]', code, err.message);
    res.status(/free list|licence|catalogue/.test(err.message) ? 400 : 502).json({ error: /fetch failed|ENOTFOUND|ECONN|abort/i.test(err.message) ? 'Couldn\'t reach bible.helloao.org — check the internet connection' : err.message });
  } finally { busy = null; }
});

// File import: the file is the request body; code, name and where it came from in the query
router.post('/library/import', express.raw({ type: '*/*', limit: '60mb' }), (req, res) => {
  try {
    const { code, name, obtained, filename } = req.query;
    res.json(importFile({ content: req.body, filename, code, name, obtained }));
  } catch (err) {
    console.error('[Library] import failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.delete('/library/:code', (req, res) => {
  try { res.json({ removed: library.remove(req.params.code) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
