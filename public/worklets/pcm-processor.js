class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._sampleCount = 0;
    // 3 seconds at 48kHz (Chrome macOS default) = 144000 samples
    // At 16kHz = 48000 samples
    // We use 48000 to cover both — worklet fires ~1-3s depending on actual rate
    this._targetSamples = 48000;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const samples = input[0];
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      this._buffer.push(Math.round(s < 0 ? s * 32768 : s * 32767));
      this._sampleCount++;
    }
    if (this._sampleCount >= this._targetSamples) {
      const pcmData = new Int16Array(this._buffer);
      this.port.postMessage({ pcm: pcmData.buffer }, [pcmData.buffer]);
      this._buffer = [];
      this._sampleCount = 0;
    }
    return true;
  }
}
registerProcessor('pcm-processor', PCMProcessor);
