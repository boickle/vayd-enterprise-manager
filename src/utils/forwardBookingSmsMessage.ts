import { DateTime } from 'luxon';
import type { ForwardBookingEntry } from '../api/forwardBooking';
import { fetchAppointmentById } from '../api/appointments';
import type { AppointmentType } from '../api/appointmentSettings';
import type { Appointment } from '../api/roomLoader';
import { fetchDoctorDayEffectiveWindowIsosForAppointment } from './appointmentRoutedArrivalWindow';
import { isFixedTimeTypeName } from './editVisitTimePreview';
import { formatForwardBookingIntervalLabel } from './forwardBookingFromAppointment';
import { forwardBookingLinkedAppointmentId } from './forwardBookingLinkedVisit';
import { computeHoldSpotReleaseDeadline, formatHoldSpotReleaseDeadlineShort, type HoldSpotReleaseSmsOpts } from './holdSpotReleaseSmsClause';
import { resolveForwardBookingIntervalFromEntry } from './forwardBookingFromAppointment';
import { applySystemTemplateIfCustom } from './messageTemplateCache';
import { withClinicDefaults } from './messageTemplateFields';

export type { HoldSpotReleaseSmsOpts };

export type ForwardBookingSmsBookedSlot = {
  /** e.g. Monday, June 15th, 2026 */
  dateLabel: string;
  /** Window start time, e.g. 12:35 PM */
  windowStart: string;
  /** Window end time, e.g. 1:20 PM */
  windowEnd: string;
};

export type ForwardBookingSmsBookedContext = {
  bookedSlot?: ForwardBookingSmsBookedSlot;
  /** Booked visit assignee — send SMS from their Quo/OpenPhone line when set. */
  primaryProviderId?: number;
};

function primaryProviderIdFromEntry(entry: ForwardBookingEntry): number | undefined {
  const id = entry.primaryProvider?.id;
  if (id == null || !Number.isFinite(Number(id))) return undefined;
  return Number(id);
}

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

/** Interval phrase for “book … in …” (drops trailing “out”). */
function forwardBookingTimeFramePhrase(entry: ForwardBookingEntry): string {
  const label = formatForwardBookingIntervalLabel(entry);
  if (label === '—') return 'the requested timeframe';
  return label.replace(/\s+out$/i, '').trim() || label;
}

const TIMEFRAME_COUNT_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
] as const;

/** “about four months” — spoken interval for client SMS. */
function forwardBookingSmsTimeFramePhrase(entry: ForwardBookingEntry): string {
  const resolved = resolveForwardBookingIntervalFromEntry(entry);
  if (!resolved) return forwardBookingTimeFramePhrase(entry);
  const { amount, unit } = resolved;
  const countWord =
    amount >= 0 && amount < TIMEFRAME_COUNT_WORDS.length
      ? TIMEFRAME_COUNT_WORDS[amount]!
      : String(amount);
  const unitLabel =
    unit === 'days'
      ? amount === 1
        ? 'day'
        : 'days'
      : unit === 'weeks'
        ? amount === 1
          ? 'week'
          : 'weeks'
        : amount === 1
          ? 'month'
          : 'months';
  return `about ${countWord} ${unitLabel}`;
}

function possessivePetLabel(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "your pet's";
  if (/[sS]$/.test(trimmed)) return `${trimmed}'`;
  return `${trimmed}'s`;
}

/** “8:40 and 10:40 AM” when both times share AM/PM. */
export function formatForwardBookingSmsTimeWindow(slot: ForwardBookingSmsBookedSlot): string {
  const start = slot.windowStart.trim();
  const end = slot.windowEnd.trim();
  if (!start || !end) return 'xxxx and xxxx';
  if (start === end) return start;
  const startMatch = start.match(/^(.+?)\s+(AM|PM)$/i);
  const endMatch = end.match(/^(.+?)\s+(AM|PM)$/i);
  if (startMatch && endMatch && startMatch[2]!.toUpperCase() === endMatch[2]!.toUpperCase()) {
    return `${startMatch[1]!.trim()} and ${endMatch[1]!.trim()} ${endMatch[2]!.toUpperCase()}`;
  }
  return `${start} and ${end}`;
}

/** Pet name(s) for SMS — single patient on forward-booking rows. */
function petNamesPhrase(entry: ForwardBookingEntry): string {
  const name = pickStr(entry.patient?.name);
  if (name) return name;
  if (entry.patientId) return `patient #${entry.patientId}`;
  return 'your pet';
}

