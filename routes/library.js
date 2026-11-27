// The local Bible library (Admin → Bibles): list, add free translations,
// import files and ZIP archives, remove. Changes are operator-only (server.js guard).
const express = require('express');
const router = express.Router();
const library = require('../services/library');
const { importFile } = require('../services/importer');
const { inspectArchive, importArchive } = require('../services/archiveImporter');

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
  if (busy) return res.status(409).json({ error: `Already processing ${busy}` });
  busy = 'single-file import';
  try {
    const { code, name, obtained, filename } = req.query;
    const normalisedCode = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const exists = library.list().installed.some(item => item.code === normalisedCode);
    const replace = String(req.query.replace || '').toUpperCase() === normalisedCode;
    if (exists && !replace) {
      return res.status(409).json({ error: `${normalisedCode} is already installed. Confirm replacement to continue.`, replaceRequired: [normalisedCode] });
    }
    res.json(importFile({ content: req.body, filename, code, name, obtained, authorized: String(req.query.authorized || '') === 'true' }));
  } catch (err) {
    console.error('[Library] import failed:', err.message);
    res.status(err.status || 400).json({ error: err.message });
  } finally { busy = null; }
});

// ZIP archive preview is read-only. ZIP imports are committed one translation at a time.
router.post('/library/archive/preview', express.raw({ type: '*/*', limit: '250mb' }), async (req, res) => {
  if (busy) return res.status(409).json({ error: `Already processing ${busy}` });
  busy = 'ZIP archive preview';
  try {
    res.json(await inspectArchive(req.body));
  } catch (err) {
    console.error('[Library] ZIP preview failed:', err.message);
    res.status(400).json({ error: err.message });
  } finally { busy = null; }
});

router.post('/library/archive/import', express.raw({ type: '*/*', limit: '250mb' }), async (req, res) => {
  if (busy) return res.status(409).json({ error: `Already processing ${busy}` });
  busy = 'ZIP archive import';
  try {
    const includeCodes = String(req.query.codes || '').split(',').map(code => code.trim()).filter(Boolean);
    const replaceCodes = String(req.query.replace || '').split(',').map(code => code.trim()).filter(Boolean);
    const report = await importArchive(req.body, {
      includeCodes,
      replaceCodes,
      expectedHash: String(req.query.hash || ''),
      authorized: String(req.query.authorized || '') === 'true',
      sourceNote: String(req.query.sourceNote || ''),
    });
    res.json(report);
  } catch (err) {
    console.error('[Library] ZIP import failed:', err.message);
    res.status(err.status || 400).json({ error: err.message, replaceRequired: err.replaceRequired || [] });
  } finally { busy = null; }
});

router.delete('/library/:code', (req, res) => {
  try { res.json({ removed: library.remove(req.params.code) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
