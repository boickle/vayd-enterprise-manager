// src/api/soapScribe.ts
// AI visit scribe: REST audit endpoints + the /scribe Socket.io transport
// (mirrors src/utils/calendarRealtime.ts for the connection pattern).
// The socket is transcription-only — it streams interim/final text as the doctor talks but never
// runs AI structuring itself. Structuring is always a single, explicit, on-demand call via
// `structureTranscript()` below (whether the transcript came from recording or was pasted/typed);
// suggestions are then written through the existing updateEncounter() path (same as a manual
// edit) — see docs/ai-scribe.md.
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
    weightUnit?: 'lb' | 'kg' | null;
    weightNotTaken?: boolean | null;
    hr: string | null;
    rr: string | null;
    bcs: string | null;
    painScore: string | null;
  };
  exam: Record<string, ScribeExamFinding>;
  assessmentReasoning: string | null;
  problems: { label: string; kind: PatientProblemKind }[];
  planItems: { name: string; kind: EncounterOrderKind; note: string | null }[];
  /** Freeform Objective/Plan for the Document view — only populated on a final pass (paste, or
   * recording stop). Subjective/Assessment don't need an equivalent since they auto-apply into
   * `subjectiveHistory`/`assessmentReasoning` above on every cycle. */
  narrativeObjective: string | null;
  narrativePlan: string | null;
  clientEmailSubject: string | null;
  clientEmailBody: string | null;
};

/** Roster entry sent to the backend for a multi-pet structuring pass (docs/ai-scribe.md
 * "Multi-pet visits") — mirrors `HouseholdRosterEntry` but only the fields the LLM prompt needs. */
export type TranscriptPatientRosterEntry = {
  patientId: number;
  name: string;
  species?: string | null;
  soapEncounterId: string;
};

/** Per-patient slice of a multi-pet structuring pass — same extraction fields as
 * `ScribeSuggestion` minus the (shared) client email, plus the Objective/Plan narrative text. */
export type MultiPatientSuggestionEntry = {
  patientId: number;
  subjectiveHistory: string | null;
  vitals: ScribeSuggestion['vitals'];
  exam: ScribeSuggestion['exam'];
  assessmentReasoning: string | null;
  problems: ScribeSuggestion['problems'];
  planItems: ScribeSuggestion['planItems'];
  objectiveNotes: string;
  planNotes: string;
};

