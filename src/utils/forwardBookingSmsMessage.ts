import { DateTime } from 'luxon';
import type { ForwardBookingEntry } from '../api/forwardBooking';
import { fetchAppointmentById } from '../api/appointments';
import type { AppointmentType } from '../api/appointmentSettings';
import type { Appointment } from '../api/roomLoader';
import { fetchRoutedArrivalWindowIsosForAppointment } from './appointmentRoutedArrivalWindow';
import { isFixedTimeTypeName } from './editVisitTimePreview';
import { formatForwardBookingIntervalLabel } from './forwardBookingFromAppointment';
import { forwardBookingLinkedAppointmentId } from './forwardBookingLinkedVisit';

export type ForwardBookingSmsBookedSlot = {
  /** e.g. Monday, June 15th, 2026 */
  dateLabel: string;
  /** Window start time, e.g. 12:35 PM */
  windowStart: string;
  /** Window end time, e.g. 1:20 PM */
  windowEnd: string;
};

function dayOfMonthWithOrdinal(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

/** Client-facing date in forward-booking SMS — full month, ordinal day, year. */
export function formatForwardBookingSmsDateLabel(dt: DateTime): string {
  if (!dt.isValid) return 'xxxxx';
  return `${dt.toFormat('EEEE, MMMM')} ${dayOfMonthWithOrdinal(dt.day)}, ${dt.toFormat('yyyy')}`;
}

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function clientFirstName(entry: ForwardBookingEntry): string {
  const fn = pickStr(entry.client?.firstName);
  if (fn) {
    const token = fn.split(/\s+/).filter(Boolean)[0];
    if (token) return token;
  }
  const full = [pickStr(entry.client?.firstName), pickStr(entry.client?.lastName)]
    .filter(Boolean)
    .join(' ')
    .trim();
  const token = full.split(/\s+/).filter(Boolean)[0];
  return token || 'there';
}

function doctorLastName(entry: ForwardBookingEntry): string {
  const p = entry.primaryProvider;
  if (!p) return 'your veterinarian';
  const ln = pickStr(p.lastName);
  if (ln) return ln;
  const full = pickStr(p.name) ?? [pickStr(p.firstName), pickStr(p.lastName)].filter(Boolean).join(' ');
  const parts = full.split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : 'your veterinarian';
}

/** Interval phrase for “book … in …” (drops trailing “out”). */
function forwardBookingTimeFramePhrase(entry: ForwardBookingEntry): string {
  const label = formatForwardBookingIntervalLabel(entry);
  if (label === '—') return 'the requested timeframe';
  return label.replace(/\s+out$/i, '').trim() || label;
}

/** Pet name(s) for SMS — single patient on forward-booking rows. */
function petNamesPhrase(entry: ForwardBookingEntry): string {
  const name = pickStr(entry.patient?.name);
  if (name) return name;
  if (entry.patientId) return `patient #${entry.patientId}`;
  return 'your pet';
}

export function formatForwardBookingSmsBookedSlot(
  startIso: string,
  endIso: string | null | undefined,
  practiceTz: string,
  dateIsoForLabel?: string
): ForwardBookingSmsBookedSlot {
  const start = DateTime.fromISO(startIso, { zone: 'utc' }).setZone(practiceTz);
  const dateSource = dateIsoForLabel ?? startIso;
  const dateDt = DateTime.fromISO(dateSource, { zone: 'utc' }).setZone(practiceTz);
  if (!start.isValid) {
    return { dateLabel: 'xxxxx', windowStart: 'xxxx', windowEnd: 'xxxx' };
  }
  const end = endIso
    ? DateTime.fromISO(endIso, { zone: 'utc' }).setZone(practiceTz)
    : null;
  const dateLabel = dateDt.isValid
    ? formatForwardBookingSmsDateLabel(dateDt)
    : formatForwardBookingSmsDateLabel(start);
  const windowStart = start.toFormat('h:mm a');
  const windowEnd =
    end?.isValid && end.toMillis() !== start.toMillis()
      ? end.toFormat('h:mm a')
      : windowStart;
  return { dateLabel, windowStart, windowEnd };
}

type AppointmentTypeWindowFields = Pick<
  AppointmentType,
  'name' | 'prettyName' | 'windowBeforeMinutes' | 'windowAfterMinutes'
>;

function parseLocalTimeOnAppointmentDay(
  appointmentStartIso: string,
  localTime: string,
  practiceTz: string
): string | null {
  const day = DateTime.fromISO(appointmentStartIso, { zone: 'utc' }).setZone(practiceTz);
  if (!day.isValid) return null;
  const trimmed = localTime.trim();
  for (const fmt of ['h:mm a', 'h:mma', 'H:mm'] as const) {
    const parsed = DateTime.fromFormat(trimmed, fmt, { zone: practiceTz });
    if (!parsed.isValid) continue;
    const combined = day.set({
      hour: parsed.hour,
      minute: parsed.minute,
      second: 0,
      millisecond: 0,
    });
    return combined.toISO({ includeOffset: true });
  }
  return null;
}

/** ± minutes around scheduled start from appointment type (matches edit-visit / routing preview). */
export function computedArrivalWindowFromAppointmentType(
  appointmentStart: string,
  appointmentEnd: string,
  type: AppointmentTypeWindowFields | null | undefined,
  practiceTz: string
): { startIso: string; endIso: string } | null {
  const typeName = (type?.name || type?.prettyName || '').trim();
  if (isFixedTimeTypeName(typeName)) {
    return { startIso: appointmentStart, endIso: appointmentEnd };
  }
  const start = DateTime.fromISO(appointmentStart, { zone: 'utc' }).setZone(practiceTz);
  if (!start.isValid) return null;
  const before = type?.windowBeforeMinutes ?? 60;
  const after = type?.windowAfterMinutes ?? 60;
  return {
    startIso: start.minus({ minutes: before }).toISO({ includeOffset: true }) ?? appointmentStart,
    endIso: start.plus({ minutes: after }).toISO({ includeOffset: true }) ?? appointmentEnd,
  };
}

/** Arrival window isos for SMS — API window fields, else compute from appointment type. */
export function appointmentArrivalWindowIsosForSms(
  appt: Pick<
    Appointment,
    'effectiveWindow' | 'arrivalWindow' | 'appointmentStart' | 'appointmentEnd' | 'appointmentType'
  >,
  practiceTz: string,
  appointmentType?: AppointmentTypeWindowFields | null
): { startIso: string; endIso: string; dateIsoForLabel: string } | null {
  const schedStart = pickStr(appt.appointmentStart);
  const schedEnd = pickStr(appt.appointmentEnd);
  if (!schedStart) return null;

  const type =
    appointmentType ??
    (appt.appointmentType as AppointmentTypeWindowFields | null | undefined) ??
    null;

  const ew = appt.effectiveWindow;
  if (ew?.startIso?.trim() && ew?.endIso?.trim()) {
    return {
      startIso: ew.startIso.trim(),
      endIso: ew.endIso.trim(),
      dateIsoForLabel: schedStart,
    };
  }

  const aw = appt.arrivalWindow;
  const ws = pickStr(aw?.windowStartIso);
  const we = pickStr(aw?.windowEndIso);
  if (ws && we) {
    return { startIso: ws, endIso: we, dateIsoForLabel: schedStart };
  }

  const wsl = pickStr(aw?.windowStartLocal);
  const wel = pickStr(aw?.windowEndLocal);
  if (wsl && wel) {
    const startIso = parseLocalTimeOnAppointmentDay(schedStart, wsl, practiceTz);
    const endIso = parseLocalTimeOnAppointmentDay(schedStart, wel, practiceTz);
    if (startIso && endIso) {
      return { startIso, endIso, dateIsoForLabel: schedStart };
    }
  }

  const computed = computedArrivalWindowFromAppointmentType(
    schedStart,
    schedEnd ?? schedStart,
    type,
    practiceTz
  );
  if (!computed) return null;
  return { ...computed, dateIsoForLabel: schedStart };
}

export function formatForwardBookingSmsBookedSlotFromAppointment(
  appt: Pick<
    Appointment,
    'effectiveWindow' | 'arrivalWindow' | 'appointmentStart' | 'appointmentEnd' | 'appointmentType'
  >,
  practiceTz: string,
  appointmentType?: AppointmentTypeWindowFields | null
): ForwardBookingSmsBookedSlot | null {
  const win = appointmentArrivalWindowIsosForSms(appt, practiceTz, appointmentType);
  if (!win) return null;
  return formatForwardBookingSmsBookedSlot(
    win.startIso,
    win.endIso,
    practiceTz,
    win.dateIsoForLabel
  );
}

/** Resolve SMS window from routed doctor-day ETAs when possible; else appointment fields or type defaults. */
export async function resolveForwardBookingSmsBookedSlot(
  entry: ForwardBookingEntry,
  practiceTz: string,
  opts?: {
    practiceId?: number;
    appointmentType?: AppointmentTypeWindowFields | null;
  }
): Promise<ForwardBookingSmsBookedSlot | undefined> {
  const appointmentType = opts?.appointmentType ?? null;
  const practiceId = opts?.practiceId;

  const apptId = forwardBookingLinkedAppointmentId(entry) ?? entry.bookedAppointmentId ?? null;
  if (apptId != null && practiceId != null) {
    const appt = await fetchAppointmentById(apptId, { practiceId });
    if (appt) {
      const type =
        appointmentType ??
        (appt.appointmentType as AppointmentTypeWindowFields | null | undefined) ??
        null;

      const doctorPimsId =
        appt.primaryProvider?.pimsId?.trim() || entry.primaryProvider?.pimsId?.trim() || null;

      const routedWin = await fetchRoutedArrivalWindowIsosForAppointment(
        appt,
        practiceTz,
        doctorPimsId
      );
      if (routedWin) {
        return formatForwardBookingSmsBookedSlot(
          routedWin.startIso,
          routedWin.endIso,
          practiceTz,
          appt.appointmentStart
        );
      }

      const fromAppt = formatForwardBookingSmsBookedSlotFromAppointment(appt, practiceTz, type);
      if (fromAppt) return fromAppt;
    }
  }

  return formatForwardBookingSmsBookedSlotFromEntry(entry, practiceTz, appointmentType);
}

export function formatForwardBookingSmsBookedSlotFromEntry(
  entry: ForwardBookingEntry,
  practiceTz: string,
  appointmentType?: AppointmentTypeWindowFields | null
): ForwardBookingSmsBookedSlot | undefined {
  const start = entry.bookedAppointmentStart?.trim();
  if (!start) return undefined;
  const end = entry.bookedAppointmentEnd?.trim() ?? start;
  const computed = computedArrivalWindowFromAppointmentType(start, end, appointmentType ?? null, practiceTz);
  if (!computed) return undefined;
  return formatForwardBookingSmsBookedSlot(
    computed.startIso,
    computed.endIso,
    practiceTz,
    start
  );
}

export function buildForwardBookingSmsMessage(
  entry: ForwardBookingEntry,
  opts?: { bookedSlot?: ForwardBookingSmsBookedSlot }
): string {
  const first = clientFirstName(entry);
  const drLast = doctorLastName(entry);
  const pets = petNamesPhrase(entry);
  const timeframe = forwardBookingTimeFramePhrase(entry);
  const datePart = opts?.bookedSlot?.dateLabel?.trim() || 'xxxxx';
  const windowStart = opts?.bookedSlot?.windowStart?.trim() || 'xxxx';
  const windowEnd = opts?.bookedSlot?.windowEnd?.trim() || 'xxxx';
  return `Hi ${first}. I'm following up on Dr. ${drLast}'s request to book ${pets} in ${timeframe}. Could we come by on ${datePart} between ${windowStart} and ${windowEnd}?`;
}

export function clientHasSmsPhone(entry: ForwardBookingEntry): boolean {
  const phone = pickStr(entry.client?.phone1);
  if (!phone) return false;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10;
}
