// src/api/soapScribe.ts
// AI visit scribe: REST audit endpoints + the /scribe Socket.io transport
// (mirrors src/utils/calendarRealtime.ts for the connection pattern).
// The AI never writes to the encounter directly — it only emits suggestions
// here; the doctor applies them through the existing updateEncounter() path.
import { io, type Socket } from 'socket.io-client';
import { http } from './http';
import { apiBaseUrl, getToken } from './http';
import { VISIT_WORKFLOW_PRACTICE_ID } from './visitWorkflow';
import type { EncounterOrderKind, PatientProblemKind } from './visitWorkflow';

export type ScribeSessionStatus = 'active' | 'stopped' | 'error';

export type ScribeExamFinding = {
  status: 'normal' | 'abnormal' | 'not_examined' | null;
  note: string | null;
};

export type ScribeSuggestion = {
  subjectiveHistory: string | null;
  vitals: {
    tempF: string | null;
    weight: string | null;
    hr: string | null;
    rr: string | null;
    bcs: string | null;
    painScore: string | null;
  };
  exam: Record<string, ScribeExamFinding>;
  assessmentReasoning: string | null;
  problems: { label: string; kind: PatientProblemKind }[];
  planItems: { name: string; kind: EncounterOrderKind; note: string | null }[];
};

export type ScribeSession = {
  id: string;
  practiceId: number;
  soapEncounterId: string;
  status: ScribeSessionStatus;
  transcript: string;
  lastSuggestion: ScribeSuggestion | null;
  errorMessage: string | null;
  endedAt: string | null;
  created: string;
  updated: string;
};

export async function listScribeSessions(soapEncounterId: string): Promise<ScribeSession[]> {
  const { data } = await http.get<ScribeSession[]>(
    `/soap-encounters/${encodeURIComponent(soapEncounterId)}/scribe/sessions`,
    { params: { practiceId: VISIT_WORKFLOW_PRACTICE_ID } }
  );
  return data;
}

export async function getScribeSession(
  soapEncounterId: string,
  sessionId: string
): Promise<ScribeSession> {
  const { data } = await http.get<ScribeSession>(
    `/soap-encounters/${encodeURIComponent(soapEncounterId)}/scribe/sessions/${encodeURIComponent(
      sessionId
    )}`,
    { params: { practiceId: VISIT_WORKFLOW_PRACTICE_ID } }
  );
  return data;
}

/** Manual alternative to live recording: structure a pasted transcript in one request. */
export async function structureTranscript(
  soapEncounterId: string,
  transcript: string
): Promise<ScribeSuggestion> {
  const { data } = await http.post<ScribeSuggestion>(
    `/soap-encounters/${encodeURIComponent(soapEncounterId)}/scribe/structure`,
    { practiceId: VISIT_WORKFLOW_PRACTICE_ID, transcript }
  );
  return data;
}

export type ScribeSocketStatus = 'idle' | 'connecting' | 'recording' | 'stopping' | 'error';

export type ScribeSocketHandlers = {
  onTranscript?: (evt: { text: string; isFinal: boolean }) => void;
  onSuggestion?: (evt: { suggestion: ScribeSuggestion }) => void;
  onError?: (message: string) => void;
  onStatusChange?: (status: ScribeSocketStatus) => void;
};

export type ScribeSocketHandle = {
  /** Starts (or restarts) a recording session; resolves once the server confirms. */
  start: (soapEncounterId: string) => Promise<string>;
  sendAudio: (base64Pcm16: string) => void;
  stop: () => Promise<void>;
  dispose: () => void;
};

function normalizeApiOrigin(): string {
  return apiBaseUrl.replace(/\/+$/, '');
}

/** Opens (lazily) a /scribe socket connection for one recording attempt. */
export function createScribeSocket(handlers: ScribeSocketHandlers): ScribeSocketHandle {
  const token = getToken();
  let socket: Socket | null = null;
  let sessionId: string | null = null;
  let disposed = false;

  const setStatus = (s: ScribeSocketStatus) => handlers.onStatusChange?.(s);

  const ensureSocket = (): Socket => {
    if (socket) return socket;
    const base = normalizeApiOrigin();
    socket = io(`${base}/scribe`, {
      auth: { token: token?.trim() ?? '' },
      transports: ['websocket'],
      reconnection: false,
    });
    socket.on(
      'scribe.transcript',
      (payload: { sessionId: string; text: string; isFinal: boolean }) => {
        if (payload.sessionId !== sessionId) return;
        handlers.onTranscript?.({ text: payload.text, isFinal: payload.isFinal });
      }
    );
    socket.on(
      'scribe.suggestion',
      (payload: { sessionId: string; suggestion: ScribeSuggestion }) => {
        if (payload.sessionId !== sessionId) return;
        handlers.onSuggestion?.({ suggestion: payload.suggestion });
      }
    );
    socket.on('scribe.error', (payload: { sessionId?: string; message: string }) => {
      if (payload.sessionId && payload.sessionId !== sessionId) return;
      handlers.onError?.(payload.message);
    });
    socket.on('connect_error', (err: unknown) => {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message?: unknown }).message)
          : String(err);
      setStatus('error');
      handlers.onError?.(`Could not connect to the scribe service (${msg}).`);
    });
    socket.on('disconnect', () => {
      if (!disposed) setStatus('idle');
    });
    return socket;
  };

  return {
    start: (soapEncounterId: string) =>
      new Promise<string>((resolve, reject) => {
        if (!token?.trim()) {
          reject(new Error('Not signed in.'));
          return;
        }
        setStatus('connecting');
        const s = ensureSocket();
        const doStart = () => {
          s.emit(
            'scribe.start',
            { practiceId: VISIT_WORKFLOW_PRACTICE_ID, soapEncounterId },
            (ack: { ok: boolean; error?: string; sessionId?: string }) => {
              if (!ack?.ok || !ack.sessionId) {
                setStatus('error');
                reject(new Error(ack?.error || 'Failed to start the scribe session.'));
                return;
              }
              sessionId = ack.sessionId;
              setStatus('recording');
              resolve(ack.sessionId);
            }
          );
        };
        if (s.connected) doStart();
        else s.once('connect', doStart);
      }),

    sendAudio: (base64Pcm16: string) => {
      if (!socket?.connected || !sessionId) return;
      socket.emit('scribe.audio', { sessionId, audioBase64: base64Pcm16 });
    },

    stop: () =>
      new Promise<void>((resolve) => {
        if (!socket?.connected || !sessionId) {
          resolve();
          return;
        }
        setStatus('stopping');
        const id = sessionId;
        socket.emit('scribe.stop', { sessionId: id }, () => {
          setStatus('idle');
          resolve();
        });
        // Safety net in case the ack never arrives (server crash, etc.)
        setTimeout(resolve, 5000);
      }),

    dispose: () => {
      disposed = true;
      sessionId = null;
      try {
        socket?.removeAllListeners();
        socket?.disconnect();
      } catch {
        /* ignore */
      }
      socket = null;
    },
  };
}
