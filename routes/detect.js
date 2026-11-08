const express = require('express');
const router = express.Router();
const { parse } = require('../services/parser');
const { detectScripture } = require('../services/claude');
const { validateReference, normaliseBook } = require('../services/validation');
const { getPassage } = require('../services/bibleDb');
const quotes = require('../services/quoteMatch');
quotes.warmUp();

const SCRIPTURE_CUE = /\b(verses?|chapters?|book of|bible|scriptures?|it is written|the word says|says|saith|said|psalms?|gospel|epistle|prophet|apostle|amplified|translation|version)\b/i;
const AI_MIN_GAP_MS = 3000;
let lastAiCheck = 0;

router.post('/detect', async (req, res) => {
  // fast: parser + quote matching only (used on live words while the
  // preacher is still talking); the AI layer runs on finished sentences
  const { text, context = '', activeTranslation = 'KJV', fast = false } = req.body;
  if (!text || text.trim().length < 3) return res.json({ type: 'none' });

  try {
    // ── LAYER 1: Local parser — fast, offline, zero cost ──
    const parsed = parse(text, activeTranslation);

    // ── LAYER 1b: quoted KJV words — offline, a few milliseconds ──
    const quoted = quotes.match(text);
    const quoteTranslation = (parsed && parsed.translation) || activeTranslation;

    if (parsed) {
      // Translation-only change
      // The operator handles this from the response; a WebSocket copy as well alerted twice
      if (parsed.translationOnly) {
        return res.json({ type: 'translation_change', new_translation: parsed.translation, confidence: parsed.confidence });
      }

      // Full explicit reference — validate then fetch
      const { book, chapter, verse, verseEnd, translation, confidence } = parsed;

      // Hard gate: reject NaN or non-positive integers
      if (!Number.isInteger(chapter) || !Number.isInteger(verse) || chapter < 1 || verse < 1) {
        return res.json({ type: 'none' });
      }

      const validation = validateReference(book, chapter, verse);

      // The operator alerts from this response (a WebSocket copy as well showed it twice)
      if (!validation.valid) {
        return res.json({ type: 'validation_error', message: validation.message });
      }

      // The words quoted in the same breath point at a different verse
      const named = validation.normalised || book;
      const conflict = quoted.find(q => q.strong && !(q.book === named && q.chapter === chapter && q.verse >= verse && q.verse <= (verseEnd || verse)));

      // Same book name and verse but a different number in front ("1st John
      // 1:2" said while quoting 3 John 1:2): the number was misheard — the
      // quoted words are the stronger evidence
      const bare = name => name.replace(/^[1-3] /, '');
      if (conflict && bare(conflict.book) === bare(named) && conflict.chapter === chapter && conflict.verse === verse) {
        const fixed = await getPassage(conflict.book, chapter, verse, verseEnd, translation, { live: true });
        if (fixed) {
          console.log('[Parser] ' + named + ' corrected to ' + conflict.book + ' from the quoted words');
          return res.json({ type: 'explicit', reference: { book: conflict.book, chapter, verse, verseEnd, translation }, verseData: fixed, confidence: 0.95, source: 'quote' });
        }
      }

      const verseData = await getPassage(named, chapter, verse, verseEnd, translation, { live: true });
      if (!verseData) return res.json({ type: 'none' });

      // Otherwise offer the quoted verse alongside the named one
      const alsoQuoted = conflict ? [{ book: conflict.book, chapter: conflict.chapter, verse: conflict.verse, confidence: 0.9, snippet: 'quoted words match' }] : undefined;

      console.log('[Parser] ' + verseData.reference + ' (' + translation + ') conf:' + confidence + (conflict ? ' — quote matches ' + conflict.book + ' ' + conflict.chapter + ':' + conflict.verse : ''));
      return res.json({ type: 'explicit', reference: { book, chapter, verse, verseEnd, translation }, verseData, confidence, source: 'parser', candidates: alsoQuoted });
    }

    // A clearly quoted verse: show it like a named reference
    if (quoted.length && quoted[0].strong) {
      const q = quoted[0];
      const verseData = await getPassage(q.book, q.chapter, q.verse, undefined, quoteTranslation, { live: true });
      if (verseData) {
        console.log('[Quote] ' + verseData.reference + ' (' + q.hits + ' phrases)');
        return res.json({ type: 'explicit', reference: { book: q.book, chapter: q.chapter, verse: q.verse, translation: quoteTranslation }, verseData, confidence: 0.92, source: 'quote' });
      }
    }
    // Partly quoted: suggest, the operator decides
    if (quoted.length) {
      return res.json({ type: 'implicit', candidates: quoted.map(q => ({ book: q.book, chapter: q.chapter, verse: q.verse, confidence: 0.7 })), source: 'quote' });
    }

    if (fast) return res.json({ type: 'none' });

    // ── LAYER 2 budget: free AI tiers have daily limits, and a long service
    // has thousands of sentences. Only sentences that sound like they involve
    // scripture (or long ones that might paraphrase it) go to the AI, at most
    // one every few seconds; named references and quotes never need it.
    if (!SCRIPTURE_CUE.test(text) && text.trim().split(/\s+/).length < 14) return res.json({ type: 'none' });
    if (Date.now() - lastAiCheck < AI_MIN_GAP_MS) return res.json({ type: 'none' });
    lastAiCheck = Date.now();

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
        return res.json({ type: 'validation_error', message: validation.message });
      }

      const start = parseInt(verse);
      const end = parseInt(detection.reference.verse_end);
      const verseEnd = end > start ? Math.min(end, start + 9) : undefined;
      const verseData = await getPassage(validation.normalised || book, parseInt(chapter), start, verseEnd, usedTranslation, { live: true });
      if (verseData) detection.verseData = verseData;
    }

    return res.json(detection);

  } catch (err) {
    console.error('[Detect Error]', err.message);
    return res.json({ type: 'none' });
  }
});

module.exports = router;