export type MultiPatientScribeSuggestion = {
  multiPatient: true;
  patients: MultiPatientSuggestionEntry[];
  clientEmailSubject: string | null;
  clientEmailBody: string | null;
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

/** Deletes the saved transcript text for a visit (session audit rows are kept). */
export async function clearScribeTranscript(soapEncounterId: string): Promise<void> {
  await http.delete(`/soap-encounters/${encodeURIComponent(soapEncounterId)}/scribe/transcript`, {
    params: { practiceId: VISIT_WORKFLOW_PRACTICE_ID },
  });
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

/**
 * Manual alternative to live recording: structure a pasted transcript in one request. Passing 2+
 * `patients` (docs/ai-scribe.md "Multi-pet visits") switches the response to a per-patient
 * breakdown for review instead of a single suggestion.
 */
export async function structureTranscript(
  soapEncounterId: string,
  transcript: string,
  patients?: TranscriptPatientRosterEntry[]
): Promise<ScribeSuggestion | MultiPatientScribeSuggestion> {
  const { data } = await http.post<ScribeSuggestion | MultiPatientScribeSuggestion>(
    `/soap-encounters/${encodeURIComponent(soapEncounterId)}/scribe/structure`,
    {
      practiceId: VISIT_WORKFLOW_PRACTICE_ID,
      transcript,
      ...(patients && patients.length > 1 ? { patients } : {}),
    }
  );
  return data;
}

/**
 * Rewrite Room Loader / pre-visit Q&A into a short Subjective history note (1–3 paragraphs).
 * Does not mutate the encounter — caller saves via updateEncounter after review.
 */
export async function summarizeIntakeHistory(
  soapEncounterId: string,
  intakeText: string,
  patientName?: string | null
): Promise<string> {
  const { data } = await http.post<{ summary: string }>(
    `/soap-encounters/${encodeURIComponent(soapEncounterId)}/scribe/summarize-intake`,
    {
      practiceId: VISIT_WORKFLOW_PRACTICE_ID,
      intakeText,
      ...(patientName?.trim() ? { patientName: patientName.trim() } : {}),
    }
  );
  return typeof data?.summary === 'string' ? data.summary.trim() : '';
}

/**
 * Jot: drop car/tech chit-chat from a spoken recording and return a chart-ready note.
 * Does not require a SOAP encounter.
 */
export async function polishSpokenNotes(opts: {
  transcript: string;
  kind: 'visit' | 'previsit' | 'callback' | 'huddle' | 'review';
  patientName?: string | null;
  clientName?: string | null;
}): Promise<string> {
  const { data } = await http.post<{ summary: string }>('/scribe/polish-transcript', {
    practiceId: VISIT_WORKFLOW_PRACTICE_ID,
    transcript: opts.transcript,
    kind: opts.kind,
    ...(opts.patientName?.trim() ? { patientName: opts.patientName.trim() } : {}),
    ...(opts.clientName?.trim() ? { clientName: opts.clientName.trim() } : {}),
  });
  return typeof data?.summary === 'string' ? data.summary.trim() : '';
}

export async function summarizeChartText(opts: {
  mode: 'outside-record' | 'case-history' | 'household';
  sourceText?: string;
  images?: { mimeType: string; base64: string }[];
  patientName?: string | null;
  clientName?: string | null;
  fileName?: string | null;
  asOfDate?: string | null;
}): Promise<string> {
  const { data } = await http.post<{ summary: string }>('/scribe/summarize-chart', {
    practiceId: VISIT_WORKFLOW_PRACTICE_ID,
    mode: opts.mode,
    ...(opts.sourceText?.trim() ? { sourceText: opts.sourceText.trim() } : {}),
    ...(opts.images?.length ? { images: opts.images } : {}),
    ...(opts.patientName?.trim() ? { patientName: opts.patientName.trim() } : {}),
    ...(opts.clientName?.trim() ? { clientName: opts.clientName.trim() } : {}),
    ...(opts.fileName?.trim() ? { fileName: opts.fileName.trim() } : {}),
    ...(opts.asOfDate?.trim() ? { asOfDate: opts.asOfDate.trim() } : {}),
  });
  return typeof data?.summary === 'string' ? data.summary.trim() : '';
}

export async function chatAboutChart(opts: {
  sourceText: string;
  question: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  patientName?: string | null;
  asOfDate?: string | null;
  patientId?: string | number | null;
  clientId?: string | number | null;
  chatScope?: 'patient' | 'client' | 'practice' | null;
  clientName?: string | null;
  staffName?: string | null;
  staffRole?: string | null;
  staffEmail?: string | null;
  practiceName?: string | null;
  practicePhone?: string | null;
  practiceEmail?: string | null;
  practiceAddress?: string | null;
  practiceWebsite?: string | null;
}): Promise<string> {
  const trim = (v?: string | null) => (v?.trim() ? v.trim() : undefined);
  const asId = (v?: string | number | null) => {
    if (v == null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const { data } = await http.post<{ answer: string }>('/scribe/chart-chat', {
    practiceId: VISIT_WORKFLOW_PRACTICE_ID,
    sourceText: opts.sourceText,
    question: opts.question.trim(),
    ...(opts.history?.length ? { history: opts.history } : {}),
    ...(trim(opts.patientName) ? { patientName: trim(opts.patientName) } : {}),
    ...(trim(opts.asOfDate) ? { asOfDate: trim(opts.asOfDate) } : {}),
    ...(asId(opts.patientId) != null ? { patientId: asId(opts.patientId) } : {}),
    ...(asId(opts.clientId) != null ? { clientId: asId(opts.clientId) } : {}),
    ...(opts.chatScope ? { chatScope: opts.chatScope } : {}),
    ...(trim(opts.clientName) ? { clientName: trim(opts.clientName) } : {}),
    ...(trim(opts.staffName) ? { staffName: trim(opts.staffName) } : {}),
    ...(trim(opts.staffRole) ? { staffRole: trim(opts.staffRole) } : {}),
    ...(trim(opts.staffEmail) ? { staffEmail: trim(opts.staffEmail) } : {}),
    ...(trim(opts.practiceName) ? { practiceName: trim(opts.practiceName) } : {}),
    ...(trim(opts.practicePhone) ? { practicePhone: trim(opts.practicePhone) } : {}),
    ...(trim(opts.practiceEmail) ? { practiceEmail: trim(opts.practiceEmail) } : {}),
    ...(trim(opts.practiceAddress) ? { practiceAddress: trim(opts.practiceAddress) } : {}),
    ...(trim(opts.practiceWebsite) ? { practiceWebsite: trim(opts.practiceWebsite) } : {}),
  });
  return typeof data?.answer === 'string' ? data.answer.trim() : '';
}

export type CaseHistoryChatTurn = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
};

export type AssistantChatScope = 'patient' | 'client' | 'practice';

export type AssistantChatSearchHit = {
  scope: AssistantChatScope;
  patientId: string | null;
  clientId: string | null;
  practiceId: number | null;
  updatedAt: string;
  snippet: string;
  matchCount: number;
};

/** Private to the signed-in user. Other staff never receive this thread. */
export async function fetchMyCaseHistoryChat(patientId: string): Promise<CaseHistoryChatTurn[]> {
  const { data } = await http.get<{ messages?: CaseHistoryChatTurn[] }>('/scribe/case-history-chat', {
    params: { patientId },
  });
  return Array.isArray(data?.messages) ? data.messages : [];
}

export async function saveMyCaseHistoryChat(
  patientId: string,
  messages: CaseHistoryChatTurn[]
): Promise<CaseHistoryChatTurn[]> {
  const { data } = await http.put<{ messages?: CaseHistoryChatTurn[] }>('/scribe/case-history-chat', {
    patientId,
    messages,
  });
  return Array.isArray(data?.messages) ? data.messages : messages;
}

export async function deleteMyCaseHistoryChat(patientId: string): Promise<void> {
  await http.delete('/scribe/case-history-chat', { params: { patientId } });
}

export async function fetchMyAssistantChat(opts: {
  scope: AssistantChatScope;
  patientId?: string | null;
  clientId?: string | null;
  practiceId?: number | null;
}): Promise<CaseHistoryChatTurn[]> {
  const { data } = await http.get<{ messages?: CaseHistoryChatTurn[] }>('/scribe/assistant-chat', {
    params: {
      scope: opts.scope,
      ...(opts.patientId ? { patientId: opts.patientId } : {}),
      ...(opts.clientId ? { clientId: opts.clientId } : {}),
      ...(opts.practiceId != null ? { practiceId: opts.practiceId } : {}),
    },
  });
  return Array.isArray(data?.messages) ? data.messages : [];
}

export async function saveMyAssistantChat(opts: {
  scope: AssistantChatScope;
  patientId?: string | null;
  clientId?: string | null;
  practiceId?: number | null;
  messages: CaseHistoryChatTurn[];
}): Promise<CaseHistoryChatTurn[]> {
  const { data } = await http.put<{ messages?: CaseHistoryChatTurn[] }>('/scribe/assistant-chat', {
    scope: opts.scope,
    ...(opts.patientId ? { patientId: opts.patientId } : {}),
    ...(opts.clientId ? { clientId: opts.clientId } : {}),
    ...(opts.practiceId != null ? { practiceId: opts.practiceId } : {}),
    messages: opts.messages,
  });
  return Array.isArray(data?.messages) ? data.messages : opts.messages;
}

export async function deleteMyAssistantChat(opts: {
  scope: AssistantChatScope;
  patientId?: string | null;
  clientId?: string | null;
  practiceId?: number | null;
}): Promise<void> {
  await http.delete('/scribe/assistant-chat', {
    params: {
      scope: opts.scope,
      ...(opts.patientId ? { patientId: opts.patientId } : {}),
      ...(opts.clientId ? { clientId: opts.clientId } : {}),
      ...(opts.practiceId != null ? { practiceId: opts.practiceId } : {}),
    },
  });
}

/** Search only the signed-in user's chats across patients and households. */
export async function searchMyAssistantChats(
  q: string,
  limit = 20
): Promise<AssistantChatSearchHit[]> {
  const { data } = await http.get<{ hits?: AssistantChatSearchHit[] }>(
    '/scribe/assistant-chat/search',
    { params: { q: q.trim(), limit } }
  );
  return Array.isArray(data?.hits) ? data.hits : [];
}

/** Practice-wide desk context (staffing, catalog snapshot, Scout help). */
export async function fetchPracticeDeskContext(opts?: {
  date?: string | null;
}): Promise<{
  sourceText: string;
  asOfDate: string;
  timezone: string;
  viewerIsAdmin: boolean;
}> {
  const { data } = await http.get<{
    sourceText?: string;
    asOfDate?: string;
    timezone?: string;
    viewerIsAdmin?: boolean;
  }>('/scribe/practice-desk-context', {
    params: {
      practiceId: VISIT_WORKFLOW_PRACTICE_ID,
      ...(opts?.date?.trim() ? { date: opts.date.trim() } : {}),
    },
  });
  return {
    sourceText: typeof data?.sourceText === 'string' ? data.sourceText : '',
    asOfDate: typeof data?.asOfDate === 'string' ? data.asOfDate : '',
    timezone: typeof data?.timezone === 'string' ? data.timezone : 'America/New_York',
    viewerIsAdmin: data?.viewerIsAdmin === true,
  };
}

export type ScribeSocketStatus = 'idle' | 'connecting' | 'recording' | 'stopping' | 'error';

export type ScribeSocketHandlers = {
  onTranscript?: (evt: { text: string; isFinal: boolean }) => void;
  onError?: (message: string) => void;
  onStatusChange?: (status: ScribeSocketStatus) => void;
};

export type ScribeSocketHandle = {
  /** Starts (or restarts) a recording session; resolves once the server confirms. */
  start: (soapEncounterId: string) => Promise<string>;
  sendAudio: (base64Pcm16: string) => void;
  /** Stops recording; resolves with the full final transcript captured server-side. */
  stop: () => Promise<string>;
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
      new Promise<string>((resolve) => {
        if (!socket?.connected || !sessionId) {
          resolve('');
          return;
        }
        setStatus('stopping');
        const id = sessionId;
        socket.emit(
          'scribe.stop',
          { sessionId: id },
          (ack?: { ok: boolean; transcript?: string }) => {
            setStatus('idle');
            resolve(ack?.transcript ?? '');
          }
        );
        // Safety net in case the ack never arrives (server crash, etc.)
        setTimeout(() => resolve(''), 5000);
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
