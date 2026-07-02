require('dotenv').config();
const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const { toFile } = require('openai');
const fs = require('fs');
const path = require('path');
const os = require('os');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

router.post('/transcribe', async (req, res) => {
  const { audio, sampleRate = 48000 } = req.body;
  if (!audio) return res.status(400).json({ error: 'No audio data' });

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

    const response = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      response_format: 'text',
      temperature: 0,
      prompt: 'Bible verse, chapter, scripture, sermon, church service.',
    });

    const text = (response || '').toString().trim();
    const cleaned = filterHallucinations(text);
    console.log('[Whisper]', cleaned ? '"' + cleaned.slice(0, 80) + '"' : '(silence)');
    res.json({ text: cleaned });

  } catch (err) {
    console.error('[Whisper Error]', err.status || '', err.message);
    res.status(500).json({ error: err.message, text: '' });
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
