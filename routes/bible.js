const express = require('express');
const router = express.Router();
const { getPassage, listTranslations } = require('../services/bibleDb');
const { validateReference, normaliseBook } = require('../services/validation');
const { step } = require('../services/navigation');

router.get('/verse', async (req, res) => {
  // manual=1: the operator searched by hand and reads the result before
  // pushing, so AI wording that couldn't be cross-checked is still shown, flagged
  const { book, chapter, verse, verseEnd, translation = 'KJV', manual } = req.query;

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
  const result = await getPassage(normalisedBook, parseInt(chapter), parseInt(verse), verseEnd ? Math.min(parseInt(verseEnd), parseInt(verse) + 9) : undefined, translation, { live: true, allowUnverified: manual === '1' });

  if (!result) {
    return res.status(404).json({
      error: `Could not retrieve ${normalisedBook} ${chapter}:${verse} in ${translation}`
    });
  }

  res.json(result);
});

// Next / previous verse or chapter from a reference (operator buttons and
// keys, presentation clickers)
router.get('/verse/step', async (req, res) => {
  const { book, chapter, verse, verseEnd, dir = 'next', unit = 'verse', translation = 'KJV', manual } = req.query;
  const name = normaliseBook(book);
  if (!name || !/^\d+$/.test(chapter || '') || !/^\d+$/.test(verse || '')) return res.status(400).json({ error: 'book, chapter and verse are required' });
  const target = step({ book: name, chapter: parseInt(chapter), verse: parseInt(verse), verseEnd: verseEnd ? parseInt(verseEnd) : undefined },
    dir === 'prev' ? 'prev' : 'next', unit === 'chapter' ? 'chapter' : 'verse');
  if (!target) return res.status(404).json({ error: dir === 'prev' ? 'This is the first verse of the Bible.' : 'This is the last verse of the Bible.' });
  const result = await getPassage(target.book, target.chapter, target.verse, undefined, translation, { live: true, allowUnverified: manual === '1' });
  if (!result) return res.status(404).json({ error: `Could not retrieve ${target.book} ${target.chapter}:${target.verse} in ${translation}` });
  res.json(result);
});

router.get('/translations', async (req, res) => {
  res.json(await listTranslations());
});

module.exports = router;