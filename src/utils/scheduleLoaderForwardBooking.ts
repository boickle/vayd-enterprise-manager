import {
  createForwardBooking,
  fetchForwardBookings,
  normalizeForwardBookingCreatedVia,
  type ForwardBookingEntry,
} from '../api/forwardBooking';
import type { FillDayCandidate, FillDayReminder } from '../api/routing';
import {
  careOutreachForwardBookingIntervalForDueDate,
} from './careOutreachForwardBooking';
import { buildCreateForwardBookingPayloadFromPatient } from './forwardBookingFromAppointment';
import { forwardBookingHasLinkedVisit } from './forwardBookingLinkedVisit';

export const SCHEDULE_LOADER_BOOKING_NOTES_PREFIX = 'Schedule loader follow-up';

function reminderIsHidden(r: FillDayReminder | Record<string, unknown>): boolean {
  const o = r as Record<string, unknown>;
  if (typeof o.is_hidden === 'boolean') return o.is_hidden;
  return (r as FillDayReminder).isHidden === true;
}

function visibleReminders(reminders: readonly FillDayReminder[]): FillDayReminder[] {
  return reminders.filter((r) => !reminderIsHidden(r));
}

function earliestDueIso(reminders: readonly FillDayReminder[]): string | null {
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

function bookingNotesForReminders(reminders: readonly FillDayReminder[]): string {
  const services = visibleReminders(reminders)
    .map((r) => r.description?.trim())
    .filter(Boolean);
  if (services.length === 0) return SCHEDULE_LOADER_BOOKING_NOTES_PREFIX;
  return `${SCHEDULE_LOADER_BOOKING_NOTES_PREFIX}: ${services.join('; ')}`;
}

type ScheduleLoaderPatientTarget = {
  patientId: number;
  patientName: string;
  reminders: FillDayReminder[];
};

function scheduleLoaderPatientTargets(candidate: FillDayCandidate): ScheduleLoaderPatientTarget[] {
  if (candidate.patients?.length) {
    const out: ScheduleLoaderPatientTarget[] = [];
    for (const patient of candidate.patients) {
      const visible = visibleReminders(patient.reminders ?? []);
      if (visible.length === 0) continue;
      out.push({
        patientId: patient.id,
        patientName: patient.name?.trim() || `Pet ${patient.id}`,
        reminders: visible,
      });
    }
    if (out.length > 0) return out;
  }

  const patientIds = candidate.patientIds ?? [];
  const patientNames = candidate.patientNames ?? [];
  const reminders = candidate.reminders ?? [];
  if (patientIds.length === 0) return [];

  const byPatient = new Map<number, FillDayReminder[]>();
  for (let i = 0; i < reminders.length; i += 1) {
    const reminder = reminders[i]!;
    if (reminderIsHidden(reminder)) continue;
    const patientId =
      i < patientIds.length
        ? Number(patientIds[i])
        : patientIds.length === 1
          ? Number(patientIds[0])
          : NaN;
    if (!Number.isFinite(patientId) || patientId <= 0) continue;
    const list = byPatient.get(patientId) ?? [];
    list.push(reminder);
    byPatient.set(patientId, list);
  }

  const out: ScheduleLoaderPatientTarget[] = [];
  for (const [patientId, patientReminders] of byPatient) {
    const idx = patientIds.findIndex((id) => Number(id) === patientId);
    out.push({
      patientId,
      patientName:
        (idx >= 0 ? patientNames[idx]?.trim() : '') ||
        candidate.patientName?.trim() ||
        `Pet ${patientId}`,
      reminders: patientReminders,
    });
  }
  return out;
}

async function findPendingScheduleLoaderForwardBooking(
  clientId: number,
  patientId: number,
  practiceId: number
): Promise<ForwardBookingEntry | null> {
  const list = await fetchForwardBookings({
    practiceId,
    limit: 500,
    includeRemoved: false,
  });
  const matches = list.filter(
    (e) =>
      Number(e.clientId) === Number(clientId) &&
      Number(e.patientId) === Number(patientId) &&
      normalizeForwardBookingCreatedVia(e.createdVia) === 'schedule_loader' &&
      e.status === 'pending' &&
      !forwardBookingHasLinkedVisit(e)
  );
  if (matches.length === 0) return null;
  return matches.sort((a, b) => Number(b.id) - Number(a.id))[0] ?? null;
}

/** Schedule loader Route → routing: single target day only (inclusive). */
export function scheduleLoaderRoutingSearchDateRange(targetDateYmd: string): {
  startDate: string;
  endDate: string;
  numDays: number;
} {
  const searchDate = targetDateYmd.trim();
  return { startDate: searchDate, endDate: searchDate, numDays: 1 };
}

/** Create or reuse forward-booking queue rows before schedule-loader calendar book. */
export async function createForwardBookingsFromScheduleLoader(
  candidate: FillDayCandidate,
  practiceId: number,
  opts?: { primaryProviderId?: number | null }
): Promise<ForwardBookingEntry[]> {
  const clientId = candidate.clientId;
  if (!Number.isFinite(Number(clientId)) || Number(clientId) <= 0) {
    throw new Error('Missing client for forward booking.');
  }

  const patients = scheduleLoaderPatientTargets(candidate);
  if (patients.length === 0) {
    throw new Error('No visible reminders to book for this client.');
  }

  const primaryProviderId =
    opts?.primaryProviderId != null && Number.isFinite(Number(opts.primaryProviderId))
      ? Number(opts.primaryProviderId)
      : undefined;

  const created: ForwardBookingEntry[] = [];
  for (const patient of patients) {
    const existing = await findPendingScheduleLoaderForwardBooking(
      clientId,
      patient.patientId,
      practiceId
    );
    if (existing) {
      created.push(existing);
      continue;
    }

    const interval = careOutreachForwardBookingIntervalForDueDate(
      earliestDueIso(patient.reminders)
    );
    const payload = buildCreateForwardBookingPayloadFromPatient(
      patient.patientId,
      clientId,
      interval,
      practiceId,
      {
        bookingNotes: bookingNotesForReminders(patient.reminders),
        primaryProviderId: primaryProviderId ?? null,
      }
    );
    if (!payload) {
      throw new Error(`Could not create forward booking for ${patient.patientName}.`);
    }
    created.push(
      await createForwardBooking({
        ...payload,
        createdVia: 'schedule_loader',
      })
    );
  }
  return created;
}

export function petNamesFromScheduleLoaderCandidate(candidate: FillDayCandidate): string[] {
  return scheduleLoaderPatientTargets(candidate).map((p) => p.patientName.trim()).filter(Boolean);
}

export function scheduleLoaderCandidateHasPastDueReminders(candidate: FillDayCandidate): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const patient of scheduleLoaderPatientTargets(candidate)) {
    for (const r of patient.reminders) {
      const due = r.dueDate?.trim();
      if (!due) continue;
      const ms = Date.parse(due);
      if (!Number.isFinite(ms)) continue;
      const dueDay = new Date(ms);
      dueDay.setHours(0, 0, 0, 0);
      if (dueDay.getTime() < today.getTime()) return true;
    }
  }
  return false;
}
