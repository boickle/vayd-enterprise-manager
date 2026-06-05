import { DateTime } from 'luxon';
import {
  appendStaffNoteLine,
  formatEmployeeFirstNameLastInitial,
  type AppointmentChangeActor,
} from './appointmentChangeAuditNote';

function bookedAtLabels(practiceTz: string): { dateLabel: string; timeLabel: string } {
  const now = DateTime.now().setZone(practiceTz);
  const fallback = DateTime.now();
  const dt = now.isValid ? now : fallback;
  return {
    dateLabel: dt.toFormat('MM/dd/yyyy'),
    timeLabel: dt.toFormat('h:mm a'),
  };
}

/** Staff note line appended when an appointment is booked. */
export function formatBookedStaffNoteLine(
  actor: AppointmentChangeActor,
  practiceTz: string
): string {
  const { dateLabel, timeLabel } = bookedAtLabels(practiceTz);
  const name = formatEmployeeFirstNameLastInitial(actor);
  return `Booked on ${dateLabel} at ${timeLabel} by ${name}`;
}

/** Append booking audit line to staff notes when saving a new appointment. */
export function appendBookedStaffNote(
  existing: string | undefined | null,
  actor: AppointmentChangeActor,
  practiceTz: string
): string {
  const line = formatBookedStaffNoteLine(actor, practiceTz);
  const base = (existing ?? '').trim();
  if (!base) return line;
  if (base.includes('Booked on ') || base.includes('(Scout')) return base;
  return appendStaffNoteLine(base, line);
}

/** @deprecated Use {@link formatBookedStaffNoteLine}. */
export function bookedAppointmentScoutStaffNote(practiceTz: string): string {
  return formatBookedStaffNoteLine({ fallbackLabel: 'Staff' }, practiceTz);
}

/** @deprecated Use {@link appendBookedStaffNote}. */
export function appendScoutBookedStaffNote(
  existing: string | undefined | null,
  practiceTz: string
): string {
  return appendBookedStaffNote(existing, { fallbackLabel: 'Staff' }, practiceTz);
}

/** @deprecated Use {@link appendBookedStaffNote}. */
export function bookedAppointmentDefaultDescription(practiceTz: string): string {
  return bookedAppointmentScoutStaffNote(practiceTz);
}

/** @deprecated Use {@link appendBookedStaffNote}. */
export function appendScoutBookedDescription(
  existing: string | undefined | null,
  practiceTz: string
): string {
  return appendScoutBookedStaffNote(existing, practiceTz);
}
