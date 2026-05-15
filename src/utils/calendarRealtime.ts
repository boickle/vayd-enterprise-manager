/**
 * Practice calendar realtime: Socket.IO namespace `/calendar` on the REST API origin.
 * @see API docs — event `appointment.calendar`, emit `calendar.joinPractice` / `calendar.leavePractice`.
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

const APPOINTMENT_CALENDAR_EVENT = 'appointment.calendar';

function normalizeApiOrigin(): string {
  return apiBaseUrl.replace(/\/+$/, '');
}

/**
 * Subscribe to appointment changes for the visible practice. Ensures the socket joins
 * `practice:{practiceId}` for this UI (e.g. admin viewing env practice).
 *
 * @param visibleProviderId — internal provider id string when the calendar is filtered to one doctor; empty refetches for any provider on that practice.
 * @param debounceMs — coalesce bursts (imports, bulk edits).
 * @param onBatch — receives dedupe window batch (last event per appointment id wins).
 */
export function subscribePracticeCalendar(opts: {
  practiceId: number;
  visibleProviderId: string;
  onBatch: (payloads: AppointmentCalendarPayload[]) => void;
  debounceMs?: number;
}): () => void {
  const { practiceId, visibleProviderId, onBatch, debounceMs = 300 } = opts;

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

  let pending: AppointmentCalendarPayload[] = [];
  let flushTimer: number | null = null;

  const flush = () => {
    flushTimer = null;
    if (pending.length === 0) return;
    const raw = pending;
    pending = [];
    const byId = new Map<number, AppointmentCalendarPayload>();
    for (const p of raw) {
      byId.set(p.appointmentId, p);
    }
    onBatch([...byId.values()]);
  };

  const scheduleFlush = () => {
    if (flushTimer != null) window.clearTimeout(flushTimer);
    flushTimer = window.setTimeout(flush, debounceMs);
  };

  const joinPractice = () => {
    socket.emit('calendar.joinPractice', { practiceId }, (ack: { ok: boolean; error?: string } | undefined) => {
      if (ack && ack.ok === false) {
        console.warn('[calendar socket] calendar.joinPractice failed', ack.error);
      }
    });
  };

  socket.on('connect', joinPractice);

  socket.on(APPOINTMENT_CALENDAR_EVENT, (payload: AppointmentCalendarPayload) => {
    if (!payload || typeof payload.practiceId !== 'number') return;
    if (payload.practiceId !== practiceId) return;

    const vid = visibleProviderId.trim();
    if (vid && payload.primaryProviderId != null) {
      if (String(payload.primaryProviderId) !== vid) return;
    }

    pending.push(payload);
    scheduleFlush();
  });

  socket.on('connect_error', (err) => {
    console.warn('[calendar socket] connect_error', err?.message ?? err);
  });

  return () => {
    if (flushTimer != null) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }
    pending = [];
    try {
      socket.emit('calendar.leavePractice', { practiceId });
    } catch {
      /* ignore */
    }
    socket.removeAllListeners();
    socket.disconnect();
  };
}
