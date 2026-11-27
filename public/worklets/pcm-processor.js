// Captures mic audio, downsamples to 16 kHz mono Int16 and cuts it into
// utterances at natural pauses. Silent stretches are never sent, so Whisper
// isn't fed silence (its main source of invented text) and a reference like
// "John 3:16" isn't split across two fixed-length chunks.
const OUT_RATE = 16000;
const START_RMS = 0.0035;       // low enough for quiet PA feeds and distant microphones
const RELEASE_RMS = 0.0025;     // hysteresis keeps syllables from chattering on/off
const NOISE_LEARN_ALPHA = 0.002; // slowly learns the room level only between speech bursts
// Defaults; the operator page passes the active provider's values
// (Groq bills each request as 10 s minimum, so it gets longer chunks)
const DEFAULT_MIN_SECONDS = 2.5; // don't cut before this much audio
const DEFAULT_MAX_SECONDS = 8;   // always cut by this point
const PAUSE_SECONDS = 0.65;      // keep small pauses inside one Bible reference together
const MIN_SPEECH_SECONDS = 0.4;  // less speech than this = drop the chunk

class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this._minSeconds = opts.minSeconds || DEFAULT_MIN_SECONDS;
    this._maxSeconds = opts.maxSeconds || DEFAULT_MAX_SECONDS;
    this._ratio = sampleRate / OUT_RATE; // `sampleRate` is a worklet global
    this._pos = 0;                       // fractional read position for resampling
    this._out = [];
    this._speechSamples = 0;
    this._silenceRun = 0;
    this._levelSamples = 0;
    this._noiseFloor = 0.0015;
    this._speechActive = false;
    this._mono = null;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels || !channels[0]) return true;

    // The browser may still deliver stereo even when mono was requested.
    // Average channels before VAD/resampling so a voice panned to the right
    // does not disappear simply because channel zero is quiet.
    let samples = channels[0];
    if (channels.length > 1) {
      if (!this._mono || this._mono.length !== samples.length) this._mono = new Float32Array(samples.length);
      for (let i = 0; i < samples.length; i++) {
        let sum = 0;
        for (let ch = 0; ch < channels.length; ch++) sum += channels[ch][i] || 0;
        this._mono[i] = sum / channels.length;
      }
      samples = this._mono;
    }

    let sumSq = 0;
    for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
    const rms = Math.sqrt(sumSq / samples.length);
    const startThreshold = Math.max(START_RMS, Math.min(0.012, this._noiseFloor * 2.5));
    const releaseThreshold = Math.max(RELEASE_RMS, Math.min(0.008, this._noiseFloor * 1.65));
    const isSpeech = rms > (this._speechActive ? releaseThreshold : startThreshold);

    // Learn the ambient floor gradually during non-speech periods. Capping the
    // learned sample prevents loud transient noise from disabling quiet voice.
    if (!this._speechActive && !isSpeech) {
      const ambient = Math.min(rms, 0.02);
      this._noiseFloor += (ambient - this._noiseFloor) * NOISE_LEARN_ALPHA;
    }

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
    if (isSpeech) {
      this._speechActive = true;
      this._speechSamples += blockOut;
      this._silenceRun = 0;
    } else if (this._speechActive) {
      this._silenceRun += blockOut;
    }

    // Level meter at a true 10 Hz, independent of device sample rate/block size.
    this._levelSamples += samples.length;
    if (this._levelSamples >= sampleRate * 0.1) {
      this._levelSamples %= sampleRate * 0.1;
      this.port.postMessage({
        level: rms,
        speech: isSpeech,
        noiseFloor: this._noiseFloor,
        threshold: this._speechActive ? releaseThreshold : startThreshold,
      });
    }

    const len = this._out.length;
    const pauseEnded = this._speechActive && len >= this._minSeconds * OUT_RATE && this._silenceRun >= PAUSE_SECONDS * OUT_RATE;
    if (pauseEnded || len >= this._maxSeconds * OUT_RATE) this._flush();
    // Long silence with no speech: discard instead of growing forever
    else if (this._speechSamples === 0 && len >= DEFAULT_MIN_SECONDS * OUT_RATE) this._reset();
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
    this._speechActive = false;
  }
}
registerProcessor('pcm-processor', PCMProcessor);
