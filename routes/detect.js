const express = require('express');
const router = express.Router();
const { parse, looksLikeReference: parserLooks } = require('../services/parser');
const diag = require('../services/diagnostics');
const { detectScripture } = require('../services/claude');
const { validateReference, normaliseBook } = require('../services/validation');
const { getPassage } = require('../services/bibleDb');
const quotes = require('../services/quoteMatch');
const navigation = require('../services/navigation');
const finder = require('../services/verseFinder');
finder.warmUp();
quotes.warmUp();

const SCRIPTURE_CUE = /\b(verses?|chapters?|book of|bible|scriptures?|it is written|the word says|says|saith|said|psalms?|gospel|epistle|prophet|apostle|amplified|translation|version)\b/i;
const AI_MIN_GAP_MS = 3000;
let lastAiCheck = 0;

router.post('/detect', async (req, res) => {
  // fast: parser + quote matching only (used on live words while the
  // preacher is still talking); the AI layer runs on finished sentences
  // current: the verse on screen, for the preacher's cues ("next verse",
  // "take it back", "verse 17"); interim: words still being spoken
  const { text, context = '', activeTranslation = 'KJV', fast = false, interim = false } = req.body;
  if (!text || text.trim().length < 3) return res.json({ type: 'none' });

  // Every answer also goes to the session report (services/diagnostics.js):
  // what was heard, and what came of it
  const answer = result => {
    try {
      const finished = !interim && !req.body.ai && req.body.via;
      if (finished) diag.record('heard', { text: String(text).slice(0, 300), via: req.body.via, words: String(text).trim().split(/\s+/).length });
      if (result.type === 'explicit' && result.verseData) diag.record('found', { ref: result.verseData.reference, source: result.source || 'ai' });
      else if (result.type === 'navigate' && result.verseData) diag.record('cue', { cue: String(text).slice(-60), ref: result.verseData.reference });
      else if (result.type === 'implicit' && result.source === 'nearest' && !req.body.ai) diag.record('nearest', { said: String(text).slice(0, 120) });
      else if (finished && (result.type === 'none' || result.type === 'implicit') && parserLooks(text)) diag.record('missed', { text: String(text).slice(0, 300) });
    } catch (e) {}
    return res.json(result);
  };
  // The verse on screen: from the page that's listening, or else whatever is
  // really on screen (another operator page may have put it there)
  let current = req.body.current || null;
  if (!current && req.body.cues !== false && req.app.locals.screen) {
    const on = req.app.locals.screen();
    const v = on && on.action === 'SHOW_VERSE' && on.verse;
    if (v && v.book && v.chapter && v.verse) current = { book: v.book, chapter: v.chapter, verse: v.verse, verseEnd: v.verseEnd, translation: String(v.translation || activeTranslation).split('/')[0] };
  }

  try {
    // ── LAYER 1: Local parser — fast, offline, zero cost ──
    const parsed = parse(text, activeTranslation);

    // ── LAYER 1a: the preacher moving through the passage on screen ──
    if (!parsed && current && current.book) {
      const command = navigation.cue(text);
      // "verse 1…" while still speaking may become "verse 16": wait for the
      // next word or the end of the sentence before jumping to a number
      if (command && !(interim && command.kind === 'goto' && command.atEnd)) {
        const target = navigation.resolve(command, { ...current, book: normaliseBook(current.book) || current.book });
        if (target) {
          const verseData = await getPassage(target.book, target.chapter, target.verse, target.verseEnd, current.translation || activeTranslation, { live: true });
          if (verseData) {
            console.log(`[Cue] ${command.kind === 'step' ? command.dir + ' ' + command.unit : 'verse ' + command.verse} → ${verseData.reference}`);
            return answer({ type: 'navigate', command: { kind: command.kind, dir: command.dir, unit: command.unit, verse: command.verse, chapter: command.chapter }, verseData, confidence: 0.95, source: 'cue' });
          }
        }
      }
    }

    // ── LAYER 1b: quoted KJV words — offline, a few milliseconds ──
    let quoted = quotes.match(text);
    // A quote that runs across the end of the last sentence into this one:
    // match the two together, ignoring anything the last sentence matched
    // alone. Helped by earlier words, it's only ever a suggestion (never
    // strong): old words must not put a verse on screen.
    if (!quoted.length && context) {
      const tail = String(context).split(/\s+/).slice(-25).join(' ');
      const before = quotes.match(tail).map(q => q.book + q.chapter + ':' + q.verse);
      quoted = quotes.match(tail + ' ' + text).filter(q => !before.includes(q.book + q.chapter + ':' + q.verse)).map(q => ({ ...q, strong: false }));
    }
    const quoteTranslation = (parsed && parsed.translation) || activeTranslation;

    if (parsed) {
      // Translation-only change
      // The operator handles this from the response; a WebSocket copy as well alerted twice
      if (parsed.translationOnly) {
        return answer({ type: 'translation_change', new_translation: parsed.translation, confidence: parsed.confidence });
      }

      // Full explicit reference — validate then fetch
      const { book, chapter, verse, verseEnd, translation, confidence } = parsed;

      // Hard gate: reject NaN or non-positive integers
      if (!Number.isInteger(chapter) || !Number.isInteger(verse) || chapter < 1 || verse < 1) {
        return answer({ type: 'none' });
      }

      const validation = validateReference(book, chapter, verse);

      // A reference that doesn't exist ("Matthew 11:35" — chapter 11 ends at 30)
      // is nearly always a misheard number. No red error mid-sermon: the
      // verse the quoted words point to if there is one, otherwise the closest
      // real verses go to the queue for the operator.
      if (!validation.valid) {
        if (validation.code === 'BOOK_NOT_FOUND') return answer({ type: 'none' });
        // only words said right around the reference count (the start of a
        // long caption sentence may hold an earlier quote)
        const around = String(text).split(/\s+/).slice(-20).join(' ');
        const strongQuote = quotes.match(around).find(q => q.strong);
        if (strongQuote) {
          const verseData = await getPassage(strongQuote.book, strongQuote.chapter, strongQuote.verse, undefined, translation, { live: true });
          if (verseData) {
            console.log(`[Parser] ${book} ${chapter}:${verse} doesn't exist — the quoted words are ${verseData.reference}`);
            return answer({ type: 'explicit', verseData, confidence: 0.93, source: 'quote', notice: `${book} ${chapter}:${verse} doesn't exist — showing ${verseData.reference}, which matches the words quoted` });
          }
        }
        const near = navigation.nearest(validation.normalised || book, chapter, verse);
        console.log(`[Parser] ${book} ${chapter}:${verse} doesn't exist — suggesting ${near.map(n => n.chapter + ':' + n.verse).join(', ')}`);
        return answer({ type: 'implicit', source: 'nearest', notice: `${validation.message.replace(/ Verse \d+ does not exist\.| Chapter \d+ does not exist\./, '')} — the closest verses are in the queue`,
          candidates: near.map(n => ({ book: n.book, chapter: n.chapter, verse: n.verse, confidence: 0.6, snippet: n.why })) });
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
          return answer({ type: 'explicit', reference: { book: conflict.book, chapter, verse, verseEnd, translation }, verseData: fixed, confidence: 0.95, source: 'quote' });
        }
      }

      const verseData = await getPassage(named, chapter, verse, verseEnd, translation, { live: true });
      if (!verseData) return answer({ type: 'none' });

      // Also offered: the quoted verse if it differs, and for "Psalm 11" the
      // run-together reading "Psalm 1:1"
      const offers = [];
      if (conflict) offers.push({ book: conflict.book, chapter: conflict.chapter, verse: conflict.verse, confidence: 0.9, snippet: 'quoted words match' });
      for (const alt of parsed.alternatives || []) offers.push({ book: named, chapter: alt.chapter, verse: alt.verse, confidence: 0.7, snippet: `or ${named} ${alt.chapter}:${alt.verse}` });

      // More references in the same breath ("Romans 8:28 and Philippians 4:13"):
      // the first goes up, the others wait in the queue, ready to push
      const also = [];
      for (const more of (parsed.more || []).slice(0, 4)) {
        const v = validateReference(more.book, more.chapter, more.verse);
        if (!v.valid) continue;
        const d = await getPassage(v.normalised || more.book, more.chapter, more.verse, more.verseEnd, more.translation || translation, { live: true });
        if (d) also.push(d);
      }

      console.log('[Parser] ' + verseData.reference + ' (' + translation + ') conf:' + confidence + (conflict ? ' — quote matches ' + conflict.book + ' ' + conflict.chapter + ':' + conflict.verse : '') + (also.length ? ' + ' + also.map(d => d.reference).join(', ') : ''));
      return answer({ type: 'explicit', reference: { book, chapter, verse, verseEnd, translation }, verseData, confidence, source: 'parser',
        candidates: offers.length ? offers : undefined, also: also.length ? also : undefined });
    }

    // A clearly quoted verse: show it like a named reference
    if (quoted.length && quoted[0].strong) {
      const q = quoted[0];
      const verseData = await getPassage(q.book, q.chapter, q.verse, undefined, quoteTranslation, { live: true });
      if (verseData) {
        console.log('[Quote] ' + verseData.reference + ' (' + q.hits + ' phrases)');
        return answer({ type: 'explicit', reference: { book: q.book, chapter: q.chapter, verse: q.verse, translation: quoteTranslation }, verseData, confidence: 0.92, source: 'quote' });
      }
    }
    // Partly quoted: suggest, the operator decides
    if (quoted.length) {
      return answer({ type: 'implicit', candidates: quoted.map(q => ({ book: q.book, chapter: q.chapter, verse: q.verse, confidence: 0.7 })), source: 'quote' });
    }

    // ── LAYER 1c: the verse being talked about, from its telling words —
    // paraphrased, or misheard by speech-to-text ("Isaac sold in that land")
    // — offline. Not on words still being spoken (they change).
    let found = [];
    if (!interim) {
      const tail = String(context || '').split(/\s+/).slice(-15).join(' ');
      found = finder.find((tail + ' ' + text).trim(), 5);
      let verdict = finder.judge(found);
      // strong (shown on its own) only when the current words alone say so —
      // the earlier sentence may be about a verse that's already been shown
      if (verdict === 'strong' && finder.judge(finder.find(text, 5)) !== 'strong') verdict = 'suggest';
      if (verdict === 'strong') {
        const f = found[0];
        const verseData = await getPassage(f.book, f.chapter, f.verse, undefined, quoteTranslation, { live: true });
        if (verseData) {
          console.log(`[Finder] ${verseData.reference} (${f.words} words, score ${f.score})`);
          return answer({ type: 'explicit', reference: { book: f.book, chapter: f.chapter, verse: f.verse, translation: quoteTranslation }, verseData, confidence: 0.9, source: 'finder' });
        }
      }
      if (verdict === 'suggest' && !req.body.ai) {
        const close = found.filter(f => f.score >= found[0].score * 0.85).slice(0, 2);
        return answer({ type: 'implicit', candidates: close.map(f => ({ book: f.book, chapter: f.chapter, verse: f.verse, confidence: Math.min(0.8, f.confidence) })), source: 'finder' });
      }
    }

    if (fast) return answer({ type: 'none' });

    // ── LAYER 2 budget: free AI tiers have daily limits, and a long service
    // has thousands of sentences. Only sentences that sound like they involve
    // scripture (or long ones that might paraphrase it) go to the AI, at most
    // one every few seconds; named references and quotes never need it.
    // ai: the operator page's rolling window, already paced to the free
    // limits; anything else only when it sounds like scripture
    if (!req.body.ai && !SCRIPTURE_CUE.test(text) && text.trim().split(/\s+/).length < 14) return answer({ type: 'none' });
    if (Date.now() - lastAiCheck < (req.body.ai ? 2000 : AI_MIN_GAP_MS)) return answer({ type: 'none' });
    lastAiCheck = Date.now();

    // ── LAYER 2: Claude — implicit quotes, ambiguous speech, hard cases ──
    // The local word search's best guesses go along as hints: the AI then
    // confirms a real verse instead of recalling one from memory
    const hints = found.slice(0, 5).map(f => {
      const row = finder.verseText(f.book, f.chapter, f.verse);
      return row ? `${f.book} ${f.chapter}:${f.verse} — "${row}"` : null;
    }).filter(Boolean);
    const detection = await detectScripture(text, context, activeTranslation, hints);

    if (detection.type === 'explicit' && detection.reference) {
      const { book: rawBook, chapter, verse, translation } = detection.reference;
      const book = normaliseBook(rawBook) || rawBook;
      const usedTranslation = translation || activeTranslation;

      if (!Number.isInteger(parseInt(chapter)) || !Number.isInteger(parseInt(verse)) ||
          isNaN(parseInt(chapter)) || isNaN(parseInt(verse)) ||
          parseInt(chapter) < 1 || parseInt(verse) < 1) {
        return answer({ type: 'none' });
      }

      const validation = validateReference(book, parseInt(chapter), parseInt(verse));
      if (!validation.valid) {
        if (validation.code === 'BOOK_NOT_FOUND') return answer({ type: 'none' });
        const near = navigation.nearest(validation.normalised || book, parseInt(chapter), parseInt(verse));
        return answer({ type: 'implicit', source: 'nearest', candidates: near.map(n => ({ book: n.book, chapter: n.chapter, verse: n.verse, confidence: 0.55, snippet: n.why })) });
      }

      const start = parseInt(verse);
      const end = parseInt(detection.reference.verse_end);
      const verseEnd = end > start ? Math.min(end, start + 9) : undefined;
      const verseData = await getPassage(validation.normalised || book, parseInt(chapter), start, verseEnd, usedTranslation, { live: true });
      if (verseData) detection.verseData = verseData;
    }

    return answer(detection);

  } catch (err) {
    console.error('[Detect Error]', err.message);
    return answer({ type: 'none' });
  }
});

module.exports = router;
