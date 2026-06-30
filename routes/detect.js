const express = require('express');
const router = express.Router();
const { detectScripture } = require('../services/claude');
const { validateReference, normaliseBook } = require('../services/validation');
const { getVerse } = require('../services/bibleDb');

router.post('/detect', async (req, res) => {
  const { text, context = '', activeTranslation = 'KJV' } = req.body;
  if (!text || text.trim().length < 3) return res.json({ type: 'none' });

  try {
    const detection = await detectScripture(text, context, activeTranslation);

    if (detection.type === 'explicit' && detection.reference) {
      const { book: rawBook, chapter, verse, translation } = detection.reference;
      const book = normaliseBook(rawBook) || rawBook;
      const usedTranslation = translation || activeTranslation;

      const validation = validateReference(book, parseInt(chapter), parseInt(verse));

      if (!validation.valid) {
        const { alertOperator } = req.app.locals;
        alertOperator({
          action: 'VALIDATION_ALERT',
          message: validation.message,
          code: validation.code,
          reference: book + ' ' + chapter + ':' + verse
        });
        return res.json({ type: 'validation_error', message: validation.message });
      }

      const verseData = await getVerse(
        validation.normalised || book,
        parseInt(chapter),
        parseInt(verse),
        usedTranslation
      );

      if (verseData) detection.verseData = verseData;
    }

    if (detection.type === 'translation_change' && detection.new_translation) {
      const { alertOperator } = req.app.locals;
      alertOperator({ action: 'TRANSLATION_CHANGE', translation: detection.new_translation });
    }

    res.json(detection);

  } catch (err) {
    console.error('[Detect Error]', err.message);
    res.json({ type: 'none' });
  }
});

module.exports = router;