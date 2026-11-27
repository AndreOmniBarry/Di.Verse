const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const { toFile } = require('openai');
const keys = require('../services/keys');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Two interchangeable speech-to-text providers (both speak the OpenAI API):
//   groq   — whisper-large-v3, higher-accuracy multilingual transcription
//   openai — whisper-1, paid from your OpenAI API credit balance
// TRANSCRIBE_PROVIDER picks one; otherwise Groq is used when GROQ_API_KEY is
// set (free), else OpenAI. If the first one fails on key/quota/network, the
// other is tried, so a dead key or used-up quota doesn't stop the service.
const PROVIDERS = {
  groq: {
    label: 'Groq',
    env: 'GROQ_API_KEY',
    key: () => keys.list('GROQ_API_KEY').length > 0,
    baseURL: 'https://api.groq.com/openai/v1',
    model: () => process.env.GROQ_TRANSCRIBE_MODEL || 'whisper-large-v3',
    language: () => process.env.TRANSCRIBE_LANGUAGE || 'en',
    // Groq bills every request as at least 10 s, so send longer chunks
    chunk: { minSeconds: 6, maxSeconds: 20 },
    keyUrl: 'console.groq.com/keys',
  },
  openai: {
    label: 'OpenAI',
    env: 'OPENAI_API_KEY',
    key: () => keys.list('OPENAI_API_KEY').length > 0,
    baseURL: undefined,
    model: () => process.env.TRANSCRIBE_MODEL || 'whisper-1',
    language: () => process.env.TRANSCRIBE_LANGUAGE || 'en',
    chunk: { minSeconds: 2.5, maxSeconds: 8 },
    keyUrl: 'platform.openai.com/api-keys',
  },
};

// Created on first use so a missing key disables transcription instead of
// crashing the whole server (manual search and projection must keep working).
// One client per key (a provider can have backup keys, see services/keys.js)
const clients = new Map();
function getClient(name, key) {
  const id = name + ':' + key;
  if (!clients.has(id)) clients.set(id, new OpenAI({ apiKey: key, baseURL: PROVIDERS[name].baseURL }));
  return clients.get(id);
}

function providerOrder() {
  const configured = Object.keys(PROVIDERS).filter(n => PROVIDERS[n].key());
  const preferred = (process.env.TRANSCRIBE_PROVIDER || '').toLowerCase();
  const first = configured.includes(preferred) ? preferred : configured.includes('groq') ? 'groq' : configured[0];
  return first ? [first, ...configured.filter(n => n !== first)] : [];
}

// Turn provider failures into something the operator can act on
function describeError(name, err) {
  const p = PROVIDERS[name];
  const code = err.code || (err.error && err.error.code);
  const tag = name.toUpperCase();
  if (err.status === 401) return { code: tag + '_KEY_INVALID', message: `${p.label} API key is invalid or revoked — create a new key at ${p.keyUrl} and update .env` };
  if (err.status === 429 && code === 'insufficient_quota') return { code: tag + '_NO_CREDIT', message: `${p.label} account has no credit left — add credit in its billing page, or set GROQ_API_KEY to use Groq's free tier` };
  if (err.status === 429) return { code: tag + '_RATE_LIMIT', message: `${p.label} ${name === 'groq' ? 'free-tier' : 'rate'} limit reached — wait a minute${name === 'groq' ? ', or add OPENAI_API_KEY as a backup' : ''}` };
  if (err.status === 404) return { code: tag + '_MODEL', message: `Transcription model "${p.model()}" is not available to this ${p.label} account` };
  if (!err.status) return { code: 'NETWORK', message: `Cannot reach ${p.label} — check internet connection` };
  return { code: tag + '_ERROR', message: `${p.label} error ${err.status}: ${err.message}` };
}

// Build a compact dictionary from every installed edition. Whisper's
// prompt is limited to 224 tokens, so each entry uses its code plus one
// distinctive name word; Di.Verse's local parser handles full catalogue names.
const { localTranslations } = require('../services/bibleDb');
const PROMPT_STOP_WORDS = new Set([
  'the', 'a', 'an', 'version', 'translation', 'bible', 'edition',
  'of', 'in', 'for', 'and', 'new', 'testament'
]);

function compactPromptName(name) {
  const words = String(name || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[’']/g, '')
    .match(/[a-zA-Z0-9]+/g) || [];
  const candidates = words.filter(word => !PROMPT_STOP_WORDS.has(word.toLowerCase()));
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0] || '';
}

function buildWhisperPrompt(catalogue) {
  let installed = catalogue;
  if (!installed) {
    try { installed = localTranslations(); }
    catch (error) { installed = {}; }
  }
  const versions = Object.entries(installed || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rawCode, name]) => {
      const code = String(rawCode).toUpperCase();
      const keyword = code === 'PHILLIPS' ? 'J B Phillips' : compactPromptName(name);
      return keyword && normalisePromptCode(keyword) !== code
        ? code + ' ' + keyword
        : code;
    })
    .join(', ');

  // Sermon framing first (Nigerian English, observed book-name confusions),
  // then the installed catalogue. Kept short: Whisper reads at most 224
  // tokens of prompt, and the local parser corrects the rest.
  return 'Nigerian English church sermon. Transcribe verbatim; do not paraphrase. ' +
    'Bible references such as John 3:16; Proverbs, Zephaniah, Ephesians, Ecclesiastes, Nehemiah, Malachi. ' +
    'Installed Bible versions: ' + versions + '.';
}

