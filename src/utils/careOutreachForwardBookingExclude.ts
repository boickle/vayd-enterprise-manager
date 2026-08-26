import type { UnscheduledReminder } from '../api/careOutreach';
import {
  normalizeForwardBookingCreatedVia,
  removeForwardBooking,
  type ForwardBookingEntry,
} from '../api/forwardBooking';
import {
  forwardBookingEntryVisibleOnList,
  forwardBookingListTab,
  type BookedAppointmentMeta,
} from './forwardBookingListVisibility';
import type { AppointmentTypeCatalog } from './appointmentTypeSettings';
import { forwardBookingHasLinkedVisit } from './forwardBookingLinkedVisit';

export type ForwardBookingCareOutreachBlockOptions = {
  /** Rows tied to an in-progress Route from care outreach / schedule loader. */
  activeRoutingForwardBookingIds?: ReadonlySet<number>;
};

function listOriginatedForwardBookingBlocksCareOutreach(
  entry: ForwardBookingEntry,
  opts?: ForwardBookingCareOutreachBlockOptions,
): boolean {
  if (opts?.activeRoutingForwardBookingIds?.has(entry.id)) return true;
  return forwardBookingHasLinkedVisit(entry);
}

/** Unbooked care-outreach / schedule-loader rows left after abandoning Route (hidden on both lists). */
export function isOrphanedListOriginatedForwardBooking(entry: ForwardBookingEntry): boolean {
  const via = normalizeForwardBookingCreatedVia(entry.createdVia);
  if (via !== 'care_outreach' && via !== 'schedule_loader') return false;
  if (entry.status === 'removed' || entry.status === 'complete') return false;
  return !forwardBookingHasLinkedVisit(entry);
}

/** Remove stale list-originated rows so they do not accumulate in the database. */
export async function cleanupOrphanedListOriginatedForwardBookings(
  entries: readonly ForwardBookingEntry[],
  practiceId: number,
  preserveForwardBookingIds?: ReadonlySet<number>,
): Promise<number[]> {
  const removedIds: number[] = [];
  for (const entry of entries) {
    if (!isOrphanedListOriginatedForwardBooking(entry)) continue;
    if (preserveForwardBookingIds?.has(entry.id)) continue;
    try {
      await removeForwardBooking(entry.id, practiceId);
      removedIds.push(entry.id);
    } catch (err) {
      console.warn('[care-outreach] could not clean orphan forward booking', entry.id, err);
    }
  }
  return removedIds;
}

/** Patient ids whose reminders should be hidden on the care outreach list. */
export function forwardBookingPatientIdsActiveInQueue(
  entries: readonly ForwardBookingEntry[],
  practiceTz: string,
  bookedApptMeta?: Map<number, BookedAppointmentMeta> | null,
  catalog?: AppointmentTypeCatalog | null,
  opts?: ForwardBookingCareOutreachBlockOptions,
): Set<number> {
  const ids = new Set<number>();
  for (const row of entries) {
    if (!forwardBookingEntryVisibleOnList(row)) continue;

    const via = normalizeForwardBookingCreatedVia(row.createdVia);
    if (via === 'care_outreach' || via === 'schedule_loader') {
      if (!listOriginatedForwardBookingBlocksCareOutreach(row, opts)) continue;
      const pid = row.patientId;
      if (pid != null && Number.isFinite(Number(pid)) && Number(pid) > 0) {
        ids.add(Number(pid));
      }
      continue;
    }

    const tab = forwardBookingListTab(row, practiceTz, bookedApptMeta, catalog);
    if (tab === 'removed' || tab === 'complete') continue;
    const pid = row.patientId;
    if (pid != null && Number.isFinite(Number(pid)) && Number(pid) > 0) {
      ids.add(Number(pid));
    }
  }
  return ids;
}

export function careOutreachReminderBlockedByForwardBooking(
  reminder: UnscheduledReminder,
  blockedPatientIds: ReadonlySet<number>,
): boolean {
  if (blockedPatientIds.size === 0) return false;
  const pid = reminder.patient?.id;
  if (pid == null || !Number.isFinite(Number(pid))) return false;
  return blockedPatientIds.has(Number(pid));
}

export function filterCareOutreachRemindersForForwardBooking(
  reminders: readonly UnscheduledReminder[],
  blockedPatientIds: ReadonlySet<number>,
): UnscheduledReminder[] {
  if (blockedPatientIds.size === 0) return [...reminders];
  return reminders.filter(
    (r) => !careOutreachReminderBlockedByForwardBooking(r, blockedPatientIds),
  );
}
