import { isPracticeCalendarBlockAppointment, truthyApiFlag } from '../api/appointments';
import type { Appointment, Patient } from '../api/roomLoader';
import { patientsForAppointment } from './schedulerAddPet';

/**
 * Practice calendar cards should show the new-patient/new-client marker when the
 * API marks the visit (or its patient/client) as new at booking.
 *
 * Deirdre (#internal-scout): overlay on type color for **both** new client and
 * new patient — not a white fill.
 */
function recordShowsNewClientOrPatient(row: Record<string, unknown> | null | undefined): boolean {
  if (!row) return false;
  return (
    truthyApiFlag(row.isNewPatientAtBooking) ||
    truthyApiFlag(row.isNewClientAtBooking) ||
    truthyApiFlag(row.newPatientAtBooking) ||
    truthyApiFlag(row.newClientAtBooking) ||
    truthyApiFlag(row.isNewPatient) ||
    truthyApiFlag(row.isNewClient)
  );
}

/** True when this calendar appointment should get the new-patient/client card marker. */
export function appointmentShowsNewPatientCardMarker(a: Appointment): boolean {
  if (isPracticeCalendarBlockAppointment(a)) return false;

  const row = a as Appointment & Record<string, unknown>;
  if (recordShowsNewClientOrPatient(row)) return true;

  const client = row.client as Record<string, unknown> | undefined;
  if (recordShowsNewClientOrPatient(client)) return true;

  for (const p of patientsForAppointment(a)) {
    if (recordShowsNewClientOrPatient(p as Patient & Record<string, unknown>)) return true;
  }

  return false;
}
