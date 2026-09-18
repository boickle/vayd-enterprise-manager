import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createScribeSocket,
  type ScribeSocketHandle,
  type ScribeSocketStatus,
} from '../api/soapScribe';
import { startScribeAudioCapture, type ScribeAudioCapture } from '../utils/scribeAudioCapture';

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

/**
 * Records a transcript. When a SOAP encounter is linked, uses the visit scribe socket.
 * Otherwise uses the browser speech API so huddles and callbacks still capture text.
 */
export function useBriefRecorder(soapEncounterId?: string | null) {
  const [status, setStatus] = useState<BriefRecorderStatus>('idle');
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const socketRef = useRef<ScribeSocketHandle | null>(null);
  const audioRef = useRef<ScribeAudioCapture | null>(null);
  const speechRef = useRef<{ stop: () => void } | null>(null);
  const timerRef = useRef<number | null>(null);
  const transcriptRef = useRef('');

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

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
  }, [clearTimer]);

  useEffect(() => () => teardown(), [teardown]);

  const start = useCallback(async () => {
    setError(null);
    setInterim('');
    setElapsed(0);

    const encounterId = soapEncounterId?.trim();
    if (encounterId) {
      const socket = createScribeSocket({
        onStatusChange: setStatus,
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
        const audio = await startScribeAudioCapture({
          onChunk: (b64) => socket.sendAudio(b64),
          onError: (err) => setError(err instanceof Error ? err.message : 'Microphone error'),
        });
        audioRef.current = audio;
        timerRef.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);
      } catch (err) {
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
      const server = await socket.stop();
      if (server.trim()) text = server.trim();
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
    setError,
  };
}
