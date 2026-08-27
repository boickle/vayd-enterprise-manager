import {
  createForwardBooking,
  fetchForwardBookings,
  normalizeForwardBookingCreatedVia,
  patchForwardBooking,
  type ForwardBookingEntry,
} from '../api/forwardBooking';
import type { WaitlistEntry } from '../api/waitlist';
import { careOutreachForwardBookingIntervalForDueDate } from './careOutreachForwardBooking';
import { buildCreateForwardBookingPayloadFromPatient } from './forwardBookingFromAppointment';
import { forwardBookingHasLinkedVisit } from './forwardBookingLinkedVisit';
import { DateTime } from 'luxon';
import { practiceTimeZoneOrDefault } from './practiceTimezone';

export const WAITLIST_BOOKING_NOTES_PREFIX = 'Waitlist follow-up';

function waitlistPatients(entry: WaitlistEntry): { patientId: number; patientName: string }[] {
  const fromPatients = (entry.patients ?? [])
    .map((p) => ({
      patientId: Number(p.id),
      patientName: p.name?.trim() || `Pet ${p.id}`,
    }))
    .filter((p) => Number.isFinite(p.patientId) && p.patientId > 0);
  if (fromPatients.length > 0) return fromPatients;
  return (entry.patientIds ?? [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0)
    .map((patientId) => ({ patientId, patientName: `Pet ${patientId}` }));
}

async function findPendingWaitlistForwardBooking(
  clientId: number,
  patientId: number,
  practiceId: number,
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
      normalizeForwardBookingCreatedVia(e.createdVia) === 'waitlist' &&
      e.status === 'pending' &&
      !forwardBookingHasLinkedVisit(e),
  );
  if (matches.length === 0) return null;
  return matches.sort((a, b) => Number(b.id) - Number(a.id))[0] ?? null;
}

export function waitlistRoutingSearchDateRange(
  targetDateYmd: string | null | undefined,
  practiceTz?: string,
): { startDate: string; endDate: string; numDays: number } {
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const today = DateTime.now().setZone(tz).startOf('day');
  const target = targetDateYmd?.trim()
    ? DateTime.fromISO(targetDateYmd.trim(), { zone: tz }).startOf('day')
    : null;
  if (target?.isValid) {
    const ymd = target.toFormat('yyyy-MM-dd');
    return { startDate: ymd, endDate: ymd, numDays: 1 };
  }
  const startDate = today.toFormat('yyyy-MM-dd');
  const endDate = today.plus({ days: 14 }).toFormat('yyyy-MM-dd');
  return { startDate, endDate, numDays: 15 };
}

export async function createForwardBookingsFromWaitlist(
  entry: WaitlistEntry,
  practiceId: number,
  opts?: { primaryProviderId?: number | null; targetDateYmd?: string | null },
): Promise<ForwardBookingEntry[]> {
  const clientId = Number(entry.clientId);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    throw new Error('Missing client for waitlist routing.');
  }
  const patients = waitlistPatients(entry);
  if (patients.length === 0) {
    throw new Error('Select at least one pet on this waitlist entry.');
  }

  const primaryProviderId =
    opts?.primaryProviderId != null && Number.isFinite(Number(opts.primaryProviderId))
      ? Number(opts.primaryProviderId)
      : entry.preferredProviderId != null && Number.isFinite(Number(entry.preferredProviderId))
        ? Number(entry.preferredProviderId)
        : undefined;

  const targetIso = opts?.targetDateYmd?.trim()
    ? DateTime.fromISO(opts.targetDateYmd.trim()).toISO()
    : entry.preferredEndDate?.trim() || null;
  const interval = careOutreachForwardBookingIntervalForDueDate(targetIso);
  const note = entry.notes?.trim() || null;
  const typeLabel = entry.appointmentTypeName?.trim();
  const bookingNotes = typeLabel
    ? `${WAITLIST_BOOKING_NOTES_PREFIX}: ${typeLabel}`
    : WAITLIST_BOOKING_NOTES_PREFIX;

  const created: ForwardBookingEntry[] = [];
  for (const patient of patients) {
    const existing = await findPendingWaitlistForwardBooking(clientId, patient.patientId, practiceId);
    if (existing) {
      if (note && note !== (existing.note?.trim() ?? '')) {
        created.push(
          await patchForwardBooking(existing.id, {
            practiceId,
            note,
          }),
        );
      } else {
        created.push(existing);
      }
      continue;
    }
    const payload = buildCreateForwardBookingPayloadFromPatient(
      patient.patientId,
      clientId,
      interval,
      practiceId,
      {
        bookingNotes,
        note,
        primaryProviderId: primaryProviderId ?? null,
      },
    );
    if (!payload) {
      throw new Error(`Could not create forward booking for ${patient.patientName}.`);
    }
    created.push(
      await createForwardBooking({
        ...payload,
        createdVia: 'waitlist',
        ...(entry.appointmentTypeId != null ? { appointmentTypeId: entry.appointmentTypeId } : {}),
        ...(entry.serviceMinutes != null ? { serviceMinutes: entry.serviceMinutes } : {}),
      }),
    );
  }
  return created;
}
