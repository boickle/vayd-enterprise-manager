import { DateTime } from 'luxon';
import type { ForwardBookingEntry } from '../api/forwardBooking';
import { formatForwardBookingIntervalLabel } from './forwardBookingFromAppointment';

export type ForwardBookingSmsBookedSlot = {
  /** e.g. Tuesday, Jun 9 */
  dateLabel: string;
  /** Window start time, e.g. 12:35 PM */
  windowStart: string;
  /** Window end time, e.g. 1:20 PM */
  windowEnd: string;
};

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
  practiceTz: string
): ForwardBookingSmsBookedSlot {
  const start = DateTime.fromISO(startIso, { zone: 'utc' }).setZone(practiceTz);
  if (!start.isValid) {
    return { dateLabel: 'xxxxx', windowStart: 'xxxx', windowEnd: 'xxxx' };
  }
  const end = endIso
    ? DateTime.fromISO(endIso, { zone: 'utc' }).setZone(practiceTz)
    : null;
  const dateLabel = start.toFormat('EEEE, MMM d');
  const windowStart = start.toFormat('h:mm a');
  const windowEnd =
    end?.isValid && end.toMillis() !== start.toMillis()
      ? end.toFormat('h:mm a')
      : windowStart;
  return { dateLabel, windowStart, windowEnd };
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
