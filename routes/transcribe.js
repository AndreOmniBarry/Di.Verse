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
  const { audio, mimeType = 'audio/webm' } = req.body;
  if (!audio) return res.status(400).json({ error: 'No audio data' });

  let tmpPath = null;
  try {
    const inBuffer = Buffer.from(audio, 'base64');
    if (inBuffer.length < 1000) return res.json({ text: '' });

   // Save raw bytes with original extension — let Whisper handle the container
    let ext = 'webm';
    if (mimeType.includes('ogg')) ext = 'ogg';
    if (mimeType.includes('mp4')) ext = 'mp4';
    tmpPath = path.join(os.tmpdir(), 'dv_' + Date.now() + '.' + ext);
    fs.writeFileSync(tmpPath, inBuffer);

    const fileBuffer = fs.readFileSync(tmpPath);
    // Force ogg type — Whisper accepts ogg/opus which is what Chrome actually encodes
    const file = await toFile(fileBuffer, 'audio.ogg', { type: 'audio/ogg' });

    const response = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      response_format: 'verbose_json',
      temperature: 0,
      prompt: 'Bible verse, chapter, scripture, sermon, church service.',
    });

   // No segment filtering — use raw text output directly
    text = response.text || '';

    const cleaned = filterHallucinations(text);
    console.log('[Whisper] ' + (cleaned ? cleaned.slice(0, 80) : '(silence)'));
    res.json({ text: cleaned });

  } catch (err) {
    console.error('[Whisper Error]', err.status || '', err.message);
    res.status(500).json({ error: err.message, text: '' });
  } finally {
    if (tmpPath && fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch(e) {}
    }
  }
});

function isPCM(buffer) {
  // WAV files start with "RIFF"
  return buffer.slice(0, 4).toString('ascii') !== 'RIFF';
}

function wrapInWAV(pcmData) {
  const sampleRate = 16000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const dataSize = pcmData.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * numChannels * bitsPerSample / 8, 28);
  header.writeUInt16LE(numChannels * bitsPerSample / 8, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmData]);
}

function filterHallucinations(text) {
  if (!text) return '';
  const junk = [
    /thank you for watching/gi, /please subscribe/gi,
    /подписывайтесь/gi, /thanks for watching/gi,
    /(nah[,.\s]*){3,}/gi,
  ];
  let c = text;
  for (const p of junk) c = c.replace(p, '');
  c = c.replace(/(\b\d+[,.\s]*){6,}/g, '');
  const words = c.split(/\s+/).filter(Boolean);
  if (words.length > 8 && new Set(words.map(w => w.toLowerCase())).size / words.length < 0.4) return '';
  return c.trim();
}

module.exports = router;