const express = require('express');
const router = express.Router();
const { getPassage, listTranslations } = require('../services/bibleDb');
const { validateReference, normaliseBook } = require('../services/validation');

router.get('/verse', async (req, res) => {
  const { book, chapter, verse, verseEnd, translation = 'KJV' } = req.query;

  if (!book || !chapter || !verse) {
    return res.status(400).json({ error: 'book, chapter, and verse are required' });
  }

  if (!/^\d+$/.test(chapter) || !/^\d+$/.test(verse) || (verseEnd && !/^\d+$/.test(verseEnd))) {
    return res.status(400).json({ error: 'chapter and verse must be whole numbers' });
  }

  const validation = validateReference(book, parseInt(chapter), parseInt(verse));
  if (!validation.valid) {
    return res.status(422).json({ error: validation.message, code: validation.code });
  }

  // Use normalised book name for DB lookup
  const normalisedBook = validation.normalised || book;
  const result = await getPassage(normalisedBook, parseInt(chapter), parseInt(verse), verseEnd ? Math.min(parseInt(verseEnd), parseInt(verse) + 9) : undefined, translation);

  if (!result) {
    return res.status(404).json({
      error: `Could not retrieve ${normalisedBook} ${chapter}:${verse} in ${translation}`
    });
  }

  res.json(result);
});

router.get('/translations', async (req, res) => {
  res.json(await listTranslations());
});

module.exports = router;