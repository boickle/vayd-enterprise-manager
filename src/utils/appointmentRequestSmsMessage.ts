import { DateTime } from 'luxon';
import { fetchAppointmentById } from '../api/appointments';
import type { AppointmentRequestSubmissionItem } from '../api/appointmentRequestSubmissions';
import type { Appointment } from '../api/roomLoader';
import {
  clientDisplayNameFromRequestData,
  doctorLastNameFromLabel,
  requestDataPreferredDoctor,
  requestDataSelfScheduledSlot,
  type RequestDataSelfScheduledSlot,
} from './appointmentRequestDisplay';
import {
  appointmentArrivalWindowIsosForSms,
  formatForwardBookingSmsBookedSlot,
} from './forwardBookingSmsMessage';

export type AppointmentRequestSmsBookingContext = {
  doctorLastName: string;
  dateLabel: string;
  windowStart: string;
  windowEnd: string;
};

const FALLBACK_SMS_PREFIX = 'Hi there, this is Vet At Your Door. We received your appointment request and will follow up shortly.';

function fallbackSmsMessage(requestData: Record<string, unknown>): string {
  const name = clientDisplayNameFromRequestData(requestData).split(' ')[0] || 'there';
  return FALLBACK_SMS_PREFIX.replace('Hi there', `Hi ${name}`);
}

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function providerLastNameFromAppointment(appt: Appointment): string | null {
  const pp = appt.primaryProvider;
  if (!pp || typeof pp !== 'object') return null;
  const o = pp as Record<string, unknown>;
  const last = pickStr(o.lastName);
  if (last) return last;
  return doctorLastNameFromLabel(
    [pickStr(o.title), pickStr(o.firstName), pickStr(o.lastName), pickStr(o.name)]
      .filter(Boolean)
      .join(' '),
  );
}

function formatWindowFromSlot(
  slot: RequestDataSelfScheduledSlot,
  practiceTz: string,
): { windowStart: string; windowEnd: string } | null {
  if (slot.windowStartIso && slot.windowEndIso) {
    const start = DateTime.fromISO(slot.windowStartIso, { zone: 'utc' }).setZone(practiceTz);
    const end = DateTime.fromISO(slot.windowEndIso, { zone: 'utc' }).setZone(practiceTz);
    if (start.isValid && end.isValid) {
      return {
        windowStart: start.toFormat('h:mm a'),
        windowEnd: end.toFormat('h:mm a'),
      };
    }
  }

  const display = slot.windowDisplay?.trim();
  if (!display) return null;

  const betweenMatch = display.match(
    /between\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.))\s+and\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.))/i,
  );
  if (betweenMatch) {
    return {
      windowStart: betweenMatch[1].replace(/\./g, '').trim(),
      windowEnd: betweenMatch[2].replace(/\./g, '').trim(),
    };
  }

  const rangeMatch = display.match(
    /(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.))\s*[–—-]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.))/i,
  );
  if (rangeMatch) {
    return {
      windowStart: rangeMatch[1].replace(/\./g, '').trim(),
      windowEnd: rangeMatch[2].replace(/\./g, '').trim(),
    };
  }

  return null;
}

function bookingContextFromSelfScheduledSlot(
  requestData: Record<string, unknown>,
  practiceTz: string,
): AppointmentRequestSmsBookingContext | null {
  const slot = requestDataSelfScheduledSlot(requestData);
  if (!slot?.appointmentStart) return null;

  const start = DateTime.fromISO(slot.appointmentStart, { zone: 'utc' }).setZone(practiceTz);
  if (!start.isValid) return null;

  const doctorLast =
    doctorLastNameFromLabel(slot.doctorName) ??
    doctorLastNameFromLabel(requestDataPreferredDoctor(requestData));
  const window = formatWindowFromSlot(slot, practiceTz);
  if (!doctorLast || !window) return null;

  const booked = formatForwardBookingSmsBookedSlot(
    slot.windowStartIso ?? slot.appointmentStart,
    slot.windowEndIso ?? slot.appointmentStart,
    practiceTz,
    slot.appointmentStart,
  );

  return {
    doctorLastName: doctorLast,
    dateLabel: booked.dateLabel,
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
  };
}

function bookingContextFromAppointment(
  appt: Appointment,
  practiceTz: string,
): AppointmentRequestSmsBookingContext | null {
  const doctorLast = providerLastNameFromAppointment(appt);
  const windowIsos = appointmentArrivalWindowIsosForSms(appt, practiceTz);
  if (!doctorLast || !windowIsos) return null;

  const booked = formatForwardBookingSmsBookedSlot(
    windowIsos.startIso,
    windowIsos.endIso,
    practiceTz,
    windowIsos.dateIsoForLabel,
  );

  return {
    doctorLastName: doctorLast,
    dateLabel: booked.dateLabel,
    windowStart: booked.windowStart,
    windowEnd: booked.windowEnd,
  };
}

export function buildAppointmentRequestSmsMessage(
  ctx: AppointmentRequestSmsBookingContext,
): string {
  return (
    `Thanks for your appointment request. We have booked you with Dr. ${ctx.doctorLastName} ` +
    `on ${ctx.dateLabel} with an arrival window between ${ctx.windowStart} and ${ctx.windowEnd}. ` +
    `Please reply if this works for you!`
  );
}

export async function resolveAppointmentRequestSmsMessage(
  item: AppointmentRequestSubmissionItem,
  practiceTz: string,
  opts?: { practiceId?: number },
): Promise<string> {
  const rd = item.requestData ?? {};
  const fromSlot = bookingContextFromSelfScheduledSlot(rd, practiceTz);
  if (fromSlot) return buildAppointmentRequestSmsMessage(fromSlot);

  const apptId = item.bookedAppointmentId;
  if (apptId != null && Number.isFinite(Number(apptId))) {
    try {
      const appt = await fetchAppointmentById(Number(apptId), {
        practiceId: opts?.practiceId,
      });
      if (appt) {
        const fromAppt = bookingContextFromAppointment(appt, practiceTz);
        if (fromAppt) return buildAppointmentRequestSmsMessage(fromAppt);
      }
    } catch {
      /* fall through */
    }
  }

  return fallbackSmsMessage(rd);
}
