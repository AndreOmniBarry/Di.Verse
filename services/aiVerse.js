// Beta / proof-of-concept path for translations Di.Verse has no licensed
// text for (TPT, NKJV, AMP... when API.Bible isn't set up). Asks up to three
// AI providers for the verse at the same time and cross-checks them:
//
//   Gemini  — with Google Search grounding, so it looks the verse up
//   Groq    — groq/compound (has web search) or another available model
//   Claude  — recall, using the existing ANTHROPIC_API_KEY
//
// The result is labelled:
//   verified   — two or more providers returned the same wording
//   grounded   — one provider, but its answer came from a web search
//   unverified — a single recall nobody confirmed; operator must check it,
//                and it is never auto-pushed or saved
//
// Not for a commercial release: replace with licensed text (API.Bible or a
// publisher licence) before charging customers.
require('dotenv').config();
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');

const TIMEOUT_MS = 15000;
const AGREE_THRESHOLD = 0.8;   // word-bigram similarity counted as "same wording"
const DOWN_FOR_MS = 60000;     // skip a provider for a minute after auth/quota errors

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const TRANSLATION_NAMES = {
  NKJV: 'New King James Version', AMP: 'Amplified Bible', AMPC: 'Amplified Bible, Classic Edition',
  TPT: 'The Passion Translation', MSG: 'The Message', GNT: 'Good News Translation',
  TLB: 'The Living Bible', NIV: 'New International Version', ESV: 'English Standard Version',
  NLT: 'New Living Translation', NASB: 'New American Standard Bible', CSB: 'Christian Standard Bible',
  CEV: 'Contemporary English Version', NCV: 'New Century Version', HCSB: 'Holman Christian Standard Bible',
  WEB: 'World English Bible', NRSV: 'New Revised Standard Version', RSV: 'Revised Standard Version',
};

const downUntil = {};   // provider -> timestamp
const lastError = {};   // provider -> message
let geminiModel = null; // discovered once
let groqModel = null;

function configured() {
  return {
    gemini: Boolean(process.env.GEMINI_API_KEY),
    groq: Boolean(process.env.GROQ_API_KEY),
    claude: Boolean(process.env.ANTHROPIC_API_KEY) && process.env.AI_VERSE_USE_CLAUDE !== 'false',
  };
}

function isAvailable() {
  return Object.values(configured()).some(Boolean);
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label + ' timed out')), ms)),
  ]);
}

function prompt(book, chapter, verse, translation, canSearch) {
  const name = TRANSLATION_NAMES[translation] || translation;
  return `Give the exact text of ${book} ${chapter}:${verse} in the ${name} (${translation}).
${canSearch ? 'Search the web for this verse on a Bible website and copy its wording exactly.\n' : ''}Rules:
- Only that single verse, word for word. No verse number, no reference, no footnotes, no commentary.
- If you cannot find or are not certain of the exact ${translation} wording, set "found" to false.
Reply with JSON only: {"found": true|false, "text": "..."}`;
}

function parseReply(raw) {
  const s = String(raw || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON in reply');
  const data = JSON.parse(s.slice(start, end + 1));
  if (!data.found || !data.text) return null;
  const text = String(data.text)
    .replace(/^\s*\d+\s+/, '')                // stray verse number
    .replace(/\s*\[\d+\]|\[[a-z]\]/gi, '')    // footnote markers
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

// ── Gemini ──
async function geminiFetch(path, body) {
  const res = await fetch(GEMINI_BASE + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error('Gemini HTTP ' + res.status + ': ' + ((json.error && json.error.message) || '').slice(0, 200));
    err.status = res.status;
    throw err;
  }
  return json;
}

// Model names change often; use GEMINI_MODEL if set, otherwise pick the
// newest "flash" model this key can call
async function pickGeminiModel() {
  if (process.env.GEMINI_MODEL) return process.env.GEMINI_MODEL;
  if (geminiModel) return geminiModel;
  const { models = [] } = await geminiFetch('/models?pageSize=200');
  const usable = models
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''))
    .filter(n => /^gemini-[\d.]+-flash(-lite)?$/.test(n));
  const version = n => parseFloat(n.match(/gemini-([\d.]+)/)[1]);
  usable.sort((a, b) => (version(b) - version(a)) || (a.includes('lite') - b.includes('lite')));
  if (!usable.length) throw new Error('no Gemini flash model available to this key — set GEMINI_MODEL');
  geminiModel = usable[0];
  console.log('[AI Verse] Gemini model:', geminiModel);
  return geminiModel;
}

