require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

const OpenAI = require('openai');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Free fallback for detection: Groq (OpenAI-compatible). Used when there is no
// Anthropic key, or when Claude fails on key / credit / rate limit.
let groqClient = null;
let groqDetectModel = null;
function groq() {
  if (!groqClient) groqClient = new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' });
  return groqClient;
}
async function pickGroqDetectModel() {
  if (process.env.GROQ_DETECT_MODEL) return process.env.GROQ_DETECT_MODEL;
  if (groqDetectModel) return groqDetectModel;
  const ids = ((await groq().models.list()).data || []).map(m => m.id);
  const prefs = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];
  groqDetectModel = prefs.find(p => ids.includes(p)) || ids.find(id => !/whisper|guard|tts|embed|compound/i.test(id));
  if (!groqDetectModel) throw new Error('no usable Groq chat model — set GROQ_DETECT_MODEL');
  console.log('[Detect] Groq model:', groqDetectModel);
  return groqDetectModel;
}

// Pull the JSON object out of a reply even if the model wrapped it in prose
function extractJSON(raw) {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON in model reply: ' + raw.slice(0, 120));
  return JSON.parse(raw.slice(start, end + 1));
}

// Operator-facing reason for a failed Claude call (the old code logged it and
// returned "none", so a dead key looked exactly like "no verse spoken")
function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'Anthropic API key is invalid or revoked — update ANTHROPIC_API_KEY in .env';
  if (err instanceof Anthropic.PermissionDeniedError) return 'Anthropic API key lacks permission for this model';
  if (err instanceof Anthropic.RateLimitError) return 'Anthropic rate limit or spend limit reached — check console.anthropic.com billing';
  if (err instanceof Anthropic.APIConnectionError) return 'Cannot reach Anthropic — check internet connection';
  if (err instanceof Anthropic.APIError) return 'Anthropic error ' + err.status + ': ' + err.message;
  return err.message;
}

// ── System prompt for scripture detection ──
const DETECTION_SYSTEM = `You are Di.Verse, a scripture detection engine inside a live church service.
Analyse sermon transcription text and detect ONLY these things:

1. Explicit scripture references — book + chapter + verse clearly stated in any natural form:
   "John 3:16", "John chapter 3 verse 16", "John 3 and 16", "Romans 8 verse 28".
   Confidence must be 0.9 or higher ONLY if the book, chapter, and verse are all unambiguous.

2. Implicit references — ONLY when spoken words closely and substantially match a well-known,
   commonly quoted verse's actual wording. Require strong wording overlap, not loose thematic
   similarity. Do NOT detect implicit matches from generic religious vocabulary alone (grace,
   faith, Christ, wisdom, love) — only from substantial quoted phrasing close to the real verse
   text. If in doubt, return type "none" instead of guessing.

3. Translation requests — preacher asks for a specific Bible translation by name
   ("in the Amplified", "Message Bible", "Passion Translation", "King James").

SUPPORTED TRANSLATIONS: KJV (default), NKJV, AMP, AMPC, TPT, MSG, GNT, TLB, NIV, ESV, NLT,
NASB, CSB, CEV, NCV, HCSB, ASV, WEB and all others. Default to KJV when no translation is mentioned.

CRITICAL — TEXT QUALITY GATE:
- The transcription you receive may contain transcription errors, repeated words, fragments,
  or garbled noise from imperfect speech-to-text. If the text is incoherent, repetitive nonsense,
  a counting sequence, or does not form a real spoken sentence, return { "type": "none" } immediately.
  Do NOT attempt to extract a scripture reference from garbled or repetitive text.
- Never increase confidence above 0.6 if the surrounding sentence context is unclear or broken.

RULES — NO EXCEPTIONS:
- Return ONLY valid JSON. No prose. No markdown. No explanation.
- NEVER invent or fabricate a scripture reference.
- If uncertain whether scripture is being cited, return { "type": "none" }.
- A missed verse is always better than a wrong one. A hallucinated verse is the worst possible
  outcome and must never happen.
- For implicit matches: return at most 2 ranked candidates, only if confidence is genuinely
  above 0.65. Never auto-select.
- Detection must work in English, Yoruba, and Nigerian Pidgin.
- Whisper speech-to-text may mishear numbers. "ten" may mean "sixteen", "to" may mean "two",
  "for" may mean "four". Use biblical context to correct obvious number errors, but only when
  the rest of the sentence is coherent enough to trust.
- Common mishearing: "John 3 ten" likely means "John 3:16" if context is otherwise clean.
  Do not apply this correction to garbled or fragmentary text.

JSON SCHEMA — always return exactly this structure:
{
  "type": "explicit" | "implicit" | "translation_change" | "none",
  "reference": { "book": string, "chapter": number, "verse": number, "translation": string },
  "candidates": [ { "book": string, "chapter": number, "verse": number, "confidence": number, "snippet": string } ],
  "new_translation": string,
  "confidence": number,
  "raw_quote": string
}`;

