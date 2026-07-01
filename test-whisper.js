require('dotenv').config();
const OpenAI = require('openai');
const { toFile } = require('openai');
const fs = require('fs');

function createWav(durationSeconds) {
  const sampleRate = 16000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = sampleRate * durationSeconds;
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);

  // WAV header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * bitsPerSample / 8, 28);
  buffer.writeUInt16LE(numChannels * bitsPerSample / 8, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  // Audio data stays as zeros (silence) — valid WAV, Whisper accepts it

  return buffer;
}

async function test() {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  console.log('Key:', process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.slice(0, 8) : 'MISSING');

  try {
    const wavBuffer = createWav(3);
    console.log('WAV created, size:', wavBuffer.length, 'bytes');
    fs.writeFileSync('/tmp/test_real.wav', wavBuffer);

    const f = await toFile(wavBuffer, 'audio.wav', { type: 'audio/wav' });
    console.log('toFile OK');

    const r = await client.audio.transcriptions.create({
      file: f,
      model: 'whisper-1',
      response_format: 'text'
    });
    console.log('Whisper OK:', JSON.stringify(r));
    console.log('TEST PASSED — Whisper is working correctly');
  } catch(e) {
    console.log('FAIL status:', e.status);
    console.log('FAIL message:', e.message);
  }
}
test();