async function askGemini(book, chapter, verse, translation) {
  const model = await pickGeminiModel();
  const body = grounded => ({
    contents: [{ role: 'user', parts: [{ text: prompt(book, chapter, verse, translation, grounded) }] }],
    generationConfig: { temperature: 0 },
    ...(grounded ? { tools: [{ google_search: {} }] } : {}),
  });
  let json, grounded = true;
  try {
    json = await geminiFetch(`/models/${model}:generateContent`, body(true));
  } catch (err) {
    // Some free keys/models don't allow search grounding — fall back to recall
    if (err.status !== 400 && err.status !== 403) throw err;
    grounded = false;
    json = await geminiFetch(`/models/${model}:generateContent`, body(false));
  }
  const cand = (json.candidates || [])[0] || {};
  const raw = ((cand.content && cand.content.parts) || []).map(p => p.text || '').join('');
  // Grounding counts only if the response shows a search actually ran
  const meta = cand.groundingMetadata;
  const searched = grounded && Boolean(meta && ((meta.groundingChunks || []).length || (meta.webSearchQueries || []).length));
  const text = parseReply(raw);
  return text && { provider: 'gemini', model, text, grounded: searched };
}

// ── Groq (OpenAI-compatible) ──
let groqClient = null;
function groq() {
  if (!groqClient) groqClient = new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' });
  return groqClient;
}

// groq/compound has built-in web search; otherwise the largest general model
async function pickGroqModel() {
  if (process.env.GROQ_MODEL) return process.env.GROQ_MODEL;
  if (groqModel) return groqModel;
  const list = await groq().models.list();
  const ids = (list.data || []).map(m => m.id);
  const prefs = ['groq/compound', 'compound-beta', 'openai/gpt-oss-120b', 'llama-3.3-70b-versatile'];
  groqModel = prefs.find(p => ids.includes(p)) || ids.find(id => !/whisper|guard|tts|embed/i.test(id));
  if (!groqModel) throw new Error('no usable Groq chat model — set GROQ_MODEL');
  console.log('[AI Verse] Groq model:', groqModel);
  return groqModel;
}

async function askGroq(book, chapter, verse, translation) {
  const model = await pickGroqModel();
  const canSearch = /compound/.test(model);
  const res = await groq().chat.completions.create({
    model,
    temperature: 0,
    messages: [{ role: 'user', content: prompt(book, chapter, verse, translation, canSearch) }],
  }, { timeout: TIMEOUT_MS, maxRetries: 0 });
  const msg = (res.choices && res.choices[0] && res.choices[0].message) || {};
  const text = parseReply(msg.content);
  // compound reports the tools it ran; only call it grounded if a search happened
  const searched = canSearch && Boolean((msg.executed_tools || []).length);
  return text && { provider: 'groq', model, text, grounded: searched };
}

// ── Claude (recall) ──
let claudeClient = null;
async function askClaude(book, chapter, verse, translation) {
  if (!claudeClient) claudeClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.CLAUDE_VERSE_MODEL || 'claude-haiku-4-5';
  const res = await claudeClient.messages.create({
    model,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt(book, chapter, verse, translation, false) }],
  }, { timeout: TIMEOUT_MS, maxRetries: 0 });
  const raw = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const text = parseReply(raw);
  return text && { provider: 'claude', model, text, grounded: false };
}

const PROVIDERS = { gemini: askGemini, groq: askGroq, claude: askClaude };

