import { DateTime } from 'luxon';
import { fetchAppointmentById } from '../api/appointments';
import { fetchAllAppointmentTypes } from '../api/appointmentSettings';
import type { AppointmentRequestSubmissionItem } from '../api/appointmentRequestSubmissions';
import type { Appointment } from '../api/roomLoader';
import {
  clientDisplayNameFromRequestData,
  doctorLastNameFromLabel,
  requestDataPreferredDoctor,
  requestDataSelfScheduledSlot,
  type RequestDataSelfScheduledSlot,
} from './appointmentRequestDisplay';
import { requestDataPetRowSummaries } from './appointmentRequestDetailDisplay';
import {
  effectiveWindowForScheduledStart,
  type AppointmentTypeWindowSource,
} from './appointmentArrivalWindow';
import { fetchDoctorDayEffectiveWindowIsosForAppointment } from './appointmentRoutedArrivalWindow';
import { findCalmingPremedAppointmentType } from './appointmentTypeSettings';
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

const FALLBACK_BODY =
  'This is Vet At Your Door. We received your appointment request and will follow up shortly.';

function firstNameFromRequestData(requestData: Record<string, unknown>): string {
  return clientDisplayNameFromRequestData(requestData).split(' ')[0] || 'there';
}

/** Prepend the "Hi {First Name}," greeting. SMS keeps it inline; email breaks to a new line. */
function withGreeting(firstName: string, body: string, separator: string): string {
  return `Hi ${firstName},${separator}${body}`;
}

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function requestUsesCalmingMedications(requestData: Record<string, unknown>): boolean {
  const psd = requestData.petSpecificData;
  if (psd && typeof psd === 'object') {
    for (const raw of Object.values(psd as Record<string, unknown>)) {
      if (!raw || typeof raw !== 'object') continue;
      if (pickStr((raw as { needsCalmingMedications?: unknown }).needsCalmingMedications) === 'Yes') {
        return true;
      }
    }
  }
  return requestDataPetRowSummaries(requestData).some((row) => row.usesCalmingMedications === true);
}

async function resolveCalmingPremedWindowSource(
  practiceId?: number,
): Promise<AppointmentTypeWindowSource | null> {
  try {
    const types = await fetchAllAppointmentTypes(practiceId);
    const premed = findCalmingPremedAppointmentType(types);
    if (!premed) return null;
    return {
      name: premed.name,
      prettyName: premed.prettyName,
      windowBeforeMinutes: premed.windowBeforeMinutes,
      windowAfterMinutes: premed.windowAfterMinutes,
    };
  } catch {
    return null;
  }
}

function applyCalmingPremedWindow(
  ctx: AppointmentRequestSmsBookingContext,
  scheduledStartIso: string,
  practiceTz: string,
  premed: AppointmentTypeWindowSource,
): AppointmentRequestSmsBookingContext {
  const computed = effectiveWindowForScheduledStart(scheduledStartIso, premed, practiceTz);
  if (!computed) return ctx;
  const booked = formatForwardBookingSmsBookedSlot(
    computed.startIso,
    computed.endIso,
    practiceTz,
    scheduledStartIso,
  );
  return {
    ...ctx,
    dateLabel: booked.dateLabel,
    windowStart: booked.windowStart,
    windowEnd: booked.windowEnd,
  };
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

async function bookingContextFromAppointment(
  appt: Appointment,
  practiceTz: string,
): Promise<{
  ctx: AppointmentRequestSmsBookingContext;
  source: 'doctor_day' | 'appointment';
} | null> {
  const doctorLast = providerLastNameFromAppointment(appt);
  if (!doctorLast) return null;

  // Prefer doctor-day effectiveWindow (depot-aware first-stop clamp). GET
  // /appointments/:id often omits it or carries a simplistic ±60 window.
  const doctorDayWin = await fetchDoctorDayEffectiveWindowIsosForAppointment(
    appt,
    practiceTz,
  );
  if (doctorDayWin) {
    const booked = formatForwardBookingSmsBookedSlot(
      doctorDayWin.startIso,
      doctorDayWin.endIso,
      practiceTz,
      appt.appointmentStart,
    );
    return {
      source: 'doctor_day',
      ctx: {
        doctorLastName: doctorLast,
        dateLabel: booked.dateLabel,
        windowStart: booked.windowStart,
        windowEnd: booked.windowEnd,
      },
    };
  }

  const windowIsos = appointmentArrivalWindowIsosForSms(appt, practiceTz);
  if (!windowIsos) return null;

  const booked = formatForwardBookingSmsBookedSlot(
    windowIsos.startIso,
    windowIsos.endIso,
    practiceTz,
    windowIsos.dateIsoForLabel,
  );

  return {
    source: 'appointment',
    ctx: {
      doctorLastName: doctorLast,
      dateLabel: booked.dateLabel,
      windowStart: booked.windowStart,
      windowEnd: booked.windowEnd,
    },
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
  opts?: { practiceId?: number; greeting?: 'sms' | 'email' },
): Promise<string> {
  const rd = item.requestData ?? {};
  const firstName = firstNameFromRequestData(rd);
  const separator = opts?.greeting === 'email' ? '\n\n' : ' ';
  const greet = (body: string) => withGreeting(firstName, body, separator);
  const usesCalming = requestUsesCalmingMedications(rd);
  const premedPromise = usesCalming
    ? resolveCalmingPremedWindowSource(opts?.practiceId)
    : Promise.resolve(null);

  // Prefer the linked calendar visit once booked. The request's self-scheduled
  // slot can still carry a stale (±60) window from an earlier availability pass.
  const apptId = item.bookedAppointmentId;
  if (apptId != null && Number.isFinite(Number(apptId))) {
    try {
      const appt = await fetchAppointmentById(Number(apptId), {
        practiceId: opts?.practiceId,
      });
      if (appt) {
        const resolved = await bookingContextFromAppointment(appt, practiceTz);
        if (resolved) {
          let ctx = resolved.ctx;
          const premed = await premedPromise;
          const startIso = pickStr(appt.appointmentStart);
          // Keep doctor-day windows (includes first-stop depot clamp). Only apply
          // Pre-Meds type ±N when we fell back to appointment/type fields.
          if (premed && startIso && resolved.source !== 'doctor_day') {
            ctx = applyCalmingPremedWindow(ctx, startIso, practiceTz, premed);
          }
          return greet(buildAppointmentRequestSmsMessage(ctx));
        }
      }
    } catch {
      /* fall through */
    }
  }

  let fromSlot = bookingContextFromSelfScheduledSlot(rd, practiceTz);
  if (fromSlot) {
    const premed = await premedPromise;
    const slot = requestDataSelfScheduledSlot(rd);
    if (premed && slot?.appointmentStart) {
      fromSlot = applyCalmingPremedWindow(fromSlot, slot.appointmentStart, practiceTz, premed);
    }
    return greet(buildAppointmentRequestSmsMessage(fromSlot));
  }

  return greet(FALLBACK_BODY);
}
