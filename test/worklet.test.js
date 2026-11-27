'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createProcessor(rate = 48000, options = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../public/worklets/pcm-processor.js'), 'utf8');
  let Processor;
  class AudioWorkletProcessorMock {
    constructor() {
      this.port = {
        messages: [],
        postMessage(message) { this.messages.push(message); },
      };
    }
  }
  const context = {
    AudioWorkletProcessor: AudioWorkletProcessorMock,
    sampleRate: rate,
    Float32Array,
    Int16Array,
    Math,
    registerProcessor(name, Klass) {
      assert.equal(name, 'pcm-processor');
      Processor = Klass;
    },
  };
  vm.runInNewContext(source, context, { filename: 'pcm-processor.js' });
  assert.ok(Processor, 'worklet registers its processor');
  return new Processor({ processorOptions: options });
}

function feed(processor, rate, seconds, amplitude, channels = 1) {
  const blockSize = 128;
  const blocks = Math.ceil(rate * seconds / blockSize);
  const left = new Float32Array(blockSize);
  const right = new Float32Array(blockSize);
  left.fill(channels === 1 ? amplitude : 0);
  right.fill(channels === 1 ? 0 : amplitude);
  for (let i = 0; i < blocks; i++) {
    processor.process([channels === 1 ? [left] : [left, right]]);
  }
}

test('worklet keeps a spoken phrase intact until a natural pause and emits 16 kHz PCM', () => {
  const rate = 48000;
  const processor = createProcessor(rate, { minSeconds: 2.5, maxSeconds: 8 });
  feed(processor, rate, 3.2, 0.04);
  feed(processor, rate, 0.8, 0);
  const chunks = processor.port.messages.filter(message => message.pcm instanceof ArrayBuffer);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].sampleRate, 16000);
  const pcm = new Int16Array(chunks[0].pcm);
  assert.ok(pcm.length >= 48000 && pcm.length <= 64000, 'roughly 3.2 seconds of mono audio retained');
  assert.ok(pcm.some(sample => Math.abs(sample) > 1000), 'speech samples remain in the PCM output');
});

test('worklet downmixes a voice on the right channel instead of dropping it', () => {
  const rate = 44100;
  const processor = createProcessor(rate, { minSeconds: 2.5, maxSeconds: 8 });
  feed(processor, rate, 3, 0.04, 2);
  feed(processor, rate, 0.8, 0, 2);
  const chunk = processor.port.messages.find(message => message.pcm instanceof ArrayBuffer);
  assert.ok(chunk, 'stereo input produces a speech chunk');
  assert.equal(chunk.sampleRate, 16000);
  const pcm = new Int16Array(chunk.pcm);
  assert.ok(pcm.some(sample => Math.abs(sample) > 500), 'right channel reaches the mono transcript audio');
});

test('worklet exposes a real 10 Hz meter and raises its threshold above quiet room noise', () => {
  const rate = 48000;
  const processor = createProcessor(rate, { minSeconds: 2.5, maxSeconds: 8 });
  feed(processor, rate, 2, 0.003, 1);
  const levels = processor.port.messages.filter(message => typeof message.level === 'number');
  assert.ok(levels.length >= 18 && levels.length <= 22, 'level updates stay near ten per second');
  assert.ok(levels[levels.length - 1].noiseFloor > 0.0015, 'ambient floor learns the room');
  assert.ok(levels[levels.length - 1].threshold > 0.0035, 'speech threshold rises above the measured ambient floor');

  feed(processor, rate, 3, 0.04, 1);
  feed(processor, rate, 0.8, 0, 1);
  assert.ok(processor.port.messages.some(message => message.pcm instanceof ArrayBuffer), 'a louder voice still crosses the adaptive threshold');
});
