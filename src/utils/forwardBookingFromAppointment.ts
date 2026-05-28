import { DateTime } from 'luxon';
import type { Appointment, Client, Patient } from '../api/roomLoader';
import type { CreateForwardBookingPayload } from '../api/forwardBooking';

export const FORWARD_BOOKING_MONTHS_OPTIONS = [1, 2, 3, 4, 6, 9, 12, 18, 24] as const;

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function patientsForAppointment(a: Appointment): Patient[] {
  const multi = (a as { patients?: Patient[] }).patients;
  if (Array.isArray(multi) && multi.length > 0) return multi;
  return a.patient ? [a.patient] : [];
}

/** Build POST /forward-bookings body from the visit being ended. */
export function buildCreateForwardBookingPayloadFromAppointment(
  appt: Appointment,
  monthsOut: number,
  practiceId: number,
  opts?: { bookingNotes?: string | null }
): CreateForwardBookingPayload | null {
  if (!appt?.id || typeof appt.id !== 'number') return null;
  const c = appt.client as Client | undefined;
  if (!c?.id) return null;
  const p0 = patientsForAppointment(appt)[0];
  if (!p0?.id) return null;

  const start = DateTime.fromISO(appt.appointmentStart);
  const end = DateTime.fromISO(appt.appointmentEnd);
  const minutes =
    start.isValid && end.isValid ? Math.max(15, Math.round(end.diff(start, 'minutes').minutes)) : 45;

  const at = appt.appointmentType;
  const typeId = at?.id;
  const appointmentTypeId =
    typeId != null && Number.isFinite(Number(typeId)) ? Number(typeId) : undefined;

  const pp = appt.primaryProvider;
  const primaryProviderId =
    pp?.id != null && Number.isFinite(Number(pp.id)) ? Number(pp.id) : undefined;

  const bookingNotesRaw = opts?.bookingNotes?.trim();
  const bookingNotes = bookingNotesRaw ? bookingNotesRaw : null;

  return {
    practiceId,
    sourceAppointmentId: appt.id,
    clientId: Number(c.id),
    patientId: Number(p0.id),
    monthsOut,
    ...(appointmentTypeId != null ? { appointmentTypeId } : {}),
    ...(primaryProviderId != null ? { primaryProviderId } : {}),
    description: appt.description ?? null,
    instructions: appt.instructions ?? null,
    serviceMinutes: minutes,
    ...(bookingNotes != null ? { bookingNotes } : {}),
  };
}
