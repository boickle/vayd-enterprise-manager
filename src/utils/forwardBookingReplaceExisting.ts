import {
  createForwardBooking,
  fetchForwardBookings,
  removeForwardBooking,
  type CreateForwardBookingPayload,
  type ForwardBookingEntry,
} from '../api/forwardBooking';
import { formatForwardBookingIntervalLabel } from './forwardBookingFromAppointment';
import { forwardBookingHasLinkedVisit } from './forwardBookingLinkedVisit';

/** API rejects a second active queue row for the same source visit. */
export function isActiveForwardBookingExistsError(e: unknown): boolean {
  const ax = e as { response?: { data?: { message?: string | string[] } }; message?: string };
  const m = ax?.response?.data?.message;
  const text = Array.isArray(m) ? m.join(' ') : typeof m === 'string' ? m : ax?.message ?? '';
  return /active forward booking already exists/i.test(text);
}

/**
 * Pending queue rows without a linked calendar visit can be replaced when staff
 * re-adds from Add forward booking (e.g. change 3 months → ASAP / 1 week).
 */
export function isReplaceableActiveForwardBooking(entry: ForwardBookingEntry): boolean {
  if (entry.status === 'removed' || entry.status === 'complete') return false;
  if (forwardBookingHasLinkedVisit(entry)) return false;
  return entry.status === 'pending';
}

export function pickReplaceableForwardBookingForSourceVisit(
  entries: readonly ForwardBookingEntry[],
  sourceAppointmentId: number
): ForwardBookingEntry | null {
  if (!Number.isFinite(sourceAppointmentId) || sourceAppointmentId <= 0) return null;
  const matches = entries.filter(
    (e) =>
      e.sourceAppointmentId != null &&
      Number(e.sourceAppointmentId) === Number(sourceAppointmentId) &&
      isReplaceableActiveForwardBooking(e)
  );
  if (matches.length === 0) return null;
  return matches.sort((a, b) => Number(b.id) - Number(a.id))[0] ?? null;
}

export async function findReplaceableForwardBookingForSourceVisit(
  sourceAppointmentId: number,
  practiceId: number
): Promise<ForwardBookingEntry | null> {
  const list = await fetchForwardBookings({
    practiceId,
    limit: 500,
    includeRemoved: false,
  });
  return pickReplaceableForwardBookingForSourceVisit(list, sourceAppointmentId);
}

export function formatExistingForwardBookingReplaceHint(
  entry: Pick<ForwardBookingEntry, 'intervalAmount' | 'intervalUnit' | 'monthsOut'>
): string {
  const interval = formatForwardBookingIntervalLabel({
    intervalAmount: entry.intervalAmount,
    intervalUnit: entry.intervalUnit,
    monthsOut: entry.monthsOut,
  });
  if (interval === '—') {
    return 'This visit already has an active forward booking. Saving will update that list entry.';
  }
  return `This visit already has an active forward booking (${interval}). Saving will update that list entry.`;
}

/**
 * POST /forward-bookings; if the API reports an active row for this source visit,
 * remove the replaceable pending entry and create again with the new payload.
 * Preserves the existing contact-log `note` when the new payload omits `note`.
 */
export async function createForwardBookingReplacingSourceConflict(
  body: CreateForwardBookingPayload
): Promise<ForwardBookingEntry> {
  try {
    return await createForwardBooking(body);
  } catch (e: unknown) {
    if (!isActiveForwardBookingExistsError(e)) throw e;
    const sourceId = body.sourceAppointmentId;
    if (sourceId == null || !Number.isFinite(Number(sourceId)) || Number(sourceId) <= 0) {
      throw e;
    }
    const existing = await findReplaceableForwardBookingForSourceVisit(
      Number(sourceId),
      body.practiceId
    );
    if (!existing) throw e;
    await removeForwardBooking(existing.id, body.practiceId);
    const retryBody: CreateForwardBookingPayload = {
      ...body,
      note: body.note !== undefined ? body.note : existing.note ?? null,
    };
    return await createForwardBooking(retryBody);
  }
}
