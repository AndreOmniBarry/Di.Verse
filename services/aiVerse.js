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
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');

const TIMEOUT_MS = 15000;
const SEARCH_TIMEOUT_MS = 25000; // a web-search-grounded answer takes longer
const PROVIDER_TIMEOUT_MS = 60000; // overall cap per provider, fallbacks included
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
- Give the ${translation} wording as exactly as you can, even if you are unsure of a word or two:
  your answer is compared with other sources and a person checks anything that doesn't match.
- Set "found" to false only if you do not know this verse in the ${translation} at all.
- Never substitute another translation's wording (for example KJV) for the ${translation}.
Reply with JSON only: {"found": true|false, "text": "..."}`;
}

function parseReply(raw) {
  const s = String(raw || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let data;
  try { data = JSON.parse(s.slice(start, end + 1)); } catch (e) { return null; }
  if (!data.found || !data.text) return null;
  const text = String(data.text)
    .replace(/^\s*\d+\s+/, '')                // stray verse number
    .replace(/\s*\[\d+\]|\[[a-z]\]/gi, '')    // footnote markers
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

// ── Gemini ──
async function geminiFetch(path, body, timeoutMs = TIMEOUT_MS) {
  const res = await fetch(GEMINI_BASE + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error('Gemini HTTP ' + res.status + ': ' + ((json.error && json.error.message) || '').slice(0, 200));
    err.status = res.status;
    throw err;
  }
  return json;
}

// Model names and free-tier quotas change often. Build an ordered list of
// candidates (GEMINI_MODEL first if set, then flash models newest first) and
// fall through it: a free key often has no quota on the newest model, so a
// 429/404 on one model means "try the next", not "Gemini is down".
let geminiCandidates = null;
const FALLBACK_GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
async function geminiModelList() {
  if (geminiCandidates) return geminiCandidates;
  let found = [];
  try {
    const { models = [] } = await geminiFetch('/models?pageSize=200', undefined, SEARCH_TIMEOUT_MS);
    found = models
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name.replace(/^models\//, ''))
      .filter(n => /^gemini-[\d.]+-flash(-lite)?$/.test(n));
  } catch (err) {
    // A slow or failed model list shouldn't stop Gemini: try well-known names
    // (each is checked when called, and a missing one just moves to the next)
    console.log(`[AI Verse] Gemini model list unavailable (${err.status || err.name}) — trying known models`);
    found = FALLBACK_GEMINI_MODELS;
  }
  const version = n => parseFloat(n.match(/gemini-([\d.]+)/)[1]);
  found.sort((a, b) => (version(b) - version(a)) || (a.includes('lite') - b.includes('lite')));
  const list = [...new Set([process.env.GEMINI_MODEL, ...found].filter(Boolean))].slice(0, 5);
  if (found === FALLBACK_GEMINI_MODELS) return list; // try discovery again next call
  geminiCandidates = list;
  if (!geminiCandidates.length) throw new Error('no Gemini flash model available to this key — set GEMINI_MODEL');
  return geminiCandidates;
}

// Moves a model that worked to the front so later calls go straight to it
function preferGemini(model) {
  geminiCandidates = [model, ...(geminiCandidates || []).filter(m => m !== model)];
  if (geminiModel !== model) console.log('[AI Verse] Gemini model:', model);
  geminiModel = model;
}

async function askGemini(book, chapter, verse, translation) {
  const candidates = await geminiModelList();
  const body = grounded => ({
    contents: [{ role: 'user', parts: [{ text: prompt(book, chapter, verse, translation, grounded) }] }],
    generationConfig: { temperature: 0 },
    ...(grounded ? { tools: [{ google_search: {} }] } : {}),
  });

  let lastErr = null;
  for (const model of candidates) {
    let json = null, grounded = true;
    try {
      json = await geminiFetch(`/models/${model}:generateContent`, body(true), SEARCH_TIMEOUT_MS);
    } catch (err) {
      // Search grounding has its own (smaller) free quota and can be slow —
      // on a quota error or a timeout, retry as plain recall
      const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
      if (!timedOut && ![400, 403, 404, 429].includes(err.status)) throw err;
      if (timedOut) console.log(`[AI Verse] Gemini ${model}: web search too slow — asking without search`);
      grounded = false;
      try {
        json = await geminiFetch(`/models/${model}:generateContent`, body(false));
      } catch (err2) {
        if (![403, 404, 429].includes(err2.status)) throw err2;
        console.log(`[AI Verse] Gemini ${model}: no free quota (${err2.status}) — trying the next model`);
        lastErr = err2;
        continue;
      }
    }
    preferGemini(model);
    const cand = (json.candidates || [])[0] || {};
    const raw = ((cand.content && cand.content.parts) || []).map(p => p.text || '').join('');
    // Grounding counts only if the response shows a search actually ran
    const meta = cand.groundingMetadata;
    const searched = grounded && Boolean(meta && ((meta.groundingChunks || []).length || (meta.webSearchQueries || []).length));
    const text = parseReply(raw);
    if (!text) console.log(`[AI Verse] Gemini ${model} did not give the wording. Reply: ${raw.slice(0, 160).replace(/\s+/g, ' ')}`);
    return text && { provider: 'gemini', model, text, grounded: searched };
  }
  throw lastErr;
}

// ── Groq (OpenAI-compatible) ──
let groqClient = null;
function groq() {
  if (!groqClient) groqClient = new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' });
  return groqClient;
}

// groq/compound has built-in web search; otherwise large general models. Up to
// two are asked in turn, because a model may decline to quote a translation
// it isn't sure of.
let groqCandidates = null;
async function groqModelList() {
  if (groqCandidates) return groqCandidates;
  const ids = ((await groq().models.list()).data || []).map(m => m.id);
  const prefs = ['groq/compound', 'compound-beta', 'llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'moonshotai/kimi-k2-instruct', 'qwen/qwen3-32b'];
  const general = ids.filter(id => !/whisper|guard|tts|embed|orpheus|prompt|mini|8b|20b/i.test(id));
  groqCandidates = [...new Set([process.env.GROQ_MODEL, ...prefs.filter(p => ids.includes(p)), ...general].filter(Boolean))].slice(0, 2);
  if (!groqCandidates.length) throw new Error('no usable Groq chat model — set GROQ_MODEL');
  console.log('[AI Verse] Groq models:', groqCandidates.join(', '));
  groqModel = groqCandidates[0];
  return groqCandidates;
}

// Every available Groq model is asked (two at most, from different makers),
// and each answer counts as a separate opinion in the cross-check below
async function askGroq(book, chapter, verse, translation) {
  const candidates = await groqModelList();
  const results = await Promise.allSettled(candidates.map(async model => {
    const canSearch = /compound/.test(model);
    const res = await groq().chat.completions.create({
      model,
      temperature: 0,
      messages: [{ role: 'user', content: prompt(book, chapter, verse, translation, canSearch) }],
    }, { timeout: TIMEOUT_MS, maxRetries: 0 });
    const msg = (res.choices && res.choices[0] && res.choices[0].message) || {};
    const text = parseReply(msg.content);
    if (!text) {
      console.log(`[AI Verse] Groq ${model} did not give the wording. Reply: ${String(msg.content || '').slice(0, 160).replace(/\s+/g, ' ')}`);
      return null;
    }
    // compound reports the tools it ran; only call it grounded if a search happened
    const searched = canSearch && Boolean((msg.executed_tools || []).length);
    return { provider: 'groq', model, label: model.split('/').pop(), text, grounded: searched };
  }));
  const answers = results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
  if (answers.length) return answers;
  const failed = results.find(r => r.status === 'rejected');
  if (failed) {
    console.log(`[AI Verse] Groq: ${failed.reason.status || ''} ${String(failed.reason.message).slice(0, 100)}`);
    throw failed.reason;
  }
  return null;
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
    withTimeout(PROVIDERS[name](book, chapter, verse, translation), PROVIDER_TIMEOUT_MS, name)
      .catch(err => {
        lastError[name] = describeError(name, err);
        if ([401, 403, 429].includes(err.status)) downUntil[name] = Date.now() + DOWN_FOR_MS;
        console.error('[AI Verse]', lastError[name]);
        throw err;
      })
  ));

  // A provider may return one answer or several (one per model)
  const answers = settled
    .filter(r => r.status === 'fulfilled' && r.value)
    .flatMap(r => r.value)
    .map(a => ({ ...a, label: a.label || a.provider }))
    .filter(a => plausibleLength(a.text, kjvText));
  for (const a of answers) lastError[a.provider] = null;

  if (!answers.length) {
    const errs = settled.map((r, i) => r.status === 'rejected' ? lastError[enabled[i][0]] || r.reason.message : null).filter(Boolean);
    return { error: errs.length ? 'AI lookup failed: ' + errs.join('; ') : `No AI provider could find ${translation} wording for this verse` };
  }

  // For each answer, which other providers agree with it?
  const scored = answers.map(a => ({
    ...a,
    agreeing: answers.filter(b => b !== a && similarity(a.text, b.text) >= AGREE_THRESHOLD).map(b => b.label),
  }));
  // Prefer: most agreement, then a web-grounded answer, then Gemini > Groq > Claude
  const order = ['gemini', 'groq', 'claude']; // tie-break by provider
  scored.sort((x, y) => (y.agreeing.length - x.agreeing.length) || (y.grounded - x.grounded) || (order.indexOf(x.provider) - order.indexOf(y.provider)));
  const best = scored[0];

  // Any disagreement means a human checks it, even if one side searched the web
  const disagreed = answers.length > 1 && !best.agreeing.length;
  const verification = best.agreeing.length ? 'verified' : (best.grounded && !disagreed) ? 'grounded' : 'unverified';
  const sources = [best.label, ...best.agreeing];

  return {
    reference: `${book} ${chapter}:${verse}`,
    translation,
    text: best.text,
    book,
    chapter,
    verse,
    source: 'ai',
    verification,
    aiSources: [...new Set([best.provider, ...answers.filter(x => best.agreeing.includes(x.label)).map(x => x.provider)])],
    note: verification === 'verified' ? `AI beta · matched by ${sources.join(' + ')}`
      : verification === 'grounded' ? `AI beta · web-searched by ${best.provider}`
      : `AI beta · UNVERIFIED (${disagreed ? 'sources disagreed, showing ' + best.label + (best.grounded ? ' web-searched' : '') : best.label + ' only'}) — check wording`,
  };
}

function status() {
  const c = configured();
  return { available: isAvailable(), providers: Object.keys(c).filter(k => c[k]), errors: { ...lastError } };
}

module.exports = { getVerse, isAvailable, status, similarity, parseReply, TRANSLATION_NAMES, _reset: () => { geminiModel = null; groqModel = null; geminiCandidates = null; groqCandidates = null; groqClient = null; claudeClient = null; for (const k in downUntil) delete downUntil[k]; for (const k in lastError) delete lastError[k]; } };
