import dayjs from 'dayjs';
import { DateTime } from 'luxon';
import {
  createForwardBooking,
  type ForwardBookingEntry,
} from '../api/forwardBooking';
import type { UnscheduledReminder } from '../api/careOutreach';
import { calendarDayDiffFromToday } from './careOutreachPriorityFilters';
import {
  buildCreateForwardBookingPayloadFromPatient,
  type ForwardBookingInterval,
} from './forwardBookingFromAppointment';
import { practiceTimeZoneOrDefault } from './practiceTimezone';

export const CARE_OUTREACH_BOOKING_NOTES_PREFIX = 'Care outreach follow-up';

function reminderIsHidden(r: UnscheduledReminder): boolean {
  const any = r as Record<string, unknown>;
  if (typeof any.is_hidden === 'boolean') return any.is_hidden;
  return r.isHidden === true;
}

function visibleReminders(reminders: readonly UnscheduledReminder[]): UnscheduledReminder[] {
  return reminders.filter((r) => !reminderIsHidden(r));
}

function earliestDueIso(reminders: readonly UnscheduledReminder[]): string | null {
  let best: string | null = null;
  let bestMs = Number.MAX_SAFE_INTEGER;
  for (const r of reminders) {
    const due = r.dueDate?.trim();
    if (!due) continue;
    const ms = Date.parse(due);
    if (!Number.isFinite(ms) || ms >= bestMs) continue;
    bestMs = ms;
    best = due;
  }
  return best;
}

/** POST /forward-bookings caps `intervalAmount` at 12 for days, weeks, and months. */
const MAX_FORWARD_BOOKING_INTERVAL_AMOUNT = 12;

/** Map reminder due date to a forward-booking interval (target ≈ due date). */
export function careOutreachForwardBookingIntervalForDueDate(
  dueIso: string | null | undefined
): ForwardBookingInterval {
  if (!dueIso) return { amount: 1, unit: 'months' };
  const due = dayjs(dueIso).startOf('day');
  if (!due.isValid()) return { amount: 1, unit: 'months' };
  const diff = due.diff(dayjs().startOf('day'), 'day');
  if (diff <= 0) return { amount: 1, unit: 'weeks' };
  if (diff <= MAX_FORWARD_BOOKING_INTERVAL_AMOUNT) {
    return { amount: diff, unit: 'days' };
  }
  const weeks = Math.max(1, Math.round(diff / 7));
  if (weeks <= MAX_FORWARD_BOOKING_INTERVAL_AMOUNT) {
    return { amount: weeks, unit: 'weeks' };
  }
  const months = Math.max(1, Math.round(diff / 30));
  return {
    amount: Math.min(months, MAX_FORWARD_BOOKING_INTERVAL_AMOUNT),
    unit: 'months',
  };
}

/** Care outreach book → routing defaults to today through 21 calendar days out (practice TZ). */
export function careOutreachRoutingSearchDateRange(practiceTz?: string): {
  startDate: string;
  endDate: string;
} {
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const today = DateTime.now().setZone(tz).startOf('day');
  return {
    startDate: today.toFormat('yyyy-MM-dd'),
    endDate: today.plus({ days: 21 }).toFormat('yyyy-MM-dd'),
  };
}

export type CareOutreachPatientBookTarget = {
  patientId: number;
  patientName: string;
  reminders: UnscheduledReminder[];
};

export type CareOutreachClientBookTarget = {
  clientId: number;
  displayName: string;
  phone: string | null;
  patients: CareOutreachPatientBookTarget[];
  primaryProviderId?: number;
};

export function careOutreachClientBookTargetFromBucket(
  clientId: number | null,
  displayName: string,
  phone: string | null,
  patients: Map<
    number,
    {
      patientName: string;
      reminders: UnscheduledReminder[];
    }
  >,
  assignedProviderId?: number | null
): CareOutreachClientBookTarget | null {
  if (clientId == null || !Number.isFinite(clientId)) return null;
  const bookPatients: CareOutreachPatientBookTarget[] = [];
  for (const [patientId, pg] of patients.entries()) {
    const visible = visibleReminders(pg.reminders);
    if (visible.length === 0) continue;
    bookPatients.push({
      patientId,
      patientName: pg.patientName,
      reminders: visible,
    });
  }
  if (bookPatients.length === 0) return null;
  const providerId =
    assignedProviderId != null && Number.isFinite(Number(assignedProviderId))
      ? Number(assignedProviderId)
      : undefined;
  return {
    clientId,
    displayName,
    phone,
    patients: bookPatients,
    ...(providerId != null ? { primaryProviderId: providerId } : {}),
  };
}

/** Add checked household pets (no outreach reminders) to a book target. */
export function careOutreachClientBookTargetWithAdditionalPatients(
  base: CareOutreachClientBookTarget | null,
  clientId: number,
  displayName: string,
  phone: string | null,
  primaryProviderId: number | undefined,
  additionalPatients: readonly Pick<CareOutreachPatientBookTarget, 'patientId' | 'patientName'>[]
): CareOutreachClientBookTarget | null {
  const existingIds = new Set(base?.patients.map((p) => p.patientId) ?? []);
  const merged: CareOutreachPatientBookTarget[] = [...(base?.patients ?? [])];
  for (const extra of additionalPatients) {
    if (existingIds.has(extra.patientId)) continue;
    merged.push({
      patientId: extra.patientId,
      patientName: extra.patientName,
      reminders: [],
    });
    existingIds.add(extra.patientId);
  }
  if (merged.length === 0) return null;
  return {
    clientId,
    displayName,
    phone,
    patients: merged,
    primaryProviderId: base?.primaryProviderId ?? primaryProviderId,
  };
}

function bookingNotesForPatient(reminders: readonly UnscheduledReminder[]): string {
  const services = [...new Set(visibleReminders(reminders).map((r) => r.description?.trim()).filter(Boolean))];
  if (services.length === 0) return `${CARE_OUTREACH_BOOKING_NOTES_PREFIX} (household)`;
  return `${CARE_OUTREACH_BOOKING_NOTES_PREFIX}: ${services.join('; ')}`;
}

/** Create one forward-booking row per patient (no source visit). */
export async function createForwardBookingsFromCareOutreach(
  target: CareOutreachClientBookTarget,
  practiceId: number
): Promise<ForwardBookingEntry[]> {
  const created: ForwardBookingEntry[] = [];
  for (const patient of target.patients) {
    const due = earliestDueIso(patient.reminders);
    const interval = careOutreachForwardBookingIntervalForDueDate(due);
    const payload = buildCreateForwardBookingPayloadFromPatient(
      patient.patientId,
      target.clientId,
      interval,
      practiceId,
      {
        bookingNotes: bookingNotesForPatient(patient.reminders),
        primaryProviderId: target.primaryProviderId ?? null,
      }
    );
    if (!payload) {
      throw new Error(`Could not create forward booking for ${patient.patientName}.`);
    }
    created.push(
      await createForwardBooking({
        ...payload,
        createdVia: 'care_outreach',
      })
    );
  }
  return created;
}

export function petNamesFromCareOutreachTarget(target: CareOutreachClientBookTarget): string[] {
  return target.patients.map((p) => p.patientName.trim()).filter(Boolean);
}

/** True when any visible reminder on the book/text target is past due. */
export function careOutreachTargetHasPastDueReminders(target: CareOutreachClientBookTarget): boolean {
  for (const patient of target.patients) {
    for (const r of visibleReminders(patient.reminders)) {
      const diff = calendarDayDiffFromToday(r.dueDate ?? null);
      if (diff !== null && diff < 0) return true;
    }
  }
  return false;
}
