require('dotenv').config();
const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const { toFile } = require('openai');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Created on first use so a missing key disables transcription instead of
// crashing the whole server (manual search and projection must keep working).
let openai = null;
function getClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

const TRANSCRIBE_MODEL = process.env.TRANSCRIBE_MODEL || 'whisper-1';

// Turn OpenAI failures into something the operator can act on
function describeError(err) {
  const code = err.code || (err.error && err.error.code);
  if (err.status === 401) return { code: 'OPENAI_KEY_INVALID', message: 'OpenAI API key is invalid or revoked — create a new key at platform.openai.com/api-keys and update .env' };
  if (err.status === 429 && code === 'insufficient_quota') return { code: 'OPENAI_NO_CREDIT', message: 'OpenAI account has no credit — add credit at platform.openai.com/settings/organization/billing' };
  if (err.status === 429) return { code: 'OPENAI_RATE_LIMIT', message: 'OpenAI rate limit hit — slow down or raise the account tier' };
  if (err.status === 404) return { code: 'OPENAI_MODEL', message: 'Transcription model "' + TRANSCRIBE_MODEL + '" is not available to this OpenAI account' };
  if (!err.status) return { code: 'NETWORK', message: 'Cannot reach OpenAI — check internet connection' };
  return { code: 'OPENAI_ERROR', message: 'OpenAI error ' + err.status + ': ' + err.message };
}

router.post('/transcribe', async (req, res) => {
  const { audio, sampleRate = 48000 } = req.body;
  if (!audio) return res.status(400).json({ error: 'No audio data' });
  const client = getClient();
  if (!client) return res.status(503).json({ code: 'OPENAI_KEY_MISSING', error: 'OPENAI_API_KEY is not set in .env — live transcription is off, manual search still works', text: '' });

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
    const file = await toFile(fileBuffer, 'audio.wav', { type: 'audio/wav' });

    const response = await client.audio.transcriptions.create({
      file,
      model: TRANSCRIBE_MODEL,
      response_format: 'text',
      temperature: 0,
      prompt: 'Bible verse, chapter, scripture, sermon, church service.',
    });

    const text = (response || '').toString().trim();
    const cleaned = filterHallucinations(text);
    console.log('[Whisper]', cleaned ? '"' + cleaned.slice(0, 80) + '"' : '(silence)');
    res.json({ text: cleaned });

  } catch (err) {
    const info = describeError(err);
    console.error('[Whisper Error]', err.status || '', err.message);
    res.status(502).json({ code: info.code, error: info.message, text: '' });
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
