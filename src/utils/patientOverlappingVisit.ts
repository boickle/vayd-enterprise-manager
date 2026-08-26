import { DateTime } from 'luxon';
import { isAppointmentCancelledOnPracticeCalendar } from '../api/appointments';
import type { Appointment } from '../api/roomLoader';
import { patientsForAppointment } from './schedulerAddPet';

function isVisibleActiveAppt(a: Appointment): boolean {
  if (a.isDeleted === true) return false;
  if (a.isActive === false) return false;
  if (a.allDay) return false;
  if (isAppointmentCancelledOnPracticeCalendar(a)) return false;
  return Boolean(a.appointmentStart?.trim() && a.appointmentEnd?.trim());
}

/**
 * True when this patient already has a visible (non-cancelled) visit overlapping [startIso, endIso).
 * Used to stop co-visit add-pet / manual book from creating duplicate Templeton rows on retry.
 */
export function patientHasOverlappingActiveVisit(args: {
  appointments: readonly Appointment[];
  patientId: string | number;
  startIso: string;
  endIso: string;
  excludeAppointmentIds?: readonly number[];
}): boolean {
  const patientKey = String(args.patientId).trim();
  if (!patientKey) return false;
  const startMs = DateTime.fromISO(args.startIso, { zone: 'utc' }).toMillis();
  const endMs = DateTime.fromISO(args.endIso, { zone: 'utc' }).toMillis();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return false;
  const exclude = new Set(
    (args.excludeAppointmentIds ?? [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0),
  );

  for (const a of args.appointments) {
    if (!isVisibleActiveAppt(a)) continue;
    const id = Number(a.id);
    if (Number.isFinite(id) && exclude.has(id)) continue;
    const hasPatient = patientsForAppointment(a).some((p) => String(p.id) === patientKey);
    if (!hasPatient) continue;
    const aStart = DateTime.fromISO(a.appointmentStart, { zone: 'utc' }).toMillis();
    const aEnd = DateTime.fromISO(a.appointmentEnd, { zone: 'utc' }).toMillis();
    if (!Number.isFinite(aStart) || !Number.isFinite(aEnd)) continue;
    if (aStart < endMs && startMs < aEnd) return true;
  }
  return false;
}
