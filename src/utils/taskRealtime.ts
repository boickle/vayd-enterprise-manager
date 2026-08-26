/**
 * Task realtime: Socket.IO namespace `/tasks` on the REST API origin.
 * @see API docs — event `task.changed`, broadcast to the caller's practice room.
 * Lets nav badges and the tasks page refetch on change instead of polling on an interval.
 */
import { io, type Socket } from 'socket.io-client';
import { apiBaseUrl, getToken } from '../api/http';

export type TaskChangePayload = {
  action: 'created' | 'updated' | 'completed';
  taskId: number;
  practiceId: number;
  affectedEmployeeIds?: number[];
};

const TASK_CHANGED_EVENT = 'task.changed';

function normalizeApiOrigin(): string {
  return apiBaseUrl.replace(/\/+$/, '');
}

/**
 * Subscribe to task changes for a practice. Fires `onChange` (debounced) whenever
 * any task in the practice is created, updated, or completed by anyone, so callers
 * can refetch `/tasks` and `/tasks/summary` instead of polling on an interval.
 */
export function subscribePracticeTasks(opts: {
  practiceId: number;
  onChange: (payloads: TaskChangePayload[]) => void;
  onReconnect?: () => void;
  debounceMs?: number;
}): () => void {
  const { practiceId, onChange, onReconnect, debounceMs = 300 } = opts;

  const token = getToken();
  if (!token?.trim() || typeof window === 'undefined' || !Number.isFinite(practiceId)) {
    return () => {};
  }

  const base = normalizeApiOrigin();
  const socket: Socket = io(`${base}/tasks`, {
    auth: { token: token.trim() },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
  });

  let pending: TaskChangePayload[] = [];
  let flushTimer: number | null = null;

  const flush = () => {
    flushTimer = null;
    if (pending.length === 0) return;
    const raw = pending;
    pending = [];
    onChange(raw);
  };

  const push = (payload: TaskChangePayload) => {
    pending.push(payload);
    if (flushTimer != null) window.clearTimeout(flushTimer);
    flushTimer = window.setTimeout(flush, debounceMs);
  };

  let hasConnected = false;
  socket.on('connect', () => {
    if (hasConnected) onReconnect?.();
    hasConnected = true;
  });

  socket.on(TASK_CHANGED_EVENT, (payload: TaskChangePayload) => {
    if (!payload || typeof payload.practiceId !== 'number') return;
    if (payload.practiceId !== practiceId) return;
    push(payload);
  });

  socket.on('connect_error', (err: unknown) => {
    const msg =
      err && typeof err === 'object' && 'message' in err ? String((err as { message?: unknown }).message) : err;
    console.warn('[tasks socket] connect_error', msg);
  });

  return () => {
    if (flushTimer != null) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }
    pending = [];
    socket.removeAllListeners();
    socket.disconnect();
  };
}
