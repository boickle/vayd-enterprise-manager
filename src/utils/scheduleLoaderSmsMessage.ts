import { fetchAppointmentById } from '../api/appointments';
import { buildCareOutreachSmsMessage } from './careOutreachSmsMessage';
import type { ForwardBookingSmsBookedSlot } from './forwardBookingSmsMessage';
import {
  formatForwardBookingSmsBookedSlot,
  formatForwardBookingSmsBookedSlotFromAppointment,
} from './forwardBookingSmsMessage';

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
  /** Past-due care outreach wording when true (default). */
  anyPastDue?: boolean;
}): string {
  return buildCareOutreachSmsMessage({
    petNames: opts.petNames,
    clientFirstName: opts.clientFirstName,
    clientDisplayName: opts.clientDisplayName,
    bookedSlot: opts.bookedSlot,
    providerLastName: opts.providerLastName,
    anyPastDue: opts.anyPastDue !== false,
  });
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
