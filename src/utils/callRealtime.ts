/**
 * Call realtime: Socket.IO namespace `/calls` on the REST API origin.
 * Event `call.changed`, broadcast to the caller's practice room on every Quo call webhook.
 *
 * Charts need this rather than polling because the useful window is short: the pill has to
 * turn over from ringing to on-call to transcript-ready while someone is still looking at it.
 */
import { io, type Socket } from 'socket.io-client';
import { apiBaseUrl, getToken } from '../api/http';
import type { CallPhase } from '../api/calls';

export type CallChangePayload = {
  callId: string;
  practiceId: number;
  clientId: number | null;
  phase: CallPhase;
  direction: string | null;
  counterpartyPhone: string | null;
  startedAt: string | null;
  answeredAt: string | null;
  completedAt: string | null;
  durationSeconds: number | null;
  hasTranscript: boolean;
  triageReason: string | null;
  triageCategory: string | null;
  initiatedByEmployeeId: number | null;
  answeredByEmployeeId: number | null;
};

const CALL_CHANGED_EVENT = 'call.changed';

function normalizeApiOrigin(): string {
  return apiBaseUrl.replace(/\/+$/, '');
}

/**
 * Subscribe to call changes for a practice. Unlike tasks these are not debounced — a call
 * moving from ringing to answered is two events a second apart and both should render.
 */
export function subscribePracticeCalls(opts: {
  practiceId: number;
  onChange: (payload: CallChangePayload) => void;
  onReconnect?: () => void;
}): () => void {
  const { practiceId, onChange, onReconnect } = opts;

  const token = getToken();
  if (!token?.trim() || typeof window === 'undefined' || !Number.isFinite(practiceId)) {
    return () => {};
  }

  const base = normalizeApiOrigin();
  const socket: Socket = io(`${base}/calls`, {
    auth: { token: token.trim() },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
  });

  let hasConnected = false;
  socket.on('connect', () => {
    // A dropped socket can hide a whole call, so callers refetch on reconnect.
    if (hasConnected) onReconnect?.();
    hasConnected = true;
  });

  socket.on(CALL_CHANGED_EVENT, (payload: CallChangePayload) => {
    if (!payload || typeof payload.callId !== 'string') return;
    if (payload.practiceId !== practiceId) return;
    onChange(payload);
  });

  socket.on('connect_error', (err: unknown) => {
    const msg =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message?: unknown }).message)
        : err;
    console.warn('[calls socket] connect_error', msg);
  });

  return () => {
    socket.removeAllListeners();
    socket.disconnect();
  };
}
