import type { ForwardBookingEntry } from '../api/forwardBooking';
import type { Appointment } from '../api/roomLoader';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export function appointmentHasRecordedVisitBounds(appt: Appointment): boolean {
  return Boolean(pickStr(appt.appointmentStartActual) && pickStr(appt.appointmentEndActual));
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

/** Pets that already have a forward-booking list row (any status except removed). */
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
  visit: { patientId: string },
  savedPatientIds: ReadonlySet<string>
): boolean {
  return savedPatientIds.has(visit.patientId);
}

/** Default forward-booking checkboxes: only pets without a saved list entry. */
export function defaultForwardBookingHouseholdSelection(
  visits: ReadonlyArray<{ patientId: string }>,
  savedPatientIds: ReadonlySet<string>
): Set<string> {
  return new Set(
    visits.filter((visit) => !savedPatientIds.has(visit.patientId)).map((visit) => visit.patientId)
  );
}

/** Clock badge: actual start + end recorded and a forward-booking entry linked to this visit. */
export function appointmentShowsVisitTimesClock(
  appt: Appointment,
  forwardBookingSourceAppointmentIds: ReadonlySet<number>
): boolean {
  if (!appointmentHasRecordedVisitBounds(appt)) return false;
  return forwardBookingSourceAppointmentIds.has(appt.id);
}
