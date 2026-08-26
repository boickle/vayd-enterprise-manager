import {
  completeForwardBooking,
  fetchForwardBookingFutureAppointments,
  type ForwardBookingEntry,
} from '../api/forwardBooking';
import { pickForwardBookingAutoLinkAppointmentId } from './forwardBookingAutoLinkMatch';
import { forwardBookingIsBookLater } from './forwardBookingBookLater';
import { ensureForwardBookingServerLink } from './forwardBookingBookComplete';
import {
  forwardBookingHasLinkedVisit,
  mergeForwardBookingLinkedVisit,
} from './forwardBookingLinkedVisit';
import { readForwardBookingLocalLink } from './forwardBookingLocalLinks';
import { resolveForwardBookingTargetDueDateIso } from './forwardBookingFromAppointment';

const DEFAULT_AUTO_LINK_MAX = 20;

function pendingUnlinked(entry: ForwardBookingEntry, practiceTz: string): boolean {
  if (entry.status === 'removed' || entry.status === 'complete') return false;
  if (forwardBookingHasLinkedVisit(entry)) return false;
  if (forwardBookingIsBookLater(entry, practiceTz)) return false;
  return entry.status === 'pending';
}

/** Persist sessionStorage links to the server so refresh keeps booked / on-hold rows. */
export async function persistLocalForwardBookingLinks(
  entries: ForwardBookingEntry[]
): Promise<ForwardBookingEntry[]> {
  let list = entries;
  for (const entry of entries) {
    if (entry.status === 'booked' || entry.status === 'complete') continue;
    const local = readForwardBookingLocalLink(entry.id);
    if (!local) continue;
    const merged = mergeForwardBookingLinkedVisit(entry, {
      bookedAppointmentId: local.bookedAppointmentId,
      bookedAppointmentStart: local.bookedAppointmentStart,
      bookedAppointmentEnd: local.bookedAppointmentEnd ?? null,
    });
    try {
      const synced = await ensureForwardBookingServerLink(merged);
      list = list.map((row) => (row.id === synced.id ? synced : row));
    } catch {
      list = list.map((row) => (row.id === merged.id ? merged : row));
    }
  }
  return list;
}

/**
 * When a calendar visit exists but POST …/complete never ran, link the row when a future
 * appointment falls near this entry's target due date (not unrelated visits farther out).
 */
export async function autoLinkUnlinkedForwardBookings(
  entries: ForwardBookingEntry[],
  practiceId: number,
  practiceTz: string,
  opts?: { maxAttempts?: number }
): Promise<ForwardBookingEntry[]> {
  const maxAttempts = opts?.maxAttempts ?? DEFAULT_AUTO_LINK_MAX;
  const candidates = entries
    .filter((e) => pendingUnlinked(e, practiceTz))
    .sort((a, b) => {
      const aIso = resolveForwardBookingTargetDueDateIso(a, practiceTz) ?? '';
      const bIso = resolveForwardBookingTargetDueDateIso(b, practiceTz) ?? '';
      return aIso.localeCompare(bIso);
    })
    .slice(0, maxAttempts);

  if (candidates.length === 0) return entries;

  const updated = new Map<number, ForwardBookingEntry>();
  await Promise.all(
    candidates.map(async (entry) => {
      try {
        const future = await fetchForwardBookingFutureAppointments(entry.id, {
          practiceId,
          asOf: new Date().toISOString(),
        });
        const apptId = pickForwardBookingAutoLinkAppointmentId(entry, future, practiceTz);
        if (apptId == null) return;
        const linked = await completeForwardBooking(entry.id, {
          appointmentId: apptId,
          completedVia: 'manual',
        });
        updated.set(entry.id, linked);
      } catch {
        /* keep row pending */
      }
    })
  );

  if (updated.size === 0) return entries;
  return entries.map((row) => updated.get(row.id) ?? row);
}