function formatPetNamesList(names: readonly string[]): string {
  const cleaned = names.map((n) => n.trim()).filter(Boolean);
  if (cleaned.length === 0) return 'your pet';
  if (cleaned.length === 1) return cleaned[0]!;
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(', ')}, and ${cleaned[cleaned.length - 1]}`;
}

/** Parse a calendar date or instant for SMS/table labels in practice local time. */
function practiceLocalDateForLabel(
  dateSource: string,
  practiceTz: string
): DateTime {
  const raw = dateSource.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return DateTime.fromISO(raw, { zone: practiceTz });
  }
  const dt = DateTime.fromISO(raw, { zone: 'utc' }).setZone(practiceTz);
  return dt.isValid ? dt : DateTime.fromISO(raw, { zone: practiceTz });
}

export function formatForwardBookingSmsBookedSlot(
  startIso: string,
  endIso: string | null | undefined,
  practiceTz: string,
  dateIsoForLabel?: string
): ForwardBookingSmsBookedSlot {
  const start = DateTime.fromISO(startIso, { zone: 'utc' }).setZone(practiceTz);
  const dateSource = dateIsoForLabel ?? startIso;
  const dateDt = practiceLocalDateForLabel(dateSource, practiceTz);
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
): Promise<ForwardBookingSmsBookedContext> {
  const appointmentType = opts?.appointmentType ?? null;
  const practiceId = opts?.practiceId;
  const fallbackProviderId = primaryProviderIdFromEntry(entry);

  const apptId = forwardBookingLinkedAppointmentId(entry) ?? entry.bookedAppointmentId ?? null;
  if (apptId != null && practiceId != null) {
    const appt = await fetchAppointmentById(apptId, { practiceId });
    if (appt) {
      const bookedProviderId =
        appt.primaryProvider?.id != null && Number.isFinite(Number(appt.primaryProvider.id))
          ? Number(appt.primaryProvider.id)
          : fallbackProviderId;

      const bookedType =
        (appt.appointmentType as AppointmentTypeWindowFields | null | undefined) ?? null;

      const doctorDayWin = await fetchDoctorDayEffectiveWindowIsosForAppointment(
        appt,
        practiceTz,
        null,
        entry.primaryProvider ?? null
      );
      if (doctorDayWin) {
        return {
          bookedSlot: formatForwardBookingSmsBookedSlot(
            doctorDayWin.startIso,
            doctorDayWin.endIso,
            practiceTz,
            appt.appointmentStart
          ),
          primaryProviderId: bookedProviderId,
        };
      }

      const fromAppt = formatForwardBookingSmsBookedSlotFromAppointment(
        appt,
        practiceTz,
        bookedType
      );
      if (fromAppt) {
        return { bookedSlot: fromAppt, primaryProviderId: bookedProviderId };
      }

      return { primaryProviderId: bookedProviderId };
    }
  }

  const bookedSlot = formatForwardBookingSmsBookedSlotFromEntry(entry, practiceTz, appointmentType);
  return {
    ...(bookedSlot ? { bookedSlot } : {}),
    ...(fallbackProviderId != null ? { primaryProviderId: fallbackProviderId } : {}),
  };
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
  opts?: {
    bookedSlot?: ForwardBookingSmsBookedSlot;
    holdRelease?: HoldSpotReleaseSmsOpts;
    petNames?: readonly string[];
  }
): string {
  const first = clientFirstName(entry);
  const pets =
    opts?.petNames?.map((n) => n.trim()).filter(Boolean).length
      ? formatPetNamesList(opts.petNames!)
      : petNamesPhrase(entry);
  const timeframe = forwardBookingSmsTimeFramePhrase(entry);
  const datePart = opts?.bookedSlot?.dateLabel?.trim() || 'xxxxx';
  const windowPhrase = opts?.bookedSlot
    ? formatForwardBookingSmsTimeWindow(opts.bookedSlot)
    : 'xxxx and xxxx';

  const petSubject =
    opts?.petNames?.length === 1 || (!opts?.petNames?.length && entry.patient?.name?.trim())
      ? possessivePetLabel(
          opts?.petNames?.[0]?.trim() || entry.patient?.name?.trim() || pets,
        )
      : null;

  const scheduleTarget = petSubject
    ? `${petSubject} visit`
    : pets.includes(' and ') || pets.includes(',')
      ? `visits for ${pets}`
      : `${possessivePetLabel(pets)} visit`;

  let message = applySystemTemplateIfCustom(
    'forward_booking_sms',
    withClinicDefaults({
      client_first_name: first,
      pets: scheduleTarget,
      timeframe,
      date_label: datePart,
      window_start: opts?.bookedSlot?.windowStart?.trim() || 'xxxx',
      window_end: opts?.bookedSlot?.windowEnd?.trim() || 'xxxx',
    }),
    `Hi ${first}, following up on the request to schedule ${scheduleTarget} in ${timeframe}. Would ${datePart}, between ${windowPhrase} work for you?`,
  );

  if (opts?.holdRelease) {
    const deadline = computeHoldSpotReleaseDeadline(opts.holdRelease);
    if (deadline?.isValid) {
      const deadlineLabel = formatHoldSpotReleaseDeadlineShort(
        deadline,
        opts.holdRelease.practiceTz,
        opts.holdRelease.now,
      );
      message += ` We're holding this slot for you until ${deadlineLabel}, after which we'll need to release it to another client. If a different time works better, just let us know.`;
    }
  }

  return message;
}

export function holdReleaseOptsForAppointment(
  appointmentStartIso: string | null | undefined,
  practiceTz: string,
): HoldSpotReleaseSmsOpts | undefined {
  const start = appointmentStartIso?.trim();
  if (!start) return undefined;
  return { practiceTz, appointmentStartIso: start };
}

export function clientHasSmsPhone(entry: ForwardBookingEntry): boolean {
  const phone = pickStr(entry.client?.phone1);
  if (!phone) return false;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10;
}
