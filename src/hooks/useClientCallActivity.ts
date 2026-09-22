import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listClientCalls,
  listMyCalls,
  claimCallsForClient,
  TRANSCRIPT_WAIT_MS,
  type CallPhase,
  type ClientCall,
} from '../api/calls';
import { useAuth } from '../auth/useAuth';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import { subscribePracticeCalls, type CallChangePayload } from '../utils/callRealtime';

/**
 * How long an unconfirmed dial keeps showing "Calling…". Quo's first webhook normally lands
 * in a few seconds; past this the user most likely backed out of the dialer, and a pill that
 * never clears is worse than no pill.
 */
const OPTIMISTIC_TTL_MS = 90_000;

/** Calls older than this are not what the chart is about; the record is on the chart by then. */
const LOOKBACK_MINUTES = 240;

type OptimisticDial = {
  clientId: number;
  clientName: string | null;
  /** Pet chart the dial was started from, when known. */
  patientId: number | null;
  startedAtMs: number;
};

const OPTIMISTIC_STORAGE_KEY = 'vayd-client-call-started';
const FOLLOW_STORAGE_KEY = 'vayd-my-call-follow';
const MY_REMOTE_STORAGE_KEY = 'vayd-my-call-remote';
const FOLLOW_TTL_MS = LOOKBACK_MINUTES * 60 * 1000;

/**
 * Pressing Call hands off to the Quo app, so the tab that started the call may not be the
 * tab that renders the pill. Keeping the optimistic dial in a module-level store means the
 * patient chart and the client page agree about who is being called right now.
 *
 * sessionStorage is the backup: `openphone://` sometimes unloads this document, and a
 * memory-only map would come back empty when the chart remounts.
 */
const optimisticDials = new Map<number, OptimisticDial>();
const optimisticListeners = new Set<() => void>();

function persistOptimistic() {
  try {
    const rows = [...optimisticDials.values()].filter(
      (d) => Date.now() - d.startedAtMs < OPTIMISTIC_TTL_MS,
    );
    if (rows.length === 0) sessionStorage.removeItem(OPTIMISTIC_STORAGE_KEY);
    else sessionStorage.setItem(OPTIMISTIC_STORAGE_KEY, JSON.stringify(rows));
  } catch {
    /* private mode */
  }
}

function hydrateOptimistic() {
  try {
    const raw = sessionStorage.getItem(OPTIMISTIC_STORAGE_KEY);
    if (!raw) return;
    const rows = JSON.parse(raw) as OptimisticDial[];
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (!row || !Number.isFinite(row.clientId)) continue;
      if (Date.now() - Number(row.startedAtMs) >= OPTIMISTIC_TTL_MS) continue;
      optimisticDials.set(Number(row.clientId), {
        clientId: Number(row.clientId),
        clientName: row.clientName ?? null,
        patientId:
          row.patientId != null && Number.isFinite(Number(row.patientId))
            ? Number(row.patientId)
            : null,
        startedAtMs: Number(row.startedAtMs),
      });
    }
  } catch {
    /* ignore */
  }
}

type FollowedCall = {
  clientId: number;
  clientName: string | null;
  patientId: number | null;
  startedAtMs: number;
};

let followedCall: FollowedCall | null = null;
let myRemote: CallChangePayload | null = null;

function persistFollow() {
  try {
    if (
      !followedCall ||
      Date.now() - followedCall.startedAtMs >= FOLLOW_TTL_MS
    ) {
      sessionStorage.removeItem(FOLLOW_STORAGE_KEY);
    } else {
      sessionStorage.setItem(FOLLOW_STORAGE_KEY, JSON.stringify(followedCall));
    }
  } catch {
    /* private mode */
  }
}

function hydrateFollow() {
  try {
    const raw = sessionStorage.getItem(FOLLOW_STORAGE_KEY);
    if (!raw) return;
    const row = JSON.parse(raw) as FollowedCall;
    if (!row || !Number.isFinite(row.clientId)) return;
    if (Date.now() - Number(row.startedAtMs) >= FOLLOW_TTL_MS) return;
    followedCall = {
      clientId: Number(row.clientId),
      clientName: row.clientName ?? null,
      patientId:
        row.patientId != null && Number.isFinite(Number(row.patientId))
          ? Number(row.patientId)
          : null,
      startedAtMs: Number(row.startedAtMs),
    };
  } catch {
    /* ignore */
  }
}

