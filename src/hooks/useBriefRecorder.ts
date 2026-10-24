import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createScribeSocket,
  type ScribeSocketHandle,
  type ScribeSocketStatus,
} from '../api/soapScribe';
import { startScribeAudioCapture, type ScribeAudioCapture } from '../utils/scribeAudioCapture';
import { requestKeepAwake, type KeepAwakeHandle } from '../utils/keepAwake';

export type BriefRecorderStatus = ScribeSocketStatus | 'listening';

type SpeechRecognitionCtor = new () => {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult:
    | ((ev: {
        resultIndex: number;
        results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
      }) => void)
    | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function speechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function readDraft(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeDraft(key: string, text: string): void {
  try {
    localStorage.setItem(key, text);
  } catch {
    /* private mode or quota */
  }
}

/**
 * Records a transcript. When a SOAP encounter is linked, uses the visit scribe socket.
 * Otherwise uses the browser speech API so huddles and callbacks still capture text.
 *
 * With `draftKey`, the transcript is also kept on this device as it comes in, so a dropped
 * connection, a server restart, or a reloaded tab does not lose what was already said.
 */
export function useBriefRecorder(
  soapEncounterId?: string | null,
  opts?: { draftKey?: string | null }
) {
  const draftKey = opts?.draftKey?.trim() || null;
  const [status, setStatus] = useState<BriefRecorderStatus>('idle');
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const socketRef = useRef<ScribeSocketHandle | null>(null);
  const audioRef = useRef<ScribeAudioCapture | null>(null);
  const keepAwakeRef = useRef<KeepAwakeHandle | null>(null);
  const speechRef = useRef<{ stop: () => void } | null>(null);
  const timerRef = useRef<number | null>(null);
  const transcriptRef = useRef('');
  /** Text from earlier takes; the server only returns the take that just ended. */
  const priorTextRef = useRef('');

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    if (!draftKey) return;
    const saved = readDraft(draftKey);
    if (saved.trim()) setTranscript((prev) => (prev.trim() ? prev : saved));
  }, [draftKey]);

  const lastDraftRef = useRef('');
  useEffect(() => {
    if (!draftKey) return;
    if (transcript.trim()) {
      writeDraft(draftKey, transcript);
      lastDraftRef.current = transcript;
    } else if (lastDraftRef.current) {
      // Staff cleared the box; the empty box on first load is not a clear.
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* private mode */
      }
      lastDraftRef.current = '';
    }
  }, [draftKey, transcript]);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const teardown = useCallback(() => {
    clearTimer();
    audioRef.current?.stop();
    audioRef.current = null;
    speechRef.current?.stop();
    speechRef.current = null;
    keepAwakeRef.current?.release();
    keepAwakeRef.current = null;
  }, [clearTimer]);

  useEffect(() => () => teardown(), [teardown]);

  const start = useCallback(async () => {
    setError(null);
    setInterim('');
    setElapsed(0);
    priorTextRef.current = transcriptRef.current.trim();
    const awake = await requestKeepAwake();
    keepAwakeRef.current = awake;

    const encounterId = soapEncounterId?.trim();
    if (encounterId) {
      let live = false;
      const socket = createScribeSocket({
        onStatusChange: (next) => {
          setStatus(next);
          // The connection dropped mid-take. Words already received stay in the transcript.
          if (next === 'error' && live) {
            live = false;
            teardown();
            socket.dispose();
            if (socketRef.current === socket) socketRef.current = null;
          }
        },
        onTranscript: (evt) => {
          if (evt.isFinal) {
            setTranscript((prev) => `${prev} ${evt.text}`.trim());
            setInterim('');
          } else {
            setInterim(evt.text);
          }
        },
        onError: (message) => setError(message),
      });
      socketRef.current = socket;
      try {
        await socket.start(encounterId);
        live = true;
        const audio = await startScribeAudioCapture({
          onChunk: (b64) => socket.sendAudio(b64),
          onError: (err) => setError(err instanceof Error ? err.message : 'Microphone error'),
        });
        audioRef.current = audio;
        timerRef.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);
      } catch (err) {
        live = false;
        setError(err instanceof Error ? err.message : 'Could not start recording.');
        teardown();
        socket.dispose();
        socketRef.current = null;
        setStatus('error');
      }
      return;
    }

    const Ctor = speechRecognitionCtor();
    if (!Ctor) {
      setError(
        'Live transcription needs a visit SOAP (for the scribe) or a browser that supports speech recognition. You can still type or paste notes below.'
      );
      setStatus('error');
      return;
    }

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        stream.getTracks().forEach((t) => t.stop());
      });
    } catch {
      setError('Microphone permission is required to record.');
      setStatus('error');
      return;
    }

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (ev) => {
      let finalChunk = '';
      let interimChunk = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const piece = ev.results[i];
        if (!piece) continue;
        const text = piece[0]?.transcript ?? '';
        if (piece.isFinal) finalChunk += `${text} `;
        else interimChunk += text;
      }
      if (finalChunk.trim()) {
        setTranscript((prev) => `${prev} ${finalChunk}`.trim());
      }
      setInterim(interimChunk);
    };
    rec.onerror = (ev) => {
      if (ev.error === 'no-speech' || ev.error === 'aborted') return;
      setError(ev.error ? `Recording error: ${ev.error}` : 'Recording error.');
    };
    rec.onend = () => {
      if (speechRef.current) {
        try {
          rec.start();
        } catch {
          /* already stopped */
        }
      }
    };
    speechRef.current = {
      stop: () => {
        rec.onend = null;
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
      },
    };
    rec.start();
    setStatus('listening');
    timerRef.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);
  }, [soapEncounterId, teardown]);

  const stop = useCallback(async (): Promise<string> => {
    teardown();
    const socket = socketRef.current;
    let text = transcriptRef.current;
    if (socket) {
      const server = (await socket.stop()).trim();
      if (server) {
        const prior = priorTextRef.current;
        text = prior ? `${prior}\n\n${server}` : server;
      }
      socket.dispose();
      socketRef.current = null;
    }
    setInterim('');
    setStatus('idle');
    setTranscript(text);
    return text;
  }, [teardown]);

  const setTranscriptText = useCallback((value: string) => {
    setTranscript(value);
  }, []);

  /** Fills an empty transcript (e.g. from takes the server saved); never overwrites text. */
  const restoreTranscript = useCallback((value: string) => {
    if (!value.trim()) return;
    setTranscript((prev) => (prev.trim() ? prev : value));
  }, []);

  const recording = status === 'recording' || status === 'listening' || status === 'connecting';

  return {
    status,
    recording,
    transcript,
    interim,
    error,
    elapsed,
    start,
    stop,
    setTranscript: setTranscriptText,
    restoreTranscript,
    setError,
  };
}