// ── Detect scripture from transcription ──
async function detectScripture(transcriptionChunk, recentContext = '', activeTranslation = 'KJV') {
  // Pre-filter: skip Claude call entirely on obviously garbled input — saves time and avoids false positives
  if (isGarbledText(transcriptionChunk)) {
    return { type: 'none' };
  }

  const userMessage = `ACTIVE TRANSLATION: ${activeTranslation}
RECENT CONTEXT: ${recentContext}
NEW TRANSCRIPTION: ${transcriptionChunk}

Analyse and return JSON only.`;

  const hasClaude = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasGroq = Boolean(process.env.GROQ_API_KEY);
  if (!hasClaude && !hasGroq) return { type: 'none' }; // parser-only mode; explicit references still work

  let claudeError = null;
  if (hasClaude) {
    try {
      const response = await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 512,
        system: DETECTION_SYSTEM,
        messages: [{ role: 'user', content: userMessage }]
      });
      return screen(extractJSON(response.content[0].text));
    } catch (err) {
      console.error('[Claude Detection Error]', err.message);
      claudeError = describeError(err);
      const recoverable = err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError ||
        err instanceof Anthropic.RateLimitError || err instanceof Anthropic.APIConnectionError ||
        (err instanceof Anthropic.BadRequestError && /credit/i.test(err.message));
      if (!hasGroq || !recoverable) return { type: 'none', error: claudeError };
    }
  }

  try {
    const res = await groq().chat.completions.create({
      model: await pickGroqDetectModel(),
      temperature: 0,
      max_tokens: 512,
      messages: [{ role: 'system', content: DETECTION_SYSTEM }, { role: 'user', content: userMessage }],
    }, { maxRetries: 0, timeout: 10000 });
    const result = screen(extractJSON(res.choices[0].message.content));
    return claudeError ? { ...result, warning: claudeError + ' — using Groq for detection' } : result;
  } catch (err) {
    console.error('[Groq Detection Error]', err.status || '', err.message);
    const groqError = err.status === 429 ? 'Groq free-tier limit reached for detection' : err.status === 401 ? 'Groq API key is invalid' : 'Groq detection failed: ' + err.message;
    return { type: 'none', error: claudeError ? claudeError + '; ' + groqError : groqError };
  }
}

// Safety net: discard explicit detections with suspiciously low confidence
function screen(parsed) {
  if (parsed.type === 'explicit' && (parsed.confidence || 0) < 0.7) return { type: 'none' };
  return parsed;
}

// Quick heuristic check before even calling Claude — catches counting loops, repeated words
function isGarbledText(text) {
  if (!text || text.trim().length < 3) return true;

  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return false; // too short to judge, let Claude decide

  // Counting sequence detection (e.g. "1, 2, 3, 4, 5...")
  const numberCount = words.filter(w => /^\d+[,.]?$/.test(w)).length;
  if (numberCount > words.length * 0.5) return true;

  // Excessive repetition of the same word
  const uniqueRatio = new Set(words.map(w => w.toLowerCase())).size / words.length;
  if (words.length > 6 && uniqueRatio < 0.4) return true;

  return false;
}

module.exports = { detectScripture };
