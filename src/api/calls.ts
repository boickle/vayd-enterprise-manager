/** Quo (OpenPhone) calls matched to a client, for the chart call pill. */
import { http } from './http';

/**
 * `transcribing` is the gap between hanging up and Quo posting the transcript — usually
 * under a couple of minutes. Past this wait the dock says the summary is taking longer than
 * 3 minutes and Scout is still checking (COM-CALL, owner Nov 10, 2026: it never gives up on
 * its own; the person can Dismiss).
 */
export const TRANSCRIPT_WAIT_MS = 3 * 60 * 1000;

export type CallPhase =
  | 'ringing'
  | 'active'
  | 'transcribing'
  | 'transcript_ready'
  /** Transcribed, but it was scheduling or billing — nothing for the record. */
  | 'no_record_needed'
  | 'ended';

export type ClientCall = {
  callId: string;
  clientId: number | null;
  practiceId: number | null;
  phase: CallPhase;
  direction: string | null;
  counterpartyPhone: string | null;
  startedAt: string | null;
  answeredAt: string | null;
  completedAt: string | null;
  durationSeconds: number | null;
  hasTranscript: boolean;
  transcriptText: string | null;
  /** One line describing what the call was about, from triage. */
  triageReason: string | null;
  triageCategory: string | null;
  initiatedByEmployeeId: number | null;
  answeredByEmployeeId: number | null;
  filedAt: string | null;
  dismissedAt: string | null;
  /** Present on /mine so the dock can label a card without another fetch. */
  clientName?: string | null;
  /**
   * What Quo said when Scout's background catch-up asked for the transcript
   * (`absent` / `failed` = none will come). Null until it has asked.
   */
  transcriptStatus?: string | null;
  /** Why it was dismissed, e.g. 'auto: non-clinical after 24h'. Null for a person's Dismiss. */
  dismissedReason?: string | null;
  /** When someone first opened the review window (then it is never auto-cleared). */
  reviewOpenedAt?: string | null;
};

/**
 * Stop the follow-up sweep chasing this call. Pass the note id when it was filed to a
 * chart; pass nothing to wave it off.
 */
export async function resolveCall(
  callId: string,
  opts?: { noteId?: string | null; filed?: boolean },
): Promise<void> {
  await http.post(`/openphone/calls/${encodeURIComponent(callId)}/resolve`, {
    noteId: opts?.noteId ?? null,
    filed: opts?.filed ?? Boolean(opts?.noteId),
  });
}

/**
 * COM-CALL (owner, Nov 11, 2026): record that the review window was opened. A non-clinical call
 * nobody opened clears itself from the dock 24 hours after it ended; an opened one never does.
 */
export async function markCallReviewOpened(callId: string): Promise<void> {
  await http.post(`/openphone/calls/${encodeURIComponent(callId)}/opened`);
}

/**
 * Recent calls for a client, newest first. Called on mount so a chart opened mid-call — or
 * opened after the transcript already landed — still shows the pill.
 */
export async function claimCallsForClient(clientId: number): Promise<{ claimed: number }> {
  const { data } = await http.post<{ claimed?: number }>('/openphone/calls/claim-for-client', {
    clientId,
  });
  return { claimed: Number(data?.claimed) || 0 };
}

/**
 * My own undecided calls (not filed or dismissed), however old, for the stacked dock that
 * follows me around the app. The server sends the newest 50; `more` says there are older ones.
 */
export async function listMyCalls(): Promise<{ calls: ClientCall[]; more: boolean }> {
  const { data } = await http.get<{ calls: ClientCall[]; more?: boolean }>('/openphone/calls/mine');
  return { calls: Array.isArray(data?.calls) ? data.calls : [], more: data?.more === true };
}

/**
 * Calls for a client, newest first. Answered calls nobody has filed or dismissed come back
 * however old; `sinceMinutes` only bounds the rest (filed, dismissed, unanswered).
 */
export async function listClientCalls(
  clientId: number,
  opts?: { sinceMinutes?: number },
): Promise<{ calls: ClientCall[]; phoneKeys: string[] }> {
  const { data } = await http.get<{ calls: ClientCall[]; phoneKeys?: string[] }>(
    `/openphone/calls/for-client/${clientId}`,
    { params: opts?.sinceMinutes ? { sinceMinutes: opts.sinceMinutes } : undefined },
  );
  return {
    calls: Array.isArray(data?.calls) ? data.calls : [],
    phoneKeys: Array.isArray(data?.phoneKeys) ? data.phoneKeys : [],
  };
}

/**
 * One call by Scout's row id (`openphone_call_events.id`), as a "Call not filed" task links to it
 * (T-B2). Null when the call is gone or belongs to another practice.
 */
export async function fetchCallByRowId(rowId: number): Promise<ClientCall | null> {
  try {
    const { data } = await http.get<ClientCall>(`/openphone/calls/row/${encodeURIComponent(String(rowId))}`);
    return data && typeof data === 'object' && data.callId ? data : null;
  } catch {
    return null;
  }
}
