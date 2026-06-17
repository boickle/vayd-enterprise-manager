import type {
  ForwardBookingCalendarIndexResponse,
  ForwardBookingEntry,
} from '../api/forwardBooking';
import type { Appointment } from '../api/roomLoader';
import {
  forwardBookingDispositionFromAppointment,
  forwardBookingDispositionIsComplete,
} from './forwardBookingDisposition';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export function appointmentHasRecordedVisitBounds(appt: Appointment): boolean {
  return Boolean(pickStr(appt.appointmentStartActual) && pickStr(appt.appointmentEndActual));
}

/** Composite key: one forward-booking list row per source visit + pet. */
export function forwardBookingVisitKey(
  sourceAppointmentId: number | string,
  patientId: number | string
): string {
  return `${sourceAppointmentId}:${patientId}`;
}

/** Sets from GET /forward-bookings/calendar-index (excludes removed rows). */
export function buildForwardBookingCalendarIndexSets(
  index: ForwardBookingCalendarIndexResponse
): { sourceAppointmentIds: Set<number>; patientIds: Set<number> } {
  return {
    sourceAppointmentIds: new Set(index.sourceAppointmentIds),
    patientIds: new Set(index.patientIds),
  };
}

/** Source visits with a forward-booking list row (any status except removed). */
export function buildForwardBookingSourceAppointmentIdSet(
  entries: Iterable<ForwardBookingEntry>
): Set<number> {
  const ids = new Set<number>();
  for (const entry of entries) {
    if (entry.status === 'removed') continue;
    const sid = entry.sourceAppointmentId;
    if (sid != null && Number.isFinite(Number(sid)) && Number(sid) > 0) {
      ids.add(Number(sid));
    }
  }
  return ids;
}

/** Source visit + pet pairs that already have a forward-booking list row (not removed). */
export function buildForwardBookingSavedVisitKeySet(
  entries: Iterable<ForwardBookingEntry>
): Set<string> {
  const keys = new Set<string>();
  for (const entry of entries) {
    if (entry.status === 'removed') continue;
    const sid = entry.sourceAppointmentId;
    const pid = entry.patientId;
    if (
      sid != null &&
      Number.isFinite(Number(sid)) &&
      Number(sid) > 0 &&
      pid != null &&
      Number.isFinite(Number(pid)) &&
      Number(pid) > 0
    ) {
      keys.add(forwardBookingVisitKey(sid, pid));
    }
  }
  return keys;
}

/** @deprecated Per-pet only — use {@link buildForwardBookingSavedVisitKeySet}. */
export function buildForwardBookingSourcePatientIdSet(
  entries: Iterable<ForwardBookingEntry>
): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry.status === 'removed') continue;
    const pid = entry.patientId;
    if (pid != null && Number.isFinite(Number(pid)) && Number(pid) > 0) {
      ids.add(String(pid));
    }
  }
  return ids;
}

export function householdVisitAlreadyForwardBooked(
  visit: { patientId: string; appointmentId: number },
  sourceAppointmentIds: ReadonlySet<number>,
  savedPatientIds: ReadonlySet<number>
): boolean {
  const pid = Number(visit.patientId);
  if (!Number.isFinite(pid) || pid <= 0) return false;
  return (
    sourceAppointmentIds.has(visit.appointmentId) && savedPatientIds.has(pid)
  );
}

/** Default forward-booking checkboxes: only visits without a saved list entry for that pet. */
export function defaultForwardBookingHouseholdSelection(
  visits: ReadonlyArray<{ patientId: string; appointmentId: number }>,
  sourceAppointmentIds: ReadonlySet<number>,
  savedPatientIds: ReadonlySet<number>
): Set<string> {
  return new Set(
    visits
      .filter(
        (visit) =>
          !householdVisitAlreadyForwardBooked(visit, sourceAppointmentIds, savedPatientIds)
      )
      .map((visit) => visit.patientId)
  );
}

/**
 * Clock badge: recorded actual start/end and a completed End Visit follow-up choice
 * (forward book, labs pending, not appropriate, already booked, etc.).
 * Legacy rows with only a forward-booking list link still qualify via `sourceIds`.
 */
export function appointmentShowsVisitTimesClock(
  appt: Appointment,
  forwardBookingSourceAppointmentIds: ReadonlySet<number>
): boolean {
  if (!appointmentHasRecordedVisitBounds(appt)) return false;
  const disposition = forwardBookingDispositionFromAppointment(appt);
  if (forwardBookingDispositionIsComplete(disposition)) return true;
  return forwardBookingSourceAppointmentIds.has(appt.id);
}
