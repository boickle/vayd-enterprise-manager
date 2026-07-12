export type CareOutreachPriorityFilter = 'range' | 'overdue_today' | 'past_due_30' | 'due_21';

export type CareOutreachFilterSession = {
  priority: CareOutreachPriorityFilter;
  dueDateFrom: string;
  dueDateTo: string;
};

export const CARE_OUTREACH_FILTER_SESSION_KEY = 'vayd:care-outreach-filter-v1';

const PRIORITY_VALUES: readonly CareOutreachPriorityFilter[] = [
  'range',
  'overdue_today',
  'past_due_30',
  'due_21',
];

function isPriority(value: unknown): value is CareOutreachPriorityFilter {
  return typeof value === 'string' && PRIORITY_VALUES.includes(value as CareOutreachPriorityFilter);
}

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Persisted Care Outreach filter state so the tab/date range survive navigating away and back. */
export function readCareOutreachFilterSession(): CareOutreachFilterSession | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CARE_OUTREACH_FILTER_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CareOutreachFilterSession>;
    if (!isPriority(parsed.priority)) return null;
    if (!isDateString(parsed.dueDateFrom) || !isDateString(parsed.dueDateTo)) return null;
    return {
      priority: parsed.priority,
      dueDateFrom: parsed.dueDateFrom,
      dueDateTo: parsed.dueDateTo,
    };
  } catch {
    return null;
  }
}

export function writeCareOutreachFilterSession(session: CareOutreachFilterSession): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(CARE_OUTREACH_FILTER_SESSION_KEY, JSON.stringify(session));
  } catch {
    /* quota */
  }
}

export function clearCareOutreachFilterSession(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(CARE_OUTREACH_FILTER_SESSION_KEY);
  } catch {
    /* ignore */
  }
}
