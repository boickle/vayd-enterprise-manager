// AI scribe microphone capture (src/components/soap/ScribePanel.tsx).
// Captures mic audio at 16kHz mono (Deepgram's preferred format for the
// linear16 encoding configured on the backend) and streams base64-encoded
// 20ms PCM16 frames to a callback for sending over the /scribe socket.
// Raw audio never leaves the browser except as these frames — nothing is
// written to disk locally.

const WORKLET_URL = '/audio-worklets/scribe-recorder-worklet.js';
const WORKLET_NAME = 'scribe-recorder-processor';
const TARGET_SAMPLE_RATE = 16000;

export type ScribeAudioCapture = {
  stop: () => void;
};

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Requests microphone access and starts streaming 16kHz PCM16 frames.
 * Throws if getUserMedia / AudioWorklet is unavailable or permission is denied.
 */
export async function startScribeAudioCapture(opts: {
  onChunk: (base64Pcm16: string) => void;
  onError?: (err: unknown) => void;
}): Promise<ScribeAudioCapture> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone access is not supported in this browser.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });

  const AudioContextCtor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('Web Audio API is not supported in this browser.');
  }

  const audioContext = new AudioContextCtor({ sampleRate: TARGET_SAMPLE_RATE });
  let workletNode: AudioWorkletNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let stopped = false;

  try {
    await audioContext.audioWorklet.addModule(WORKLET_URL);
    source = audioContext.createMediaStreamSource(stream);
    workletNode = new AudioWorkletNode(audioContext, WORKLET_NAME);
    workletNode.port.onmessage = (evt: MessageEvent<ArrayBuffer>) => {
      if (stopped) return;
      try {
        opts.onChunk(bufferToBase64(evt.data));
      } catch (err) {
        opts.onError?.(err);
      }
    };
    source.connect(workletNode);
    // Worklet has no audio output we care about, but Chrome requires the
    // node to be connected to the destination graph to keep processing.
    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    workletNode.connect(silentGain);
    silentGain.connect(audioContext.destination);
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    void audioContext.close();
    throw err;
  }

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      try {
        workletNode?.port.close();
        workletNode?.disconnect();
        source?.disconnect();
      } catch {
        /* already torn down */
      }
      stream.getTracks().forEach((t) => t.stop());
      void audioContext.close();
    },
  };
}
