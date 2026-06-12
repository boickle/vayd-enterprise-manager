import type { Appointment } from '../api/roomLoader';
import { appointmentPracticeDateKey } from './editVisitTimeFields';

/** Query param on `/schedule/scheduler` — jump to the appointment date, provider, and highlight. */
export const SCHEDULER_FOCUS_APPOINTMENT_PARAM = 'focusAppt';
/** Optional practice-local date hint (`yyyy-MM-dd`) while the appointment row loads. */
export const SCHEDULER_FOCUS_DATE_PARAM = 'focusDate';
/** Optional primary provider internal id hint while the appointment row loads. */
export const SCHEDULER_FOCUS_PROVIDER_PARAM = 'focusProvider';

export type SchedulerFocusAppointmentHints = {
  date?: string | null;
  providerId?: string | null;
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