function persistMyRemote() {
  try {
    if (!myRemote) sessionStorage.removeItem(MY_REMOTE_STORAGE_KEY);
    else sessionStorage.setItem(MY_REMOTE_STORAGE_KEY, JSON.stringify(myRemote));
  } catch {
    /* private mode */
  }
}

function hydrateMyRemote() {
  try {
    const raw = sessionStorage.getItem(MY_REMOTE_STORAGE_KEY);
    if (!raw) return;
    const row = JSON.parse(raw) as CallChangePayload;
    if (!row || typeof row.callId !== 'string') return;
    const dir = String(row.direction ?? '').toLowerCase();
    const inbound = dir === 'incoming' || dir === 'inbound';
    // Stale "Incoming…" peeks from before we ignored ring-only attribution.
    if (inbound && row.phase === 'ringing') {
      sessionStorage.removeItem(MY_REMOTE_STORAGE_KEY);
      return;
    }
    myRemote = row;
  } catch {
    /* ignore */
  }
}

function notifyOptimistic() {
  persistOptimistic();
  persistFollow();
  optimisticListeners.forEach((fn) => fn());
}

function rememberFollow(
  clientId: number,
  clientName?: string | null,
  patientId?: number | null,
) {
  followedCall = {
    clientId,
    clientName: clientName?.trim() || followedCall?.clientName || null,
    patientId:
      patientId != null && Number.isFinite(patientId)
        ? patientId
        : followedCall?.patientId ?? null,
    startedAtMs: Date.now(),
  };
  persistFollow();
}

/** Drop the follow-along once the transcript is filed or waved off. */
export function clearFollowedCall(): void {
  followedCall = null;
  myRemote = null;
  persistFollow();
  persistMyRemote();
  optimisticListeners.forEach((fn) => fn());
}

/** Call when the user clicks a dial link, so the pill appears before Quo says anything. */
export function markClientCallStarted(
  clientId: number | null | undefined,
  clientName?: string | null,
  patientId?: number | null,
): void {
  if (clientId == null || !Number.isFinite(clientId)) return;
  const pid =
    patientId != null && Number.isFinite(Number(patientId)) ? Number(patientId) : null;
  rememberFollow(Number(clientId), clientName, pid);
  optimisticDials.set(Number(clientId), {
    clientId: Number(clientId),
    clientName: clientName?.trim() || null,
    patientId: pid,
    startedAtMs: Date.now(),
  });
  notifyOptimistic();
  // Quo may not map this dial to our employee id; claim matching unfiled rows on this line.
  void claimCallsForClient(Number(clientId)).catch(() => undefined);
}

export function clearClientCallStarted(clientId: number | null | undefined): void {
  if (clientId == null) return;
  if (optimisticDials.delete(Number(clientId))) notifyOptimistic();
}

hydrateOptimistic();
hydrateFollow();
hydrateMyRemote();

export type MyActiveCall = {
  clientId: number | null;
  clientName: string | null;
  phase: CallPhase;
  elapsedSeconds: number;
  /** Null while the dial is still optimistic and Quo has not named the call yet. */
  callId: string | null;
};

/**
 * The call *I* am on, wherever I am in Scout.
 *
 * Deliberately not every call in the practice: a busy front desk would put a permanent
 * ticker in the nav that everyone learns to ignore. A call counts as mine when I started
 * the dial in this tab, or when Quo attributes it to my employee record.
 */
