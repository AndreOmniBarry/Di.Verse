const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const os = require('os');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

router.post('/transcribe', async (req, res) => {
  const { audio, mimeType = 'audio/webm' } = req.body;
  if (!audio) return res.status(400).json({ error: 'No audio data received' });

  let tmpPath = null;

  try {
    const buffer = Buffer.from(audio, 'base64');

    // Reject chunks too small to contain meaningful speech
    if (buffer.length < 6000) {
      return res.json({ text: '' });
    }

    let ext = 'webm';
    if (mimeType.includes('ogg')) ext = 'ogg';
    if (mimeType.includes('mp4')) ext = 'mp4';

    tmpPath = path.join(os.tmpdir(), 'dv_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.' + ext);
    fs.writeFileSync(tmpPath, buffer);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: 'whisper-1',
      response_format: 'verbose_json',
      temperature: 0,
      prompt: 'Bible verse, chapter, scripture reference, sermon, church service.',
    });

    let text = '';

    if (transcription.segments && transcription.segments.length > 0) {
      // Filter segments: reject low confidence AND high "no_speech_prob" (silence-as-words)
      const goodSegments = transcription.segments.filter(s => {
        const lowConfidence = s.avg_logprob !== undefined && s.avg_logprob < -0.9;
        const likelySilence = s.no_speech_prob !== undefined && s.no_speech_prob > 0.5;
        const tooCompressed = s.compression_ratio !== undefined && s.compression_ratio > 2.4;
        return !lowConfidence && !likelySilence && !tooCompressed;
      });
      text = goodSegments.map(s => s.text).join(' ').trim();
    } else {
      text = transcription.text || '';
    }

    const cleaned = filterHallucinations(text);
    res.json({ text: cleaned });

  } catch (err) {
    console.error('[Whisper Error]', err.message);
    res.status(500).json({ error: err.message, text: '' });
  } finally {
    if (tmpPath && fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
  }
});

function filterHallucinations(text) {
  if (!text) return '';

  const junkPhrases = [
    /thank you for watching/gi,
    /please subscribe/gi,
    /like and subscribe/gi,
    /подписывайтесь/gi,
    /ставьте лайки/gi,
    /коментуйте/gi,
    /thanks for watching/gi,
    /see you in the next video/gi,
    /(nah[,.\s]*){2,}/gi,
    /(ha+h+[,.\s]*){2,}/gi,
    /[\u0100-\uFFFF]{4,}/g, // non-Latin garbage blocks (random unicode hallucination)
  ];

  let cleaned = text;
  for (const pattern of junkPhrases) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Detect and strip number-counting hallucination loops ("1, 2, 3, 4, 5...")
  const numberSequence = cleaned.match(/(\d+[,.\s]+){5,}/g);
  if (numberSequence) {
    cleaned = cleaned.replace(/(\d+[,.\s]+){5,}/g, '');
  }

  // Strip excessive repetition of the same short phrase/word (hallucination loop)
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length > 8) {
    const uniqueRatio = new Set(words.map(w => w.toLowerCase())).size / words.length;
    if (uniqueRatio < 0.4) {
      return '';
    }
  }

  return cleaned.trim();
}

module.exports = router;
