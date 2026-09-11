// AI scribe microphone worklet (src/utils/scribeAudioCapture.ts).
// Runs on the audio rendering thread: buffers incoming Float32 samples (the
// AudioContext is created at 16kHz so the browser handles resampling) and
// posts 20ms Int16 PCM frames back to the main thread for streaming to the
// backend over the /scribe socket.
const FRAME_SIZE = 320; // 20ms @ 16kHz

class ScribeRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(0);
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (!channel || channel.length === 0) return true;

    const merged = new Float32Array(this._buffer.length + channel.length);
    merged.set(this._buffer);
    merged.set(channel, this._buffer.length);
    this._buffer = merged;

    while (this._buffer.length >= FRAME_SIZE) {
      const frame = this._buffer.subarray(0, FRAME_SIZE);
      const pcm16 = new Int16Array(FRAME_SIZE);
      for (let i = 0; i < FRAME_SIZE; i++) {
        const s = Math.max(-1, Math.min(1, frame[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
      this._buffer = this._buffer.subarray(FRAME_SIZE);
    }
    return true;
  }
}

registerProcessor('scribe-recorder-processor', ScribeRecorderProcessor);
