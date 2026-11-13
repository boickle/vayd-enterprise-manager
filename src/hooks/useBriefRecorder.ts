import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createScribeSocket,
  type ScribeSocketHandle,
  type ScribeSocketStatus,
} from '../api/soapScribe';
import { startScribeAudioCapture, type ScribeAudioCapture } from '../utils/scribeAudioCapture';
import { requestKeepAwake, type KeepAwakeHandle } from '../utils/keepAwake';

export type BriefRecorderStatus = ScribeSocketStatus;

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
 * Records a transcript through the scribe socket (Deepgram). A medical note records onto its
 * visit (`soapEncounterId`); a Jot records onto the Jot (`opts.jotId`), which wins when both are
 * given. The browser's own speech service is never used: it sends the audio to Google or Apple
 * (B7, owner Nov 13, 2026).
 *
 * With `draftKey`, the transcript is also kept on this device as it comes in, so a dropped
 * connection, a server restart, or a reloaded tab does not lose what was already said.
 */
export function useBriefRecorder(
  soapEncounterId?: string | null,
  opts?: { draftKey?: string | null; jotId?: string | null }
) {
  const jotId = opts?.jotId?.trim() || null;
  const draftKey = opts?.draftKey?.trim() || null;
  const [status, setStatus] = useState<BriefRecorderStatus>('idle');
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const socketRef = useRef<ScribeSocketHandle | null>(null);
  const audioRef = useRef<ScribeAudioCapture | null>(null);
  const keepAwakeRef = useRef<KeepAwakeHandle | null>(null);
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
    const target = jotId ? { jotId } : encounterId || null;
    if (target) {
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
        await socket.start(target);
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

    keepAwakeRef.current?.release();
    keepAwakeRef.current = null;
    setError('Save this note before recording. You can still type or paste notes below.');
    setStatus('error');
  }, [jotId, soapEncounterId, teardown]);

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

  const recording = status === 'recording' || status === 'connecting';

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
