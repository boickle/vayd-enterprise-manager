import dayjs from 'dayjs';
import type { UnscheduledReminder } from '../api/careOutreach';
import { careOutreachReminderIsHidden } from './careOutreachReminderVisibility';

export { careOutreachReminderIsHidden } from './careOutreachReminderVisibility';

export function calendarDayDiffFromToday(dueIso: string | null | undefined): number | null {
  if (!dueIso) return null;
  const due = dayjs(dueIso).startOf('day');
  if (!due.isValid()) return null;
  return due.diff(dayjs().startOf('day'), 'day');
}

/**
 * "Due in 21 days" bucket: calendar day-diff from today to due date.
 * Anchor = today + 21 days. If that anchor is a Friday, include Sat/Sun too (diff 22 and 23).
 */
export function dayDiffsForDueIn21DayBucket(todayStart = dayjs().startOf('day')): Set<number> {
  const anchor = todayStart.add(21, 'day');
  if (anchor.day() === 5) {
    return new Set([21, 22, 23]);
  }
  return new Set([21]);
}

/** API date range that covers "newly overdue today" and "due in 21 days" buckets. */
export function careOutreachPriorityNavCountFetchRange(todayStart = dayjs().startOf('day')): {
  from: string;
  to: string;
} {
  const allowed = dayDiffsForDueIn21DayBucket(todayStart);
  const maxDue21 = Math.max(...allowed);
  return {
    from: todayStart.subtract(1, 'day').format('YYYY-MM-DD'),
    to: todayStart.add(maxDue21, 'day').format('YYYY-MM-DD'),
  };
}

export function careOutreachReminderInOverdueTodayBucket(
  r: UnscheduledReminder,
  todayStart = dayjs().startOf('day')
): boolean {
  const diff = calendarDayDiffFromToday(r.dueDate ?? null);
  return diff === -1;
}

export function careOutreachReminderInDue21Bucket(
  r: UnscheduledReminder,
  todayStart = dayjs().startOf('day')
): boolean {
  const diff = calendarDayDiffFromToday(r.dueDate ?? null);
  if (diff === null) return false;
  return dayDiffsForDueIn21DayBucket(todayStart).has(diff);
}

/** Past due within the last 30 calendar days (due date from 30 days ago through yesterday). */
export function careOutreachReminderInPastDue30DayBucket(
  r: UnscheduledReminder,
  todayStart = dayjs().startOf('day')
): boolean {
  const diff = calendarDayDiffFromToday(r.dueDate ?? null);
  if (diff === null) return false;
  return diff >= -30 && diff <= -1;
}

export function careOutreachReminderIsPastDue(dueIso: string | null | undefined): boolean {
  const diff = calendarDayDiffFromToday(dueIso);
  return diff !== null && diff < 0;
}

/** Stable client key for grouping outreach list rows and counting clients to contact. */
export function careOutreachReminderClientKey(r: UnscheduledReminder): string {
  const p = r.patient;
  const raw = p?.clients?.[0] ?? p?.client ?? null;
  if (raw?.id != null) return `c-${raw.id}`;
  return `orphan-p-${r.patient?.id ?? r.id}`;
}

function countUniqueCareOutreachClients(
  reminders: readonly UnscheduledReminder[],
  matches: (r: UnscheduledReminder, todayStart: dayjs.Dayjs) => boolean,
  todayStart = dayjs().startOf('day')
): number {
  const keys = new Set<string>();
  for (const r of reminders) {
    if (careOutreachReminderIsHidden(r)) continue;
    if (!matches(r, todayStart)) continue;
    keys.add(careOutreachReminderClientKey(r));
  }
  return keys.size;
}

/** Visible clients to contact in "newly overdue today" or "due in 21 days" buckets. */
export function countCareOutreachPriorityClients(
  reminders: readonly UnscheduledReminder[],
  todayStart = dayjs().startOf('day')
): number {
  return countUniqueCareOutreachClients(
    reminders,
    (r, start) =>
      careOutreachReminderInOverdueTodayBucket(r, start) ||
      careOutreachReminderInDue21Bucket(r, start),
    todayStart
  );
}

export type CareOutreachPriorityChipCounts = {
  overdue_today: number;
  due_21: number;
  past_due_30: number;
};

/** Date span that covers all daily-priority chip buckets. */
export function careOutreachChipCountFetchRange(todayStart = dayjs().startOf('day')): {
  from: string;
  to: string;
} {
  const allowed = dayDiffsForDueIn21DayBucket(todayStart);
  const maxDue21 = Math.max(...allowed);
  return {
    from: todayStart.subtract(30, 'day').format('YYYY-MM-DD'),
    to: todayStart.add(maxDue21, 'day').format('YYYY-MM-DD'),
  };
}

export function countCareOutreachPriorityChipClients(
  reminders: readonly UnscheduledReminder[],
  todayStart = dayjs().startOf('day')
): CareOutreachPriorityChipCounts {
  return {
    overdue_today: countUniqueCareOutreachClients(
      reminders,
      (r, start) => careOutreachReminderInOverdueTodayBucket(r, start),
      todayStart
    ),
    due_21: countUniqueCareOutreachClients(
      reminders,
      (r, start) => careOutreachReminderInDue21Bucket(r, start),
      todayStart
    ),
    past_due_30: countUniqueCareOutreachClients(
      reminders,
      (r, start) => careOutreachReminderInPastDue30DayBucket(r, start),
      todayStart
    ),
  };
}
