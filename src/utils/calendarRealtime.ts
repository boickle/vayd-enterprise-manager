/**
 * Practice calendar realtime: Socket.IO namespace `/calendar` on the REST API origin.
 * @see API docs — events `appointment.calendar`, `appointment.request-submission`;
 * emit `calendar.joinPractice` / `calendar.leavePractice`.
 */
import { io, type Socket } from 'socket.io-client';
import { apiBaseUrl, getToken } from '../api/http';

export type AppointmentCalendarPayload = {
  action: 'created' | 'updated' | 'deleted';
  appointmentId: number;
  practiceId: number;
  appointmentStart?: string | null;
  appointmentEnd?: string | null;
  primaryProviderId?: number | null;
};

export type AppointmentRequestSubmissionPayload = {
  action: 'created' | 'updated';
  submissionId: number;
  practiceId: number;
  bookedAppointmentId?: number | null;
};

const APPOINTMENT_CALENDAR_EVENT = 'appointment.calendar';
const APPOINTMENT_REQUEST_SUBMISSION_EVENT = 'appointment.request-submission';

function normalizeApiOrigin(): string {
  return apiBaseUrl.replace(/\/+$/, '');
}

type DebouncedBatchOpts<T> = {
  debounceMs: number;
  onBatch: (payloads: T[]) => void;
};

function createDebouncedBatchHandler<T>(opts: DebouncedBatchOpts<T>) {
  let pending: T[] = [];
  let flushTimer: number | null = null;

  const flush = () => {
    flushTimer = null;
    if (pending.length === 0) return;
    const raw = pending;
    pending = [];
    opts.onBatch(raw);
  };

  const push = (payload: T) => {
    pending.push(payload);
    if (flushTimer != null) window.clearTimeout(flushTimer);
    flushTimer = window.setTimeout(flush, opts.debounceMs);
  };

  const dispose = () => {
    if (flushTimer != null) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }
    pending = [];
  };

  return { push, dispose };
}

/**
 * Subscribe to appointment + appointment-request changes for the visible practice.
 *
 * @param visibleProviderId — internal provider id when scoped to one doctor; empty = entire practice.
 * @param debounceMs — coalesce bursts (imports, bulk edits).
 */
export function subscribePracticeCalendar(opts: {
  practiceId: number;
  visibleProviderId: string;
  onBatch: (payloads: AppointmentCalendarPayload[]) => void;
  onRequestSubmissionBatch?: (payloads: AppointmentRequestSubmissionPayload[]) => void;
  onReconnect?: () => void;
  debounceMs?: number;
}): () => void {
  const {
    practiceId,
    visibleProviderId,
    onBatch,
    onRequestSubmissionBatch,
    onReconnect,
    debounceMs = 300,
  } = opts;

  const token = getToken();
  if (!token?.trim() || typeof window === 'undefined') {
    return () => {};
  }

  const base = normalizeApiOrigin();
  const socket: Socket = io(`${base}/calendar`, {
    auth: { token: token.trim() },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
  });

  const calendarBatch = createDebouncedBatchHandler<AppointmentCalendarPayload>({
    debounceMs,
    onBatch: (raw) => {
      const byId = new Map<number, AppointmentCalendarPayload>();
      for (const p of raw) byId.set(p.appointmentId, p);
      onBatch([...byId.values()]);
    },
  });

  const submissionBatch = createDebouncedBatchHandler<AppointmentRequestSubmissionPayload>({
    debounceMs,
    onBatch: (raw) => {
      if (!onRequestSubmissionBatch) return;
      const byId = new Map<number, AppointmentRequestSubmissionPayload>();
      for (const p of raw) byId.set(p.submissionId, p);
      onRequestSubmissionBatch([...byId.values()]);
    },
  });

  const joinPractice = () => {
    socket.emit('calendar.joinPractice', { practiceId }, (ack: { ok: boolean; error?: string } | undefined) => {
      if (ack && ack.ok === false) {
        console.warn('[calendar socket] calendar.joinPractice failed', ack.error);
      }
    });
  };

  let hasConnected = false;
  socket.on('connect', () => {
    joinPractice();
    if (hasConnected) onReconnect?.();
    hasConnected = true;
  });

  socket.on(APPOINTMENT_CALENDAR_EVENT, (payload: AppointmentCalendarPayload) => {
    if (!payload || typeof payload.practiceId !== 'number') return;
    if (payload.practiceId !== practiceId) return;

    const vid = visibleProviderId.trim();
    if (vid && payload.primaryProviderId != null) {
      if (String(payload.primaryProviderId) !== vid) return;
    }

    calendarBatch.push(payload);
  });

  socket.on(APPOINTMENT_REQUEST_SUBMISSION_EVENT, (payload: AppointmentRequestSubmissionPayload) => {
    if (!payload || typeof payload.practiceId !== 'number') return;
    if (payload.practiceId !== practiceId) return;
    if (!onRequestSubmissionBatch) return;
    submissionBatch.push(payload);
  });

  socket.on('connect_error', (err: unknown) => {
    const msg =
      err && typeof err === 'object' && 'message' in err ? String((err as { message?: unknown }).message) : err;
    console.warn('[calendar socket] connect_error', msg);
  });

  return () => {
    calendarBatch.dispose();
    submissionBatch.dispose();
    try {
      socket.emit('calendar.leavePractice', { practiceId });
    } catch {
      /* ignore */
    }
    socket.removeAllListeners();
    socket.disconnect();
  };
}
