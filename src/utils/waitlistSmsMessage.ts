import { appendCareOutreachSmsSuffix } from './careOutreachSmsMessage';
import { applySystemTemplateIfCustom } from './messageTemplateCache';
import { withClinicDefaults } from './messageTemplateFields';
import type { ForwardBookingSmsBookedSlot } from './forwardBookingSmsMessage';
import type { HoldSpotReleaseSmsOpts } from './holdSpotReleaseSmsClause';
import { appendHoldSpotReleaseClause } from './holdSpotReleaseSmsClause';
import { fetchAppointmentById } from '../api/appointments';
import {
  formatForwardBookingSmsBookedSlot,
  formatForwardBookingSmsBookedSlotFromAppointment,
} from './forwardBookingSmsMessage';

function firstName(clientFirstName?: string | null, clientDisplayName?: string | null): string {
  const fn = clientFirstName?.trim();
  if (fn) return fn.split(/\s+/).filter(Boolean)[0] || 'there';
  const full = clientDisplayName?.trim();
  if (full) return full.split(/\s+/).filter(Boolean)[0] || 'there';
  return 'there';
}

function petPhrase(names: readonly string[]): string {
  const cleaned = names.map((n) => n.trim()).filter(Boolean);
  if (cleaned.length === 0) return 'your pet';
  if (cleaned.length === 1) return cleaned[0]!;
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(', ')}, and ${cleaned[cleaned.length - 1]}`;
}

export function buildWaitlistOpeningSmsMessage(opts: {
  petNames: readonly string[];
  clientFirstName?: string | null;
  clientDisplayName?: string | null;
  targetDateLabel?: string | null;
  providerLastName?: string | null;
}): string {
  const name = firstName(opts.clientFirstName, opts.clientDisplayName);
  const pets = petPhrase(opts.petNames);
  const dateLabel = opts.targetDateLabel?.trim();
  const doctor = opts.providerLastName?.trim();
  const when = dateLabel ? ` on ${dateLabel}` : '';
  const who = doctor ? ` with Dr. ${doctor}` : '';
  const body = applySystemTemplateIfCustom(
    'waitlist_opening_sms',
    withClinicDefaults({
      client_first_name: name,
      pets,
      date_label: dateLabel || '',
      doctor_last_name: doctor || '',
    }),
    `Hi ${name}, it's Vet At Your Door. We had a cancellation${when} and can get ${pets} in${who}. Reply here if you'd like us to hold that visit, or tell us a better day.`,
  );
  return appendCareOutreachSmsSuffix(body);
}

export function buildWaitlistBookedSmsMessage(opts: {
  petNames: readonly string[];
  clientFirstName?: string | null;
  clientDisplayName?: string | null;
  bookedSlot?: ForwardBookingSmsBookedSlot;
  providerLastName?: string | null;
  holdRelease?: HoldSpotReleaseSmsOpts;
}): string {
  const name = firstName(opts.clientFirstName, opts.clientDisplayName);
  const pets = petPhrase(opts.petNames);
  const dateLabel = opts.bookedSlot?.dateLabel?.trim();
  const windowStart = opts.bookedSlot?.windowStart?.trim();
  const windowEnd = opts.bookedSlot?.windowEnd?.trim();
  const doctor = opts.providerLastName?.trim();
  const when = dateLabel ? ` on ${dateLabel}` : '';
  const who = doctor ? ` with Dr. ${doctor}` : '';
  const window =
    windowStart && windowEnd ? ` We'll come between ${windowStart} and ${windowEnd}.` : '';
  let body = applySystemTemplateIfCustom(
    'waitlist_booked_sms',
    withClinicDefaults({
      client_first_name: name,
      pets,
      date_label: dateLabel || '',
      doctor_last_name: doctor || '',
      window_start: windowStart || '',
      window_end: windowEnd || '',
    }),
    `Hi ${name}, it's Vet At Your Door. You're all set — we booked ${pets}${when}${who}.${window} Reply here if you need to change anything.`,
  );
  if (opts.holdRelease) {
    body = appendHoldSpotReleaseClause(body, opts.holdRelease);
  }
  return body;
}

export async function resolveWaitlistSmsBookedSlot(
  bookedAppointmentId: number,
  practiceId: number,
  practiceTz: string,
  fallback?: { startIso: string; endIso?: string | null },
): Promise<ForwardBookingSmsBookedSlot | undefined> {
  try {
    const appt = await fetchAppointmentById(bookedAppointmentId, { practiceId });
    if (appt) {
      const fromAppt = formatForwardBookingSmsBookedSlotFromAppointment(appt, practiceTz);
      if (fromAppt) return fromAppt;
    }
  } catch {
    /* fall through */
  }
  if (fallback?.startIso?.trim()) {
    return formatForwardBookingSmsBookedSlot(
      fallback.startIso,
      fallback.endIso ?? fallback.startIso,
      practiceTz,
      fallback.startIso,
    );
  }
  return undefined;
}