// ── Comparison ──
function words(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

// Dice coefficient over word bigrams: 1 = identical wording
function similarity(a, b) {
  const grams = t => { const w = words(t); const out = []; for (let i = 0; i < w.length - 1; i++) out.push(w[i] + ' ' + w[i + 1]); return out.length ? out : w; };
  const A = grams(a), B = grams(b);
  const pool = new Map();
  for (const g of A) pool.set(g, (pool.get(g) || 0) + 1);
  let hits = 0;
  for (const g of B) { const n = pool.get(g); if (n) { hits++; pool.set(g, n - 1); } }
  return (2 * hits) / (A.length + B.length || 1);
}

// Rejects answers that are clearly not one verse (a whole paragraph, a
// one-word reply) using the KJV length as a yardstick
function plausibleLength(text, kjvText) {
  if (!kjvText) return true;
  const ratio = words(text).length / Math.max(1, words(kjvText).length);
  return ratio >= 0.25 && ratio <= 5;
}

function describeError(provider, err) {
  const s = err.status;
  if (s === 401 || s === 403) return `${provider} key rejected`;
  if (s === 429) return `${provider} free-tier limit reached`;
  return `${provider}: ${err.message}`;
}

// Main entry. kjvText is used only as a length sanity check.
async function getVerse(book, chapter, verse, translation, kjvText) {
  const enabled = Object.entries(configured()).filter(([name, on]) => on && !(downUntil[name] > Date.now()));
  if (!enabled.length) {
    const why = Object.values(lastError).filter(Boolean).join('; ');
    return { error: why || 'No AI provider configured (GEMINI_API_KEY, GROQ_API_KEY or ANTHROPIC_API_KEY)' };
  }

  const settled = await Promise.allSettled(enabled.map(([name]) =>
    withTimeout(PROVIDERS[name](book, chapter, verse, translation), TIMEOUT_MS + 2000, name)
      .catch(err => {
        lastError[name] = describeError(name, err);
        if ([401, 403, 429].includes(err.status)) downUntil[name] = Date.now() + DOWN_FOR_MS;
        console.error('[AI Verse]', lastError[name]);
        throw err;
      })
  ));

  const answers = settled
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value)
    .filter(a => plausibleLength(a.text, kjvText));
  for (const a of answers) lastError[a.provider] = null;

  if (!answers.length) {
    const errs = settled.filter(r => r.status === 'rejected').map(r => r.reason.message);
    return { error: errs.length ? 'AI lookup failed: ' + errs.join('; ') : `No AI provider could find ${translation} wording for this verse` };
  }

  // For each answer, which other providers agree with it?
  const scored = answers.map(a => ({
    ...a,
    agreeing: answers.filter(b => b !== a && similarity(a.text, b.text) >= AGREE_THRESHOLD).map(b => b.provider),
  }));
  // Prefer: most agreement, then a web-grounded answer, then Gemini > Groq > Claude
  const order = ['gemini', 'groq', 'claude'];
  scored.sort((x, y) => (y.agreeing.length - x.agreeing.length) || (y.grounded - x.grounded) || (order.indexOf(x.provider) - order.indexOf(y.provider)));
  const best = scored[0];

  // Any disagreement means a human checks it, even if one side searched the web
  const disagreed = answers.length > 1 && !best.agreeing.length;
  const verification = best.agreeing.length ? 'verified' : (best.grounded && !disagreed) ? 'grounded' : 'unverified';
  const sources = [best.provider, ...best.agreeing];

  return {
    reference: `${book} ${chapter}:${verse}`,
    translation,
    text: best.text,
    book,
    chapter,
    verse,
    source: 'ai',
    verification,
    aiSources: sources,
    note: verification === 'verified' ? `AI beta · matched by ${sources.join(' + ')}`
      : verification === 'grounded' ? `AI beta · web-searched by ${best.provider}`
      : `AI beta · UNVERIFIED (${disagreed ? 'providers disagreed, showing ' + best.provider + (best.grounded ? ' web-searched' : '') : best.provider + ' only'}) — check wording`,
  };
}

function status() {
  const c = configured();
  return { available: isAvailable(), providers: Object.keys(c).filter(k => c[k]), errors: { ...lastError } };
}

module.exports = { getVerse, isAvailable, status, similarity, parseReply, TRANSLATION_NAMES, _reset: () => { geminiModel = null; groqModel = null; groqClient = null; claudeClient = null; for (const k in downUntil) delete downUntil[k]; for (const k in lastError) delete lastError[k]; } };
