import { DateTime } from 'luxon';
import type { Appointment } from '../api/roomLoader';
import { appointmentPracticeDateKey } from './editVisitTimeFields';

/** Query param on `/schedule/scheduler` — jump to the appointment date, provider, and highlight. */
export const SCHEDULER_FOCUS_APPOINTMENT_PARAM = 'focusAppt';
/** Optional practice-local date hint (`yyyy-MM-dd`) while the appointment row loads. */
export const SCHEDULER_FOCUS_DATE_PARAM = 'focusDate';
/** Optional primary provider internal id hint while the appointment row loads. */
export const SCHEDULER_FOCUS_PROVIDER_PARAM = 'focusProvider';

export const SCHEDULER_FOCUS_SESSION_KEY = 'vayd:scheduler-focus-appt-v1';

export type SchedulerFocusAppointmentHints = {
  date?: string | null;
  providerId?: string | null;
};

export type SchedulerFocusRequest = {
  appointmentId: number;
  dateHint?: string | null;
  providerHint?: string | null;
};

export function buildSchedulerFocusAppointmentUrl(
  appointmentId: number,
  hints?: SchedulerFocusAppointmentHints
): string {
  const params = new URLSearchParams({
    [SCHEDULER_FOCUS_APPOINTMENT_PARAM]: String(appointmentId),
  });
  const date = hints?.date?.trim();
  if (date) params.set(SCHEDULER_FOCUS_DATE_PARAM, date);
  const providerId = hints?.providerId?.trim();
  if (providerId) params.set(SCHEDULER_FOCUS_PROVIDER_PARAM, providerId);
  return `/schedule/scheduler?${params.toString()}`;
}

export function writeSchedulerFocusSession(request: SchedulerFocusRequest): void {
  if (typeof sessionStorage === 'undefined') return;
  if (!Number.isFinite(request.appointmentId) || request.appointmentId <= 0) return;
  try {
    sessionStorage.setItem(
      SCHEDULER_FOCUS_SESSION_KEY,
      JSON.stringify({
        v: 1,
        appointmentId: request.appointmentId,
        dateHint: request.dateHint?.trim() || null,
        providerHint: request.providerHint?.trim() || null,
      })
    );
  } catch {
    /* quota / private mode */
  }
}

export function readSchedulerFocusSession(): SchedulerFocusRequest | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SCHEDULER_FOCUS_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      v?: number;
      appointmentId?: unknown;
      dateHint?: unknown;
      providerHint?: unknown;
    };
    if (parsed?.v !== 1) return null;
    const appointmentId = Number(parsed.appointmentId);
    if (!Number.isFinite(appointmentId) || appointmentId <= 0) return null;
    return {
      appointmentId,
      dateHint:
        typeof parsed.dateHint === 'string' && parsed.dateHint.trim()
          ? parsed.dateHint.trim()
          : null,
      providerHint:
        typeof parsed.providerHint === 'string' && parsed.providerHint.trim()
          ? parsed.providerHint.trim()
          : null,
    };
  } catch {
    return null;
  }
}

export function clearSchedulerFocusSession(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(SCHEDULER_FOCUS_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function parseSchedulerFocusFromSearch(
  search: string,
  practiceTz: string
): SchedulerFocusRequest | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const focusRaw = params.get(SCHEDULER_FOCUS_APPOINTMENT_PARAM);
  if (!focusRaw) return null;
  const appointmentId = Number(focusRaw);
  if (!Number.isFinite(appointmentId) || appointmentId <= 0) return null;

  const dateQ = params.get(SCHEDULER_FOCUS_DATE_PARAM);
  const dateHint =
    dateQ && DateTime.fromISO(dateQ, { zone: practiceTz }).isValid
      ? DateTime.fromISO(dateQ, { zone: practiceTz }).toISODate()
      : null;

  const providerHint = (params.get(SCHEDULER_FOCUS_PROVIDER_PARAM) ?? '').trim() || null;

  return { appointmentId, dateHint, providerHint };
}

/** URL params take precedence over session storage (survives Strict Mode remount after URL is cleared). */
export function readSchedulerFocusRequest(
  search: string,
  practiceTz: string
): SchedulerFocusRequest | null {
  return parseSchedulerFocusFromSearch(search, practiceTz) ?? readSchedulerFocusSession();
}

export function resolveSchedulerProviderFilterFromAppointment(
  appt: Appointment,
  providers: ReadonlyArray<{ id: number | string; pimsId?: string | number | null | undefined }>
): string {
  const nested = appt.primaryProvider;
  if (nested?.id != null) {
    const internal = String(nested.id);
    if (providers.length === 0 || providers.some((p) => String(p.id) === internal)) {
      return internal;
    }
  }
  const pims = nested?.pimsId != null ? String(nested.pimsId).trim() : '';
  if (pims) {
    const match = providers.find((p) => String(p.pimsId ?? '').trim() === pims);
    if (match) return String(match.id);
  }
  const flat = (appt as { primaryProviderId?: number | string }).primaryProviderId;
  if (flat != null) {
    const s = String(flat);
    if (providers.some((p) => String(p.id) === s)) return s;
  }
  return '';
}

export function schedulerAppointmentIdsEqual(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return false;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na > 0) return na === nb;
  const sa = String(a).trim();
  const sb = String(b).trim();
  return sa !== '' && sa === sb;
}

export function schedulerCalendarFocusFromAppointment(
  appt: Appointment,
  providers: ReadonlyArray<{ id: number | string; pimsId?: string | number | null | undefined }>,
  practiceTz: string
): { anchorDate: string; providerFilter: string; appointmentId: number } | null {
  const idRaw = appt.id;
  const id = typeof idRaw === 'number' ? idRaw : Number(idRaw);
  if (!Number.isFinite(id) || id <= 0) return null;
  const anchorDate = appointmentPracticeDateKey(appt.appointmentStart, practiceTz);
  if (!anchorDate) return null;
  return {
    anchorDate,
    providerFilter: resolveSchedulerProviderFilterFromAppointment(appt, providers),
    appointmentId: id,
  };
}
