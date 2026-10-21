// Captures mic audio, downsamples to 16 kHz mono Int16 and cuts it into
// utterances at natural pauses. Silent stretches are never sent, so Whisper
// isn't fed silence (its main source of invented text) and a reference like
// "John 3:16" isn't split across two fixed-length chunks.
const OUT_RATE = 16000;
const SPEECH_RMS = 0.012;        // block RMS above this counts as speech
const MIN_SECONDS = 2.5;         // don't cut before this much audio
const MAX_SECONDS = 8;           // always cut by this point
const PAUSE_SECONDS = 0.45;      // silence that ends an utterance
const MIN_SPEECH_SECONDS = 0.4;  // less speech than this = drop the chunk

class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ratio = sampleRate / OUT_RATE; // `sampleRate` is a worklet global
    this._pos = 0;                       // fractional read position for resampling
    this._out = [];
    this._speechSamples = 0;
    this._silenceRun = 0;
    this._levelTick = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const samples = input[0];

    let sumSq = 0;
    for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
    const rms = Math.sqrt(sumSq / samples.length);
    const isSpeech = rms > SPEECH_RMS;

    // Linear-interpolation resample to 16 kHz
    while (this._pos < samples.length - 1) {
      const i = Math.floor(this._pos);
      const f = this._pos - i;
      const s = Math.max(-1, Math.min(1, samples[i] * (1 - f) + samples[i + 1] * f));
      this._out.push(Math.round(s < 0 ? s * 32768 : s * 32767));
      this._pos += this._ratio;
    }
    this._pos -= samples.length;

    const blockOut = samples.length / this._ratio;
    if (isSpeech) { this._speechSamples += blockOut; this._silenceRun = 0; }
    else this._silenceRun += blockOut;

    // Level meter for the operator UI, ~10 times a second
    if (++this._levelTick % 37 === 0) this.port.postMessage({ level: rms, speech: isSpeech });

    const len = this._out.length;
    const pauseEnded = len >= MIN_SECONDS * OUT_RATE && this._silenceRun >= PAUSE_SECONDS * OUT_RATE;
    if (pauseEnded || len >= MAX_SECONDS * OUT_RATE) this._flush();
    // Long silence with no speech: discard instead of growing forever
    else if (this._speechSamples === 0 && len >= MIN_SECONDS * OUT_RATE) this._reset();
    return true;
  }

  _flush() {
    if (this._speechSamples >= MIN_SPEECH_SECONDS * OUT_RATE) {
      const pcm = new Int16Array(this._out);
      this.port.postMessage({ pcm: pcm.buffer, sampleRate: OUT_RATE }, [pcm.buffer]);
    }
    this._reset();
  }

  _reset() {
    this._out = [];
    this._speechSamples = 0;
    this._silenceRun = 0;
  }
}
registerProcessor('pcm-processor', PCMProcessor);
