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
    // the closest real verses, so the operator can pick one instead of retyping
    const suggestions = validation.normalised ? require('../services/navigation').nearest(validation.normalised, parseInt(chapter), parseInt(verse))
      .map(n => ({ reference: `${n.book} ${n.chapter}:${n.verse}`, book: n.book, chapter: n.chapter, verse: n.verse, why: n.why })) : [];
    return res.status(422).json({ error: validation.message, code: validation.code, suggestions });
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
    dir === 'prev' ? 'prev' : 'next', unit === 'chapter' ? 'chapter' : 'verse', translation);
  if (!target) return res.status(404).json({ error: dir === 'prev' ? 'This is the first verse of the Bible.' : 'This is the last verse of the Bible.' });
  const result = await getPassage(target.book, target.chapter, target.verse, undefined, translation, { live: true, allowUnverified: manual === '1' });
  if (!result) return res.status(404).json({ error: `Could not retrieve ${target.book} ${target.chapter}:${target.verse} in ${translation}` });
  res.json(result);
});

// Find a verse from words: "i wish above all things that thou mayest
// prosper", "the man Isaac sowed in the land". Exact quotes first, then the
// verses sharing the most telling words. KJV text, with how sure it is.
router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 400);
  if (q.split(/\s+/).length < 2) return res.status(400).json({ error: 'Type a few words of the verse.' });
  const quotes = require('../services/quoteMatch');
  const finder = require('../services/verseFinder');
  const out = [], seen = new Set();
  const add = (r, how, sure) => {
    const key = r.book + ' ' + r.chapter + ':' + r.verse;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ reference: key, book: r.book, chapter: r.chapter, verse: r.verse, text: finder.verseText(r.book, r.chapter, r.verse), how, sure });
  };
  for (const r of quotes.match(q)) add(r, 'quote', r.strong);
  const found = finder.find(q, 5);
  const verdict = finder.judge(found);
  // a clear winner goes straight up; several close ones are offered to choose from
  const clear = verdict === 'strong' || (verdict === 'suggest' && found[1] && found[0].score / found[1].score >= 1.35);
  found.forEach((r, i) => add(r, 'words', i === 0 && clear));
  res.json({ results: out.slice(0, 5), best: out[0] && out[0].sure ? out[0].reference : null });
});

router.get('/translations', async (req, res) => {
  res.json(await listTranslations());
});

module.exports = router;