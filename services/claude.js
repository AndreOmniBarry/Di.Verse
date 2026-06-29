require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── System prompt for scripture detection ──
const DETECTION_SYSTEM = `You are Di.Verse, a scripture detection engine inside a live church service.
Analyse sermon transcription text and detect ONLY these things:

1. Explicit scripture references (book + chapter + verse clearly stated)
2. Implicit references (partial Bible quotes with no reference stated)
3. Translation requests (preacher asks for a specific Bible translation)

SUPPORTED TRANSLATIONS: KJV (default), NKJV, AMP, AMPC, TPT, MSG, GNT, TLB, NIV, ESV, NLT.
Default to KJV when no translation is mentioned.

RULES — NO EXCEPTIONS:
- Return ONLY valid JSON. No prose. No markdown. No explanation.
- NEVER invent or fabricate a scripture reference.
- If uncertain whether scripture is being cited, return { "type": "none" }.
- A missed verse is always better than a wrong one.
- For implicit matches: return up to 3 ranked candidates. Never auto-select.
- Detection must work in English, Yoruba, and Nigerian Pidgin.
- Whisper speech-to-text may mishear numbers. "ten" may mean "sixteen", "to" may mean "two", "for" may mean "four". Use biblical context to correct obvious number errors.
- If the speaker says a chapter number followed by a number that seems wrong for a well-known verse, consider the most commonly referenced verse in that chapter.
- Common mishearing: "John 3 ten" almost certainly means "John 3:16". "Romans 8 ten" likely means "Romans 8:28". Use your knowledge of famous verses to self-correct.

JSON SCHEMA — always return exactly this structure:
{
  "type": "explicit" | "implicit" | "translation_change" | "none",
  "reference": { "book": string, "chapter": number, "verse": number, "translation": string },
  "candidates": [ { "book": string, "chapter": number, "verse": number, "confidence": number, "snippet": string } ],
  "new_translation": string,
  "confidence": number,
  "raw_quote": string
}`;

// ── System prompt for verse fetching ──
const VERSE_SYSTEM = `You are a Bible verse provider for Di.Verse, a church display system.
When given a scripture reference and translation, return the exact verse text.

RULES:
- Return ONLY valid JSON. No prose. No markdown. No explanation.
- Return the verse text as accurately as possible from your training knowledge.
- If you are not confident in the exact wording, return your best accurate rendering.
- Never fabricate a verse that does not exist in the Bible.
- Support ALL Bible translations including KJV, NKJV, AMP, AMPC, TPT, MSG, GNT, TLB, NIV, ESV, NLT, NASB, CSB, CEV, NCV, HCSB, ASV, WEB, YLT, DARBY, RSV, NRSV and any other translation requested.

JSON SCHEMA:
{
  "text": string,
  "reference": string,
  "translation": string,
  "confidence": "exact" | "approximate"
}`;

// ── Detect scripture from transcription ──
async function detectScripture(transcriptionChunk, recentContext = '', activeTranslation = 'KJV') {
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      system: DETECTION_SYSTEM,
      messages: [{
        role: 'user',
        content: `ACTIVE TRANSLATION: ${activeTranslation}
RECENT CONTEXT: ${recentContext}
NEW TRANSCRIPTION: ${transcriptionChunk}

Analyse and return JSON only.`
      }]
    });

    const raw = response.content[0].text.trim();
    const clean = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);

  } catch (err) {
    console.error('[Claude Detection Error]', err.message);
    return { type: 'none' };
  }
}

// ── Fetch verse text in any translation ──
async function fetchVerse(book, chapter, verse, translation = 'KJV') {
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      system: VERSE_SYSTEM,
      messages: [{
        role: 'user',
        content: `Provide the exact text of ${book} ${chapter}:${verse} in the ${translation} translation.
Return JSON only.`
      }]
    });

    const raw = response.content[0].text.trim();
    const clean = raw.replace(/```json|```/g, '').trim();
    const data = JSON.parse(clean);

    return {
      reference: `${book} ${chapter}:${verse}`,
      translation,
      text: data.text,
      book,
      chapter,
      verse,
      source: 'claude',
      confidence: data.confidence || 'approximate'
    };

  } catch (err) {
    console.error('[Claude Verse Fetch Error]', err.message);
    return null;
  }
}

module.exports = { detectScripture, fetchVerse };