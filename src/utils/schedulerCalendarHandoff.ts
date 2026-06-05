/**
 * Practice calendar date/view handoff — keeps the week in sync when opening
 * `/schedule/routing` from the practice calendar (separate Scheduler instances).
 */
import { DateTime } from 'luxon';

export const SCHEDULER_CALENDAR_HANDOFF_KEY = 'vayd:scheduler-calendar-handoff-v1';

/** Fired when "+ Appointment" should apply the calendar's primary provider to Routing. */
export const SCHEDULER_HANDOFF_ROUTING_DOCTOR_EVENT = 'vayd:scheduler-handoff-routing-doctor';

export type SchedulerCalendarView = 'day' | 'week' | 'month';

export type SchedulerCalendarHandoffV1 = {
  version: 1;
  anchorDate: string;
  view?: SchedulerCalendarView;
  /** Primary provider internal employee id. */
  providerFilter?: string;
  /** PIMS id for Routing `form.doctorId`. */
  routingDoctorPimsId?: string;
  routingDoctorLabel?: string;
  /** Set by "+ Appointment" — Routing applies doctor then clears. */
  preferRoutingDoctor?: boolean;
};

function isValidPracticeDate(iso: string): boolean {
  return DateTime.fromISO(iso).isValid;
}

export function readSchedulerCalendarHandoff(): SchedulerCalendarHandoffV1 | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SCHEDULER_CALENDAR_HANDOFF_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<SchedulerCalendarHandoffV1>;
    if (p?.version !== 1) return null;
    const anchorDate = String(p.anchorDate ?? '').trim();
    if (!anchorDate || !isValidPracticeDate(anchorDate)) return null;
    const view =
      p.view === 'day' || p.view === 'week' || p.view === 'month' ? p.view : undefined;
    const providerFilter =
      typeof p.providerFilter === 'string' ? p.providerFilter.trim() : undefined;
    const routingDoctorPimsId =
      typeof p.routingDoctorPimsId === 'string' ? p.routingDoctorPimsId.trim() : undefined;
    const routingDoctorLabel =
      typeof p.routingDoctorLabel === 'string' ? p.routingDoctorLabel.trim() : undefined;
    return {
      version: 1,
      anchorDate,
      view,
      providerFilter,
      routingDoctorPimsId,
      routingDoctorLabel,
      preferRoutingDoctor: p.preferRoutingDoctor === true,
    };
  } catch {
    return null;
  }
}

export function writeSchedulerCalendarHandoff(patch: {
  anchorDate: string;
  view: SchedulerCalendarView;
  providerFilter: string;
  routingDoctorPimsId?: string;
  routingDoctorLabel?: string;
}): void {
  if (typeof sessionStorage === 'undefined') return;
  const anchorDate = patch.anchorDate.trim();
  if (!anchorDate || !isValidPracticeDate(anchorDate)) return;
  const existing = readSchedulerCalendarHandoff();
  try {
    const payload: SchedulerCalendarHandoffV1 = {
      version: 1,
      anchorDate,
      view: patch.view,
      providerFilter: patch.providerFilter.trim() || undefined,
      routingDoctorPimsId: patch.routingDoctorPimsId?.trim() || undefined,
      routingDoctorLabel: patch.routingDoctorLabel?.trim() || undefined,
      preferRoutingDoctor: existing?.preferRoutingDoctor,
    };
    sessionStorage.setItem(SCHEDULER_CALENDAR_HANDOFF_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

/** Call before navigating to `/schedule/routing` from the practice calendar. */
export function markSchedulerHandoffPreferRoutingDoctor(): void {
  if (typeof sessionStorage === 'undefined') return;
  const existing = readSchedulerCalendarHandoff();
  if (!existing) return;
  try {
    sessionStorage.setItem(
      SCHEDULER_CALENDAR_HANDOFF_KEY,
      JSON.stringify({ ...existing, preferRoutingDoctor: true })
    );
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SCHEDULER_HANDOFF_ROUTING_DOCTOR_EVENT));
  }
}

export function clearSchedulerHandoffPreferRoutingDoctor(): void {
  if (typeof sessionStorage === 'undefined') return;
  const existing = readSchedulerCalendarHandoff();
  if (!existing?.preferRoutingDoctor) return;
  try {
    const { preferRoutingDoctor: _drop, ...rest } = existing;
    sessionStorage.setItem(SCHEDULER_CALENDAR_HANDOFF_KEY, JSON.stringify(rest));
  } catch {
    /* ignore */
  }
}
