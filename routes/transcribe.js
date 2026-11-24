const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const { toFile } = require('openai');
const keys = require('../services/keys');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Two interchangeable speech-to-text providers (both speak the OpenAI API):
//   groq   — whisper-large-v3-turbo, free tier (about 8 hours of audio a day)
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
    model: () => process.env.GROQ_TRANSCRIBE_MODEL || 'whisper-large-v3-turbo',
    // Groq bills every request as at least 10 s, so send longer chunks
    chunk: { minSeconds: 6, maxSeconds: 12 },
    keyUrl: 'console.groq.com/keys',
  },
  openai: {
    label: 'OpenAI',
    env: 'OPENAI_API_KEY',
    key: () => keys.list('OPENAI_API_KEY').length > 0,
    baseURL: undefined,
    model: () => process.env.TRANSCRIBE_MODEL || 'whisper-1',
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

// Whisper spells unfamiliar words by sound ("Purvas", "Poovams" for Proverbs);
// listing the book names makes it expect them
const WHISPER_PROMPT = 'Church sermon with Bible references, e.g. John chapter 3 verse 16. Genesis, Exodus, Leviticus, Numbers, Deuteronomy, Joshua, Judges, Ruth, Samuel, Kings, Chronicles, Ezra, Nehemiah, Esther, Job, Psalms, Proverbs, Ecclesiastes, Song of Solomon, Isaiah, Jeremiah, Lamentations, Ezekiel, Daniel, Hosea, Joel, Amos, Obadiah, Jonah, Micah, Nahum, Habakkuk, Zephaniah, Haggai, Zechariah, Malachi, Matthew, Mark, Luke, John, Acts, Romans, Corinthians, Galatians, Ephesians, Philippians, Colossians, Thessalonians, Timothy, Titus, Philemon, Hebrews, James, Peter, Jude, Revelation. KJV, NKJV, NIV, Amplified, The Passion Translation, The Message, J. B. Phillips, Phillips New Testament in Modern English.';

const FAILOVER = err => !err.status || err.status === 401 || err.status === 403 || err.status === 429 || err.status >= 500;

// Tells the operator page how to cut audio for the active provider
router.get('/transcribe/config', (req, res) => {
  const order = providerOrder();
  res.json({ provider: order[0] || null, chunk: order[0] ? PROVIDERS[order[0]].chunk : PROVIDERS.openai.chunk });
});

router.post('/transcribe', async (req, res) => {
  const { audio, sampleRate = 48000 } = req.body;
  if (!audio) return res.status(400).json({ error: 'No audio data' });
  const order = providerOrder();
  if (!order.length) return res.status(503).json({ code: 'TRANSCRIBE_KEY_MISSING', error: 'No transcription key in .env — set GROQ_API_KEY (free) or OPENAI_API_KEY. Manual search still works.', text: '' });

  let tmpPath = null;
  try {
    const pcmBuffer = Buffer.from(audio, 'base64');
    console.log('[Transcribe] Received PCM bytes:', pcmBuffer.length, 'sampleRate:', sampleRate);

    if (pcmBuffer.length < 1000) {
      console.log('[Transcribe] Chunk too small, skipping');
      return res.json({ text: '' });
    }

    const wavBuffer = pcmToWAV(pcmBuffer, sampleRate);
    tmpPath = path.join(os.tmpdir(), 'dv_' + Date.now() + '.wav');
    fs.writeFileSync(tmpPath, wavBuffer);
    console.log('[Transcribe] WAV written:', wavBuffer.length, 'bytes');

    const fileBuffer = fs.readFileSync(tmpPath);

    let lastErr = null;
    for (const name of order) {
      try {
        const response = await keys.withKey(PROVIDERS[name].env, async key => getClient(name, key).audio.transcriptions.create({
          file: await toFile(fileBuffer, 'audio.wav', { type: 'audio/wav' }),
          model: PROVIDERS[name].model(),
          response_format: 'json',
          temperature: 0,
          prompt: WHISPER_PROMPT,
        }, { maxRetries: 0, timeout: 20000 }));

        const text = String((response && response.text) || '').trim();
        const cleaned = filterHallucinations(text);
        console.log(`[Whisper:${name}]`, cleaned ? '"' + cleaned.slice(0, 80) + '"' : '(silence)');
        // A backup provider answering is worth knowing about, once per chunk
        const warning = name !== order[0] && lastErr ? describeError(lastErr.provider, lastErr).message + ` — using ${PROVIDERS[name].label} instead` : undefined;
        return res.json({ text: cleaned, provider: name, warning });
      } catch (err) {
        lastErr = err;
        lastErr.provider = name;
        console.error(`[Whisper:${name} Error]`, err.status || '', err.message);
        if (!FAILOVER(err)) break;
      }
    }
    const info = describeError(lastErr.provider || order[0], lastErr);
    res.status(502).json({ code: info.code, error: info.message, text: '' });

  } catch (err) {
    console.error('[Transcribe Error]', err.message);
    res.status(500).json({ code: 'TRANSCRIBE_ERROR', error: err.message, text: '' });
  } finally {
    if (tmpPath) try { fs.unlinkSync(tmpPath); } catch(e) {}
  }
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