function normalisePromptCode(value) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
}

const WHISPER_PROMPT = buildWhisperPrompt();

const FAILOVER = err => !err.status || err.status === 401 || err.status === 403 || err.status === 429 || err.status >= 500;

// Tells the operator page how to cut audio for the active provider
router.get('/transcribe/config', (req, res) => {
  const order = providerOrder();
  res.json({ provider: order[0] || null, model: order[0] ? PROVIDERS[order[0]].model() : null, language: order[0] ? PROVIDERS[order[0]].language() : null, chunk: order[0] ? PROVIDERS[order[0]].chunk : PROVIDERS.openai.chunk });
});

async function transcribePcmBuffer(pcmBuffer, sampleRate = 48000) {
  if (!Buffer.isBuffer(pcmBuffer)) return { status: 400, body: { error: 'Audio data must be a PCM buffer', text: '' } };
  const order = providerOrder();
  if (!order.length) return { status: 503, body: {
    code: 'TRANSCRIBE_KEY_MISSING',
    error: 'No transcription key in .env — set GROQ_API_KEY (free) or OPENAI_API_KEY. Manual search still works.',
    text: '',
  } };

  if (pcmBuffer.length < 1000) return { status: 200, body: { text: '' } };

  let tmpPath = null;
  try {
    console.log('[Transcribe] Received PCM bytes:', pcmBuffer.length, 'sampleRate:', sampleRate);
    const wavBuffer = pcmToWAV(pcmBuffer, sampleRate);
    tmpPath = path.join(os.tmpdir(), 'dv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.wav');
    fs.writeFileSync(tmpPath, wavBuffer);

    const fileBuffer = fs.readFileSync(tmpPath);
    const startedAt = Date.now();
    let lastErr = null;

    for (const name of order) {
      try {
        const response = await keys.withKey(PROVIDERS[name].env, async key => getClient(name, key).audio.transcriptions.create({
          file: await toFile(fileBuffer, 'audio.wav', { type: 'audio/wav' }),
          model: PROVIDERS[name].model(),
          response_format: 'json',
          temperature: 0,
          language: PROVIDERS[name].language(),
          prompt: buildWhisperPrompt(),
        }, { maxRetries: 0, timeout: 20000 }));

        const text = filterHallucinations(String((response && response.text) || '').trim());
        const elapsedMs = Date.now() - startedAt;
        console.log(`[Whisper:${name}:${PROVIDERS[name].model()}]`, `${elapsedMs}ms`, text ? '"' + text.slice(0, 100) + '"' : '(silence)');
        const warning = name !== order[0] && lastErr
          ? describeError(lastErr.provider, lastErr).message + ` — using ${PROVIDERS[name].label} instead`
          : undefined;
        return { status: 200, body: {
          text, provider: name, model: PROVIDERS[name].model(), language: PROVIDERS[name].language(),
          elapsedMs, audioDuration: Number(response && response.duration) || null, warning,
        } };
      } catch (err) {
        lastErr = err;
        lastErr.provider = name;
        console.error(`[Whisper:${name} Error]`, err.status || '', err.message);
        if (!FAILOVER(err)) break;
      }
    }
    const info = describeError(lastErr.provider || order[0], lastErr);
    return { status: 502, body: { code: info.code, error: info.message, text: '' } };
  } catch (err) {
    console.error('[Transcribe Error]', err.message);
    return { status: 500, body: { code: 'TRANSCRIBE_ERROR', error: err.message, text: '' } };
  } finally {
    if (tmpPath) try { fs.unlinkSync(tmpPath); } catch (_) {}
  }
}

router.post('/transcribe', async (req, res) => {
  const { audio, sampleRate = 48000 } = req.body || {};
  if (!audio) return res.status(400).json({ error: 'No audio data', text: '' });
  let pcmBuffer;
  try { pcmBuffer = Buffer.from(audio, 'base64'); }
  catch (_) { return res.status(400).json({ error: 'Invalid base64 audio data', text: '' }); }
  const result = await transcribePcmBuffer(pcmBuffer, Number(sampleRate) || 48000);
  return res.status(result.status).json(result.body);
});

function pcmToWAV(pcmData, sampleRate, channels = 1, bitsPerSample = 16) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const dataSize = pcmData.length;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmData]);
}

function filterHallucinations(text) {
  if (!text) return '';
  text = text.replace(/(,?\s*verse\s+\d+){3,}.*/gi, '');
  text = text.replace(/(,?\s*chapter\s+\d+,?\s*verse\s+\d+){2,}.*/gi, '');
  const junk = [/thank you for watching/gi, /please subscribe/gi, /подписывайтесь/gi, /thanks for watching/gi, /(nah[,.\s]*){3,}/gi];
  let c = text;
  for (const p of junk) c = c.replace(p, '');
  c = c.replace(/(\b\d+[,.\s]*){6,}/g, '');
  const words = c.split(/\s+/).filter(Boolean);
  if (words.length > 8 && new Set(words.map(w => w.toLowerCase())).size / words.length < 0.4) return '';
  return c.trim();
}

module.exports = router;
module.exports.WHISPER_PROMPT = WHISPER_PROMPT;
module.exports.buildWhisperPrompt = buildWhisperPrompt;
module.exports.transcribePcmBuffer = transcribePcmBuffer;