export function useMyActiveCall(): MyActiveCall | null {
  const { token, employeeId } = useAuth();
  const myEmployeeId = employeeId != null ? Number(employeeId) : null;

  const [remote, setRemote] = useState<CallChangePayload | null>(() => myRemote);
  const [, setOptimisticTick] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const onChange = () => setOptimisticTick((n) => n + 1);
    optimisticListeners.add(onChange);
    return () => {
      optimisticListeners.delete(onChange);
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    const practiceId = resolvePracticeIdFromToken(token);
    return subscribePracticeCalls({
      practiceId,
      onChange: (payload) => {
        const mine =
          myEmployeeId != null &&
          (payload.initiatedByEmployeeId === myEmployeeId ||
            payload.answeredByEmployeeId === myEmployeeId);
        if (!mine) return;
        const dir = String(payload.direction ?? '').toLowerCase();
        const inbound = dir === 'incoming' || dir === 'inbound';
        // Wait for call.answered — ringing is practice-wide, not "my" call yet.
        if (inbound && payload.phase === 'ringing') return;
        if (payload.clientId != null) clearClientCallStarted(payload.clientId);
        setRemote((prev) => {
          // Keep following through hang-up and transcript. Booking an appointment leaves
          // the chart, and the dock is the only thing that still has the summary.
          const next =
            payload.phase === 'ended' && !payload.hasTranscript
              ? prev?.callId === payload.callId
                ? null
                : prev
              : payload;
          myRemote = next;
          persistMyRemote();
          return next;
        });
      },
    });
  }, [token, myEmployeeId]);

  // Whatever I dialed most recently in this tab, while it is still unconfirmed.
  let optimistic: OptimisticDial | null = null;
  for (const dial of optimisticDials.values()) {
    if (nowMs - dial.startedAtMs >= OPTIMISTIC_TTL_MS) continue;
    if (!optimistic || dial.startedAtMs > optimistic.startedAtMs) optimistic = dial;
  }

  const ticking = remote != null || optimistic != null;
  useEffect(() => {
    if (!ticking) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ticking]);

  if (remote) {
    const startedMs = Date.parse(remote.answeredAt ?? remote.startedAt ?? '') || 0;
    return {
      clientId: optimistic?.clientId ?? followedCall?.clientId ?? remote.clientId,
      clientName: optimistic?.clientName ?? followedCall?.clientName ?? null,
      phase: remote.phase,
      elapsedSeconds: startedMs > 0 ? Math.max(0, Math.floor((nowMs - startedMs) / 1000)) : 0,
      callId: remote.callId,
    };
  }

  if (optimistic) {
    return {
      clientId: optimistic.clientId,
      clientName: optimistic.clientName,
      phase: 'ringing',
      elapsedSeconds: Math.max(0, Math.floor((nowMs - optimistic.startedAtMs) / 1000)),
      callId: null,
    };
  }

  return null;
}

export type ClientCallActivity = {
  /** The call worth showing — live if there is one, else the newest with a transcript to file. */
  call: ClientCall | null;
  phase: CallPhase | null;
  /** True while we are showing an unconfirmed dial rather than something Quo told us about. */
  optimistic: boolean;
  /** Seconds since the call connected, for the on-call timer. */
  elapsedSeconds: number;
  dismiss: () => void;
  refresh: () => void;
};

function isLive(phase: CallPhase): boolean {
  return phase === 'ringing' || phase === 'active';
}

/**
 * Quo often never posts a transcript for silent / empty calls. After the wait, treat
 * "still summarizing" as nothing to file so the dock does not hang.
 */
export function effectiveCallPhase(
  call: {
    phase: CallPhase;
    optimistic?: boolean;
    call?: Pick<ClientCall, 'completedAt' | 'transcriptText'> | null;
  },
  nowMs: number = Date.now(),
): CallPhase {
  if (call.optimistic) return call.phase;
  if (call.phase !== 'transcribing') return call.phase;
  if (call.call?.transcriptText?.trim()) return call.phase;
  const completedMs = Date.parse(call.call?.completedAt ?? '') || 0;
  if (completedMs > 0 && nowMs - completedMs >= TRANSCRIPT_WAIT_MS) {
    return 'no_record_needed';
  }
  return 'transcribing';
}

/** Live first, then whichever has something to file, then newest. */
function rank(call: ClientCall): number {
  if (isLive(call.phase)) return 3;
  if (call.phase === 'transcript_ready') return 2;
  if (call.phase === 'transcribing') return 1;
  if (call.phase === 'no_record_needed') return 1;
  return 0;
}

/**
 * A scheduling call gets a moment on screen so nobody wonders where their call went, then
 * takes itself away. Long enough to read, short enough not to be clutter.
 */
const NO_RECORD_RETIRE_MS = 12_000;

function pickCall(calls: ClientCall[]): ClientCall | null {
  let best: ClientCall | null = null;
  for (const c of calls) {
    if (!best) {
      best = c;
      continue;
    }
    const diff = rank(c) - rank(best);
    if (diff > 0) {
      best = c;
    } else if (diff === 0) {
      const a = Date.parse(c.startedAt ?? '') || 0;
      const b = Date.parse(best.startedAt ?? '') || 0;
      if (a > b) best = c;
    }
  }
  return best;
}

