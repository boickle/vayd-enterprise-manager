/** Quo (OpenPhone) calls matched to a client, for the chart call pill. */
import { http } from './http';

/**
 * `transcribing` is the gap between hanging up and Quo posting the transcript — usually
 * under a couple of minutes, and the state the pill has to explain so it doesn't look stuck.
 * Silent calls often never get a transcript at all; after this wait we stop claiming Quo
 * is still writing.
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
 * Recent calls for a client, newest first. Called on mount so a chart opened mid-call — or
 * opened after the transcript already landed — still shows the pill.
 */
export async function claimCallsForClient(clientId: number): Promise<{ claimed: number }> {
  const { data } = await http.post<{ claimed?: number }>('/openphone/calls/claim-for-client', {
    clientId,
  });
  return { claimed: Number(data?.claimed) || 0 };
}

/** My own unfiled calls, for the stacked dock that follows me around the app. */
export async function listMyCalls(
  opts?: { sinceMinutes?: number },
): Promise<{ calls: ClientCall[] }> {
  const { data } = await http.get<{ calls: ClientCall[] }>('/openphone/calls/mine', {
    params: opts?.sinceMinutes ? { sinceMinutes: opts.sinceMinutes } : undefined,
  });
  return { calls: Array.isArray(data?.calls) ? data.calls : [] };
}

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
