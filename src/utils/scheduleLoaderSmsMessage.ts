import { fetchAppointmentById } from '../api/appointments';
import type { ForwardBookingSmsBookedSlot } from './forwardBookingSmsMessage';
import {
  formatForwardBookingSmsBookedSlot,
  formatForwardBookingSmsBookedSlotFromAppointment,
} from './forwardBookingSmsMessage';

function formatPetNamesPhrase(names: readonly string[]): { phrase: string; count: number } {
  const cleaned = names.map((n) => n.trim()).filter(Boolean);
  if (cleaned.length === 0) return { phrase: 'your pet', count: 1 };
  if (cleaned.length === 1) return { phrase: cleaned[0]!, count: 1 };
  if (cleaned.length === 2) return { phrase: `${cleaned[0]} and ${cleaned[1]}`, count: 2 };
  return {
    phrase: `${cleaned.slice(0, -1).join(', ')}, and ${cleaned[cleaned.length - 1]}`,
    count: cleaned.length,
  };
}

function normalizeClientFirstName(
  clientFirstName?: string | null,
  clientDisplayName?: string | null
): string {
  const fn = clientFirstName?.trim();
  if (fn) {
    const token = fn.split(/\s+/).filter(Boolean)[0];
    if (token) return token;
  }
  const full = clientDisplayName?.trim();
  if (full) {
    const token = full.split(/\s+/).filter(Boolean)[0];
    if (token) return token;
  }
  return 'there';
}

export function providerLastNameFromDisplayName(name?: string | null): string | null {
  const raw = name?.trim();
  if (!raw) return null;
  const withoutPrefix = raw.replace(/^Dr\.?\s+/i, '').trim();
  const parts = withoutPrefix.split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0) return null;
  const last = parts[parts.length - 1]!;
  if (/^(dvm|vmd|md|do)$/i.test(last) && parts.length > 1) {
    return parts[parts.length - 2] ?? null;
  }
  return last;
}

export function buildScheduleLoaderBookedSmsMessage(opts: {
  petNames: readonly string[];
  clientFirstName?: string | null;
  clientDisplayName?: string | null;
  bookedSlot?: ForwardBookingSmsBookedSlot;
  providerLastName?: string | null;
}): string {
  const firstName = normalizeClientFirstName(opts.clientFirstName, opts.clientDisplayName);
  const { phrase: pets, count: petCount } = formatPetNamesPhrase(opts.petNames);
  const haveVerb = petCount === 1 ? 'has' : 'have';
  const datePart = opts.bookedSlot?.dateLabel?.trim() || 'xxxxx';
  const windowStart = opts.bookedSlot?.windowStart?.trim() || 'xxxx';
  const windowEnd = opts.bookedSlot?.windowEnd?.trim() || 'xxxx';
  const doctorLastName = opts.providerLastName?.trim() || 'xxxxx';
  return `Hi ${firstName}, it's Dr. ${doctorLastName}'s team at Vet At Your Door! It looks like ${pets} ${haveVerb} a few things past due, and Dr. ${doctorLastName} is going to be in your neighborhood on ${datePart} between ${windowStart} and ${windowEnd}. Would it be a good time for the team to stop by then to get ${pets} all up to date?`;
}

export async function resolveScheduleLoaderSmsBookedSlot(
  bookedAppointmentId: number,
  practiceId: number,
  practiceTz: string,
  fallback?: { startIso: string; endIso?: string | null }
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
      fallback.startIso
    );
  }
  return undefined;
}
