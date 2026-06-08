import { DateTime } from 'luxon';
import type { Appointment } from '../api/roomLoader';
import {
  appointmentMatchesPatientId,
  clientIdFromAppointment,
  fetchClientAppointmentsStaff,
  fetchPatientAppointmentsStaff,
  patientIdFromAppointment,
} from '../api/pimsAppointments';
import { appointmentArrivalWindowIsosForSms } from './forwardBookingSmsMessage';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function isFutureAppointment(a: Appointment, excludeId: number, asOfMs: number): boolean {
  if (a.id === excludeId) return false;
  if (a.isDeleted === true) return false;
  const startMs = Date.parse(a.appointmentStart);
  return Number.isFinite(startMs) && startMs > asOfMs;
}

/** Primary display label for an appointment type (pretty name, else internal name). */
export function appointmentTypeDisplayName(a: Appointment): string {
  const t = a.appointmentType;
  if (t && typeof t === 'object') {
    const o = t as { prettyName?: unknown; name?: unknown };
    return pickStr(o.prettyName) ?? pickStr(o.name) ?? '—';
  }
  return '—';
}

export function formatNextAppointmentWhen(a: Appointment, practiceTz: string): string {
  const start = DateTime.fromISO(a.appointmentStart, { zone: 'utc' }).setZone(practiceTz);
  const end = DateTime.fromISO(a.appointmentEnd, { zone: 'utc' }).setZone(practiceTz);
  if (!start.isValid) return '—';
  const datePart = start.toFormat('EEE, MMM d, yyyy');
  const timePart =
    end.isValid && end > start
      ? `${start.toFormat('h:mm a')} – ${end.toFormat('h:mm a')}`
      : start.toFormat('h:mm a');
  const windowPart = formatAppointmentArrivalWindowParen(a, practiceTz);
  return `${datePart} · ${timePart}${windowPart}`;
}

function formatAppointmentArrivalWindowParen(a: Appointment, practiceTz: string): string {
  const range = formatAppointmentArrivalWindowRange(a, practiceTz);
  return range ? ` (${range})` : '';
}

/** Arrival window as a time range, e.g. `12:10 PM – 2:10 PM`. */
export function formatAppointmentArrivalWindowRange(
  a: Appointment,
  practiceTz: string,
  opts?: { omitWhenSameAsScheduled?: boolean }
): string | null {
  const win = appointmentArrivalWindowIsosForSms(a, practiceTz);
  if (!win) return null;

  const schedStart = DateTime.fromISO(a.appointmentStart, { zone: 'utc' }).setZone(practiceTz);
  const schedEnd = DateTime.fromISO(a.appointmentEnd, { zone: 'utc' }).setZone(practiceTz);
  const winStart = DateTime.fromISO(win.startIso, { zone: 'utc' }).setZone(practiceTz);
  const winEnd = DateTime.fromISO(win.endIso, { zone: 'utc' }).setZone(practiceTz);
  if (!winStart.isValid || !winEnd.isValid) return null;

  if (opts?.omitWhenSameAsScheduled !== false) {
    const sameAsScheduled =
      schedStart.isValid &&
      schedEnd.isValid &&
      winStart.toMillis() === schedStart.toMillis() &&
      winEnd.toMillis() === schedEnd.toMillis();
    if (sameAsScheduled) return null;
  }

  const windowStart = winStart.toFormat('h:mm a');
  const windowEnd =
    winEnd.toMillis() !== winStart.toMillis() ? winEnd.toFormat('h:mm a') : windowStart;
  return `${windowStart} – ${windowEnd}`;
}

/** Visit Highlights hover — internal type name, date/time, provider, arrival window. */
export function formatVisitHighlightsNextAppointmentLine(
  nextAppt: Appointment,
  practiceTz: string,
  providerLabel: string
): string {
  const typeName = pickStr(nextAppt.appointmentType?.name) ?? 'Appointment';
  const start = DateTime.fromISO(nextAppt.appointmentStart, { zone: 'utc' }).setZone(practiceTz);
  if (!start.isValid) return typeName;

  const dateTimePart = `${start.toFormat('M/d/yyyy')}, ${start.toFormat('h:mm a')}`;
  const withPart =
    providerLabel && providerLabel !== '—' ? ` with ${providerLabel}` : '';
  const windowRange = formatAppointmentArrivalWindowRange(nextAppt, practiceTz, {
    omitWhenSameAsScheduled: false,
  });
  const windowPart = windowRange ? ` (${windowRange})` : '';

  return `${typeName} - ${dateTimePart}${withPart}${windowPart}`;
}

/** Client description and staff instructions combined for display. */
export function appointmentNotesDisplay(a: Appointment): string | null {
  const description = pickStr(a.description);
  const instructions = pickStr(a.instructions);
  if (description && instructions) return `${description} — ${instructions}`;
  return description ?? instructions;
}

/**
 * Earliest future appointment for the visit's patient (or client when no patient id).
 * Excludes the source visit and appointments at or before `asOf`.
 */
export async function loadNextScheduledAppointmentForVisit(
  sourceAppt: Appointment,
  practiceId: number,
  opts?: { asOf?: string }
): Promise<Appointment | null> {
  const asOfIso = opts?.asOf?.trim() || new Date().toISOString();
  const asOfMs = Date.parse(asOfIso);
  if (!Number.isFinite(asOfMs)) return null;

  const rangeEnd = new Date(asOfIso);
  rangeEnd.setUTCFullYear(rangeEnd.getUTCFullYear() + 2);

  const patientId = patientIdFromAppointment(sourceAppt);
  const clientId = clientIdFromAppointment(sourceAppt);

  let rows: Appointment[] = [];
  if (patientId) {
    rows = await fetchPatientAppointmentsStaff(patientId, {
      practiceId,
      start: asOfIso,
      end: rangeEnd.toISOString(),
    });
    rows = rows.filter((a) => appointmentMatchesPatientId(a, patientId));
  } else if (clientId) {
    rows = await fetchClientAppointmentsStaff(clientId, {
      practiceId,
      start: asOfIso,
      end: rangeEnd.toISOString(),
    });
  } else {
    return null;
  }

  const next = rows
    .filter((a) => isFutureAppointment(a, sourceAppt.id, asOfMs))
    .sort((a, b) => Date.parse(a.appointmentStart) - Date.parse(b.appointmentStart))[0];

  return next ?? null;
}
