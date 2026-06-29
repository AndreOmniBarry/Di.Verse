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

    let ext = 'webm';
    if (mimeType.includes('ogg')) ext = 'ogg';
    if (mimeType.includes('mp4')) ext = 'mp4';
    if (mimeType.includes('wav')) ext = 'wav';

    tmpPath = path.join(os.tmpdir(), `diverse_${Date.now()}.${ext}`);
    fs.writeFileSync(tmpPath, buffer);

    const stats = fs.statSync(tmpPath);
    if (stats.size < 1000) {
      return res.json({ text: '' });
    }

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: 'whisper-1',
      response_format: 'text',
      prompt: 'This is a church sermon. The speaker may reference Bible verses such as John 3:16, Romans 8:28, Psalm 23:1, Genesis 1:1. Bible book names, chapter and verse numbers are common. Names like Jesus, God, Holy Spirit, Christ are frequent.',
    });

    const cleaned = fixWhisperNumbers(transcription || '');
    console.log(`[Whisper] Raw: "${transcription}"`);
    console.log(`[Whisper] Fixed: "${cleaned}"`);

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

// Fix common Whisper mishearings for scripture references
function fixWhisperNumbers(text) {
  return text
    // Fix "verse X" patterns where numbers get confused
    .replace(/\bverses?\s+(\w+)/gi, (match, num) => {
      const fixed = wordToNumber(num);
      return fixed ? `verse ${fixed}` : match;
    })
    // Fix chapter/verse spoken as words
    .replace(/\bchapter\s+(\w+)/gi, (match, num) => {
      const fixed = wordToNumber(num);
      return fixed ? `chapter ${fixed}` : match;
    })
    // Common Whisper confusions for teen numbers
    .replace(/\bthirteen\b/gi, '13')
    .replace(/\bfourteen\b/gi, '14')
    .replace(/\bfifteen\b/gi, '15')
    .replace(/\bsixteen\b/gi, '16')
    .replace(/\bseventeen\b/gi, '17')
    .replace(/\beighteen\b/gi, '18')
    .replace(/\bnineteen\b/gi, '19')
    .replace(/\btwenty\b/gi, '20')
    .replace(/\btwenty.?one\b/gi, '21')
    .replace(/\btwenty.?two\b/gi, '22')
    .replace(/\btwenty.?three\b/gi, '23')
    .replace(/\btwenty.?four\b/gi, '24')
    .replace(/\btwenty.?five\b/gi, '25')
    .replace(/\btwenty.?six\b/gi, '26')
    .replace(/\btwenty.?seven\b/gi, '27')
    .replace(/\btwenty.?eight\b/gi, '28')
    .replace(/\btwenty.?nine\b/gi, '29')
    .replace(/\bthirty\b/gi, '30')
    // Fix "ten" when it should be "16" in common verse patterns
    // e.g. "John 3 ten" -> context handled by Claude
    ;
}

function wordToNumber(word) {
  const map = {
    'one':1,'two':2,'three':3,'four':4,'five':5,
    'six':6,'seven':7,'eight':8,'nine':9,'ten':10,
    'eleven':11,'twelve':12,'thirteen':13,'fourteen':14,
    'fifteen':15,'sixteen':16,'seventeen':17,'eighteen':18,
    'nineteen':19,'twenty':20,'thirty':30,'forty':40,
    'fifty':50,'sixty':60,'seventy':70,'eighty':80,'ninety':90
  };
  return map[word.toLowerCase()] || null;
}

module.exports = router;