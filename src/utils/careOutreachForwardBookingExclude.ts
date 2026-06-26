import type { UnscheduledReminder } from '../api/careOutreach';
import type { ForwardBookingEntry } from '../api/forwardBooking';
import {
  forwardBookingEntryVisibleOnList,
  forwardBookingListTab,
  type BookedAppointmentMeta,
} from './forwardBookingListVisibility';
import type { AppointmentTypeCatalog } from './appointmentTypeSettings';

/** Patient ids with an active forward-booking row (not complete / removed). */
export function forwardBookingPatientIdsActiveInQueue(
  entries: readonly ForwardBookingEntry[],
  practiceTz: string,
  bookedApptMeta?: Map<number, BookedAppointmentMeta> | null,
  catalog?: AppointmentTypeCatalog | null,
): Set<number> {
  const ids = new Set<number>();
  for (const row of entries) {
    if (!forwardBookingEntryVisibleOnList(row)) continue;
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