/**
 * Everything the call pill needs for one client: an in-progress call, the wait while Quo
 * transcribes, and the finished transcript waiting to be filed.
 */
export function useClientCallActivity(clientId: number | null): ClientCallActivity {
  const { token } = useAuth();
  const [calls, setCalls] = useState<ClientCall[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [optimisticTick, setOptimisticTick] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const callsRef = useRef<ClientCall[]>([]);
  /**
   * Phone numbers on this client record. A call resolves to exactly one client id, but
   * households share a line and imports leave duplicate records behind, so the id on the
   * event is often a sibling of the record being viewed. The phone is what actually ties
   * the call to this chart.
   */
  const phoneKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    callsRef.current = calls;
  }, [calls]);

  // A new client means the previous client's calls and dismissals are irrelevant.
  useEffect(() => {
    setCalls([]);
    setDismissed(new Set());
    phoneKeysRef.current = new Set();
  }, [clientId]);

  const refresh = useCallback(() => {
    if (clientId == null || !Number.isFinite(clientId)) return;
    void listClientCalls(clientId, { sinceMinutes: LOOKBACK_MINUTES })
      .then(({ calls: rows, phoneKeys }) => {
        phoneKeysRef.current = new Set(phoneKeys);
        setCalls(rows);
      })
      .catch(() => undefined);
  }, [clientId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onChange = () => setOptimisticTick((n) => n + 1);
    optimisticListeners.add(onChange);
    return () => {
      optimisticListeners.delete(onChange);
    };
  }, []);

  useEffect(() => {
    if (clientId == null || !token) return;
    const practiceId = resolvePracticeIdFromToken(token);
    return subscribePracticeCalls({
      practiceId,
      onChange: (payload: CallChangePayload) => {
        const sameClient = payload.clientId === clientId;
        const sameNumber =
          payload.counterpartyPhone != null &&
          phoneKeysRef.current.has(payload.counterpartyPhone);
        if (!sameClient && !sameNumber) return;
        // Quo has taken over from the optimistic dial, so stop guessing.
        clearClientCallStarted(clientId);
        setCalls((prev) => {
          const next = prev.filter((c) => c.callId !== payload.callId);
          const existing = prev.find((c) => c.callId === payload.callId);
          next.push({
            ...payload,
            // The socket carries state, never transcript text — that comes from the fetch.
            transcriptText: existing?.transcriptText ?? null,
            filedAt: existing?.filedAt ?? null,
            dismissedAt: existing?.dismissedAt ?? null,
          });
          return next;
        });
        // The transcript body itself is only on the REST row.
        if (payload.hasTranscript) refresh();
      },
      onReconnect: refresh,
    });
  }, [clientId, token, refresh]);

  const optimistic = clientId != null ? optimisticDials.get(clientId) : undefined;
  const optimisticFresh =
    !!optimistic && nowMs - optimistic.startedAtMs < OPTIMISTIC_TTL_MS;
  void optimisticTick;

  const live = calls.filter(
    (c) => !dismissed.has(c.callId) && !c.filedAt && !c.dismissedAt,
  );
  const picked = pickCall(live);
  const showOptimistic = optimisticFresh && (!picked || !isLive(picked.phase));

  // Only tick while something is counting; no reason to re-render an idle chart every second.
  const ticking = showOptimistic || (picked != null && isLive(picked.phase));
  useEffect(() => {
    if (!ticking) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ticking]);

  const dismiss = useCallback(() => {
    if (clientId != null) clearClientCallStarted(clientId);
    clearFollowedCall();
    const current = pickCall(callsRef.current);
    if (current) {
      setDismissed((prev) => new Set(prev).add(current.callId));
    }
  }, [clientId]);

  // An admin call retires itself rather than waiting to be swatted away.
  const retiringCallId =
    picked?.phase === 'no_record_needed' ? picked.callId : null;
  useEffect(() => {
    if (!retiringCallId) return;
    const id = window.setTimeout(
      () => setDismissed((prev) => new Set(prev).add(retiringCallId)),
      NO_RECORD_RETIRE_MS,
    );
    return () => window.clearTimeout(id);
  }, [retiringCallId]);

  if (showOptimistic && optimistic) {
    return {
      call: null,
      phase: 'ringing',
      optimistic: true,
      elapsedSeconds: Math.max(0, Math.floor((nowMs - optimistic.startedAtMs) / 1000)),
      dismiss,
      refresh,
    };
  }

  const startedMs = picked
    ? Date.parse(picked.answeredAt ?? picked.startedAt ?? '') || 0
    : 0;

  return {
    call: picked,
    phase: picked?.phase ?? null,
    optimistic: false,
    elapsedSeconds:
      picked && isLive(picked.phase) && startedMs > 0
        ? Math.max(0, Math.floor((nowMs - startedMs) / 1000))
        : (picked?.durationSeconds ?? 0),
    dismiss,
    refresh,
  };
}

