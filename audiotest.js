require('dotenv').config();
const OpenAI = require('openai');
const { toFile } = require('openai');
const fs = require('fs');

async function test() {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  
  // Build a 3-second silent WAV at 48kHz (matching what browser sends)
  const sampleRate = 48000;
  const duration = 3;
  const numSamples = sampleRate * duration;
  const dataSize = numSamples * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  const wav = Buffer.concat([header, Buffer.alloc(dataSize)]);
  
  const file = await toFile(wav, 'audio.wav', { type: 'audio/wav' });
  const r = await client.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    response_format: 'text'
  });
  console.log('Whisper 48kHz WAV OK:', JSON.stringify(r));
}
test().catch(e => console.log('FAIL:', e.status, e.message));