import type { ForwardBookingEntry } from '../api/forwardBooking';
import {
  forwardBookingClientHouseholdKey,
  resolveForwardBookingTargetDueDateIso,
} from './forwardBookingFromAppointment';
import { forwardBookingHasLinkedVisit } from './forwardBookingLinkedVisit';

function targetDueDayKey(entry: ForwardBookingEntry, practiceTz: string): string | null {
  const iso = resolveForwardBookingTargetDueDateIso(entry, practiceTz);
  if (!iso) return null;
  return iso.slice(0, 10);
}

function forwardBookingPatientSortName(entry: ForwardBookingEntry): string {
  const name = entry.patient?.name?.trim();
  return name || String(entry.patientId);
}

/** True when every entry shares the same practice-local target due date. */
export function forwardBookingEntriesShareTargetDueDate(
  entries: ForwardBookingEntry[],
  practiceTz: string
): boolean {
  if (entries.length < 2) return false;
  const keys = entries.map((e) => targetDueDayKey(e, practiceTz));
  const first = keys[0];
  if (!first) return false;
  return keys.every((k) => k === first);
}

/** Bookable rows in this household that share the entry's target due date. */
export function forwardBookingSameTargetBookablePeers(
  entry: ForwardBookingEntry,
  bookableEntries: ForwardBookingEntry[],
  practiceTz: string
): ForwardBookingEntry[] {
  const key = targetDueDayKey(entry, practiceTz);
  if (!key) return bookableEntries.filter((row) => row.id === entry.id);
  return bookableEntries.filter((row) => targetDueDayKey(row, practiceTz) === key);
}

/** First row in a same-target group — shows the shared Book (N) action. */
export function forwardBookingEntryIsSameTargetGroupBookLeader(
  entry: ForwardBookingEntry,
  bookableEntries: ForwardBookingEntry[],
  practiceTz: string
): boolean {
  const peers = forwardBookingSameTargetBookablePeers(entry, bookableEntries, practiceTz);
  if (peers.length < 2) return true;
  const sorted = [...peers].sort((a, b) =>
    forwardBookingPatientSortName(a).localeCompare(forwardBookingPatientSortName(b), undefined, {
      sensitivity: 'base',
    })
  );
  return sorted[0]?.id === entry.id;
}

export function forwardBookingGroupBookButtonLabel(count: number): string {
  return count >= 2 ? `Book (${count})` : 'Book';
}

export type ForwardBookingTargetDateGroup = {
  targetDayKey: string | null;
  entries: ForwardBookingEntry[];
};

/** Split household rows into shared cards by practice-local target due date. */
export function groupForwardBookingHouseholdEntriesByTargetDate(
  entries: ForwardBookingEntry[],
  practiceTz: string
): ForwardBookingTargetDateGroup[] {
  const groups: ForwardBookingTargetDateGroup[] = [];
  const indexByKey = new Map<string, number>();

  for (const entry of entries) {
    const targetDayKey = targetDueDayKey(entry, practiceTz);
    const mapKey = targetDayKey ?? `entry:${entry.id}`;
    let idx = indexByKey.get(mapKey);
    if (idx == null) {
      idx = groups.length;
      indexByKey.set(mapKey, idx);
      groups.push({ targetDayKey, entries: [] });
    }
    groups[idx].entries.push(entry);
  }

  return groups;
}

/** Rows staff can still route-book from the forward booking list. */
export function forwardBookingEntryIsQueueBookable(entry: ForwardBookingEntry): boolean {
  if (entry.status === 'removed' || entry.status === 'complete') return false;
  if (forwardBookingHasLinkedVisit(entry)) return false;
  return true;
}

export function forwardBookingHouseholdGroupBookableEntries(
  entries: ForwardBookingEntry[]
): ForwardBookingEntry[] {
  return entries.filter(forwardBookingEntryIsQueueBookable);
}

export function forwardBookingHouseholdCanBookAsGroup(
  entries: ForwardBookingEntry[],
  practiceTz: string
): boolean {
  const bookable = forwardBookingHouseholdGroupBookableEntries(entries);
  return bookable.length >= 2 && forwardBookingEntriesShareTargetDueDate(bookable, practiceTz);
}

export function forwardBookingEntriesInSameHousehold(
  entry: ForwardBookingEntry,
  all: ForwardBookingEntry[]
): ForwardBookingEntry[] {
  const key = forwardBookingClientHouseholdKey(entry);
  return all.filter((row) => forwardBookingClientHouseholdKey(row) === key);
}
