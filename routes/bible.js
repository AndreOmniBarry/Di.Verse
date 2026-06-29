const express = require('express');
const router = express.Router();
const { getVerse } = require('../services/bibleDb');
const { validateReference, normaliseBook } = require('../services/validation');

router.get('/verse', async (req, res) => {
  const { book, chapter, verse, translation = 'KJV' } = req.query;

  if (!book || !chapter || !verse) {
    return res.status(400).json({ error: 'book, chapter, and verse are required' });
  }

  const validation = validateReference(book, parseInt(chapter), parseInt(verse));
  if (!validation.valid) {
    return res.status(422).json({ error: validation.message, code: validation.code });
  }

  // Use normalised book name for DB lookup
  const normalisedBook = validation.normalised || book;
  const result = await getVerse(normalisedBook, parseInt(chapter), parseInt(verse), translation);

  if (!result) {
    return res.status(404).json({
      error: `Could not retrieve ${normalisedBook} ${chapter}:${verse} in ${translation}`
    });
  }

  res.json(result);
});

module.exports = router;