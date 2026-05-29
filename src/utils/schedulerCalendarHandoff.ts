/**
 * Practice calendar date/view handoff — keeps the week in sync when opening
 * `/schedule/routing` from the practice calendar (separate Scheduler instances).
 */
import { DateTime } from 'luxon';

export const SCHEDULER_CALENDAR_HANDOFF_KEY = 'vayd:scheduler-calendar-handoff-v1';

export type SchedulerCalendarView = 'day' | 'week' | 'month';

export type SchedulerCalendarHandoffV1 = {
  version: 1;
  anchorDate: string;
  view?: SchedulerCalendarView;
  providerFilter?: string;
};

function isValidPracticeDate(iso: string): boolean {
  return DateTime.fromISO(iso).isValid;
}

export function readSchedulerCalendarHandoff(): SchedulerCalendarHandoffV1 | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SCHEDULER_CALENDAR_HANDOFF_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<SchedulerCalendarHandoffV1>;
    if (p?.version !== 1) return null;
    const anchorDate = String(p.anchorDate ?? '').trim();
    if (!anchorDate || !isValidPracticeDate(anchorDate)) return null;
    const view =
      p.view === 'day' || p.view === 'week' || p.view === 'month' ? p.view : undefined;
    const providerFilter =
      typeof p.providerFilter === 'string' ? p.providerFilter.trim() : undefined;
    return { version: 1, anchorDate, view, providerFilter };
  } catch {
    return null;
  }
}

export function writeSchedulerCalendarHandoff(patch: {
  anchorDate: string;
  view: SchedulerCalendarView;
  providerFilter: string;
}): void {
  if (typeof sessionStorage === 'undefined') return;
  const anchorDate = patch.anchorDate.trim();
  if (!anchorDate || !isValidPracticeDate(anchorDate)) return;
  try {
    const payload: SchedulerCalendarHandoffV1 = {
      version: 1,
      anchorDate,
      view: patch.view,
      providerFilter: patch.providerFilter.trim() || undefined,
    };
    sessionStorage.setItem(SCHEDULER_CALENDAR_HANDOFF_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}
