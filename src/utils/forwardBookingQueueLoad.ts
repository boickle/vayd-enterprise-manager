import {
  fetchForwardBookings,
  fetchForwardBookingsPage,
  type ForwardBookingCreatedVia,
  type ForwardBookingEntry,
} from '../api/forwardBooking';

/** Sources triaged on their own Scheduling Tools tabs, not the Forward booking list. */
export const LIST_ORIGINATED_FORWARD_BOOKING_SOURCES: readonly ForwardBookingCreatedVia[] = [
  'care_outreach',
  'schedule_loader',
  'waitlist',
];

export const FORWARD_BOOKING_HISTORY_PAGE_SIZE = 1000;

/** Every pending row and every booked row whose visit has not started, all sources, never truncated. */
export function fetchActiveForwardBookings(practiceId: number): Promise<ForwardBookingEntry[]> {
  return fetchForwardBookings({ practiceId, statuses: ['pending', 'booked'] });
}

/** Most recently changed Complete / Removed rows for the Forward booking list. */
export function fetchForwardBookingHistory(practiceId: number, limit: number) {
  return fetchForwardBookingsPage({
    practiceId,
    statuses: ['complete', 'removed'],
    excludeCreatedVia: LIST_ORIGINATED_FORWARD_BOOKING_SOURCES,
    sort: 'recent',
    limit,
  });
}

export type ForwardBookingPageRows = {
  rows: ForwardBookingEntry[];
  /** More Complete / Removed rows exist past `historyLimit`. */
  historyHasMore: boolean;
};

export async function fetchForwardBookingPageRows(opts: {
  practiceId: number;
  /** Omit for views that never show Complete / Removed (Booked, On hold). */
  historyLimit?: number;
}): Promise<ForwardBookingPageRows> {
  const [active, history] = await Promise.all([
    fetchActiveForwardBookings(opts.practiceId),
    opts.historyLimit != null
      ? fetchForwardBookingHistory(opts.practiceId, opts.historyLimit)
      : Promise.resolve({ items: [] as ForwardBookingEntry[], hasMore: false }),
  ]);
  const seen = new Set<number>();
  const rows: ForwardBookingEntry[] = [];
  for (const row of [...active, ...history.items]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }
  return { rows, historyHasMore: history.hasMore };
}

/** Pending, unlinked row for this pet from one list source (waitlist / schedule loader). */
export function fetchPendingForwardBookingsForPatient(opts: {
  practiceId: number;
  clientId: number;
  patientId: number;
  createdVia: ForwardBookingCreatedVia;
}): Promise<ForwardBookingEntry[]> {
  return fetchForwardBookings({
    practiceId: opts.practiceId,
    statuses: ['pending'],
    createdVia: [opts.createdVia],
    clientId: opts.clientId,
    patientId: opts.patientId,
  });
}
