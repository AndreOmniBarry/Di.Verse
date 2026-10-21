const express = require('express');
const router = express.Router();
const { parse } = require('../services/parser');
const { detectScripture } = require('../services/claude');
const { validateReference, normaliseBook } = require('../services/validation');
const { getVerse } = require('../services/bibleDb');

router.post('/detect', async (req, res) => {
  const { text, context = '', activeTranslation = 'KJV' } = req.body;
  if (!text || text.trim().length < 3) return res.json({ type: 'none' });

  try {
    // ── LAYER 1: Local parser — fast, offline, zero cost ──
    const parsed = parse(text, activeTranslation);

    if (parsed) {
      // Translation-only change
      // The operator handles this from the response; a WebSocket copy as well alerted twice
      if (parsed.translationOnly) {
        return res.json({ type: 'translation_change', new_translation: parsed.translation, confidence: parsed.confidence });
      }

      // Full explicit reference — validate then fetch
      const { book, chapter, verse, translation, confidence } = parsed;

      // Hard gate: reject NaN or non-positive integers
      if (!Number.isInteger(chapter) || !Number.isInteger(verse) || chapter < 1 || verse < 1) {
        return res.json({ type: 'none' });
      }

      const validation = validateReference(book, chapter, verse);

      if (!validation.valid) {
        const { alertOperator } = req.app.locals;
        alertOperator({ action: 'VALIDATION_ALERT', message: validation.message, code: validation.code, reference: book + ' ' + chapter + ':' + verse });
        return res.json({ type: 'validation_error', message: validation.message });
      }

      const verseData = await getVerse(validation.normalised || book, chapter, verse, translation);
      if (!verseData) return res.json({ type: 'none' });

      console.log('[Parser] ' + verseData.reference + ' (' + translation + ') conf:' + confidence);
      return res.json({ type: 'explicit', reference: { book, chapter, verse, translation }, verseData, confidence, source: 'parser' });
    }

    // ── LAYER 2: Claude — implicit quotes, ambiguous speech, hard cases ──
    const detection = await detectScripture(text, context, activeTranslation);

    if (detection.type === 'explicit' && detection.reference) {
      const { book: rawBook, chapter, verse, translation } = detection.reference;
      const book = normaliseBook(rawBook) || rawBook;
      const usedTranslation = translation || activeTranslation;

      if (!Number.isInteger(parseInt(chapter)) || !Number.isInteger(parseInt(verse)) ||
          isNaN(parseInt(chapter)) || isNaN(parseInt(verse)) ||
          parseInt(chapter) < 1 || parseInt(verse) < 1) {
        return res.json({ type: 'none' });
      }

      const validation = validateReference(book, parseInt(chapter), parseInt(verse));
      if (!validation.valid) {
        const { alertOperator } = req.app.locals;
        alertOperator({ action: 'VALIDATION_ALERT', message: validation.message });
        return res.json({ type: 'validation_error', message: validation.message });
      }

      const verseData = await getVerse(validation.normalised || book, parseInt(chapter), parseInt(verse), usedTranslation);
      if (verseData) detection.verseData = verseData;
    }

    return res.json(detection);

  } catch (err) {
    console.error('[Detect Error]', err.message);
    return res.json({ type: 'none' });
  }
});

module.exports = router;