export type StackedCall = {
  key: string;
  callId: string | null;
  clientId: number | null;
  clientName: string | null;
  /** Pet the dial started from, when the chart passed one. */
  patientId: number | null;
  phase: CallPhase;
  elapsedSeconds: number;
  call: ClientCall | null;
  optimistic: boolean;
};

function stackRank(c: StackedCall, nowMs: number): number {
  const phase = effectiveCallPhase(c, nowMs);
  if (c.optimistic || phase === 'ringing' || phase === 'active') return 4;
  if (phase === 'transcribing') return 3;
  if (phase === 'transcript_ready') return 2;
  if (phase === 'no_record_needed') return 1;
  return 0;
}

/**
 * Every call I still owe a look — live plus ones waiting to be filed.
 *
 * One list, not one "current" call, so two callbacks in a row can sit in a stack
 * while I walk around the rest of Scout.
 */
export function useMyCallStack(): {
  calls: StackedCall[];
  dismiss: (key: string) => void;
  refresh: () => void;
} {
  const { token, employeeId } = useAuth();
  const myEmployeeId = employeeId != null ? Number(employeeId) : null;
  const [rows, setRows] = useState<ClientCall[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [optimisticTick, setOptimisticTick] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const refresh = useCallback(() => {
    const followedIds = new Set<number>();
    if (followedCall?.clientId) followedIds.add(followedCall.clientId);
    for (const dial of optimisticDials.values()) followedIds.add(dial.clientId);

    void Promise.all([
      listMyCalls({ sinceMinutes: LOOKBACK_MINUTES }),
      ...[...followedIds].map((id) =>
        listClientCalls(id, { sinceMinutes: LOOKBACK_MINUTES }).catch(() => ({
          calls: [] as ClientCall[],
          phoneKeys: [] as string[],
        })),
      ),
    ])
      .then((results) => {
        const byId = new Map<string, ClientCall>();
        for (const result of results) {
          const calls = 'calls' in result ? result.calls : [];
          for (const c of calls) {
            if (!c?.callId || c.filedAt || c.dismissedAt || c.phase === 'ended') continue;
            const existing = byId.get(c.callId);
            // Prefer the row that already carries a transcript body.
            if (!existing || (!existing.transcriptText && c.transcriptText)) {
              byId.set(c.callId, {
                ...c,
                clientName:
                  c.clientName ??
                  (followedCall?.clientId === c.clientId ? followedCall.clientName : null) ??
                  existing?.clientName ??
                  null,
              });
            }
          }
        }
        setRows([...byId.values()]);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onChange = () => setOptimisticTick((n) => n + 1);
    optimisticListeners.add(onChange);
    return () => {
      optimisticListeners.delete(onChange);
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    const practiceId = resolvePracticeIdFromToken(token);
    return subscribePracticeCalls({
      practiceId,
      onChange: (payload) => {
        const mine =
          myEmployeeId != null &&
          (payload.initiatedByEmployeeId === myEmployeeId ||
            payload.answeredByEmployeeId === myEmployeeId);
        if (!mine) return;
        const dir = String(payload.direction ?? '').toLowerCase();
        const inbound = dir === 'incoming' || dir === 'inbound';
        if (inbound && payload.phase === 'ringing') return;
        if (payload.clientId != null) clearClientCallStarted(payload.clientId);
        if (payload.phase === 'ended' && !payload.hasTranscript) {
          setRows((prev) => prev.filter((c) => c.callId !== payload.callId));
          return;
        }
        setRows((prev) => {
          const existing = prev.find((c) => c.callId === payload.callId);
          const next = prev.filter((c) => c.callId !== payload.callId);
          next.push({
            ...payload,
            transcriptText: existing?.transcriptText ?? null,
            filedAt: existing?.filedAt ?? null,
            dismissedAt: existing?.dismissedAt ?? null,
            clientName: existing?.clientName ?? null,
          });
          return next;
        });
        if (payload.hasTranscript) refresh();
      },
      onReconnect: refresh,
    });
  }, [token, myEmployeeId, refresh]);

  // Re-render when an optimistic dial is marked started from another chart.
  void optimisticTick;

  const stacked = useMemo(() => {
    const next: StackedCall[] = [];
    const seenClients = new Set<number>();
    const patientForClient = (clientId: number | null): number | null => {
      if (clientId == null) return null;
      const dial = optimisticDials.get(clientId);
      if (dial?.patientId != null) return dial.patientId;
      if (followedCall?.clientId === clientId) return followedCall.patientId;
      return null;
    };

    for (const row of rows) {
      if (hidden.has(row.callId) || row.filedAt || row.dismissedAt) continue;
      if (row.phase === 'ended' && !row.transcriptText) continue;
      // Inbound rings are practice-wide until someone answers — only the answerer
      // (or the person who dialed out) should see a personal dock card.
      const dir = String(row.direction ?? '').toLowerCase();
      const inbound = dir === 'incoming' || dir === 'inbound';
      if (inbound && row.phase === 'ringing') continue;
      if (
        inbound &&
        row.phase === 'active' &&
        row.answeredByEmployeeId == null
      ) {
        continue;
      }
      const startedMs = Date.parse(row.answeredAt ?? row.startedAt ?? '') || 0;
      next.push({
        key: row.callId,
        callId: row.callId,
        clientId: row.clientId,
        clientName:
          row.clientName ??
          (followedCall?.clientId === row.clientId ? followedCall.clientName : null),
        patientId: patientForClient(row.clientId),
        phase: row.phase,
        elapsedSeconds:
          isLive(row.phase) && startedMs > 0
            ? Math.max(0, Math.floor((nowMs - startedMs) / 1000))
            : (row.durationSeconds ?? 0),
        call: row,
        optimistic: false,
      });
      if (row.clientId != null) seenClients.add(row.clientId);
    }

    for (const dial of optimisticDials.values()) {
      if (nowMs - dial.startedAtMs >= OPTIMISTIC_TTL_MS) continue;
      if (seenClients.has(dial.clientId)) continue;
      next.push({
        key: `optimistic:${dial.clientId}`,
        callId: null,
        clientId: dial.clientId,
        clientName: dial.clientName,
        patientId: dial.patientId,
        phase: 'ringing',
        elapsedSeconds: Math.max(0, Math.floor((nowMs - dial.startedAtMs) / 1000)),
        call: null,
        optimistic: true,
      });
    }

    next.sort((a, b) => {
      const diff = stackRank(b, nowMs) - stackRank(a, nowMs);
      if (diff !== 0) return diff;
      return (b.call?.startedAt ?? '').localeCompare(a.call?.startedAt ?? '');
    });
    return next;
  }, [rows, hidden, nowMs, optimisticTick]);

  const ticking = stacked.some(
    (c) =>
      c.optimistic ||
      isLive(c.phase) ||
      // Keep the clock running while we wait to give up on a missing transcript.
      (c.phase === 'transcribing' && !c.call?.transcriptText?.trim()),
  );
  useEffect(() => {
    if (!ticking) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ticking]);

  const dismiss = useCallback((key: string) => {
    setHidden((prev) => new Set(prev).add(key));
    if (key.startsWith('optimistic:')) {
      const id = Number(key.slice('optimistic:'.length));
      if (Number.isFinite(id)) clearClientCallStarted(id);
    } else {
      const row = rows.find((c) => c.callId === key);
      if (row?.clientId != null) clearClientCallStarted(row.clientId);
    }
    setRows((prev) => prev.filter((c) => c.callId !== key && `optimistic:${c.clientId}` !== key));
  }, [rows]);

  return { calls: stacked, dismiss, refresh };
}
