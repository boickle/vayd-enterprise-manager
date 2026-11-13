import type { AppointmentRequestListTab } from '../../appointments-nav';

/**
 * The request tabs' counts and reply badges, as the Appointments list last worked them out. The
 * Hold tab doesn't load the requests, so its tab strip shows these (B2, Nov 13, 2026).
 */
export type AppointmentTabCounts = Partial<
  Record<AppointmentRequestListTab, { count?: number; mine: number; others: number }>
>;

const KEY = 'vayd:appointments-tab-counts';

export function rememberAppointmentTabCounts(counts: AppointmentTabCounts): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(counts));
  } catch {
    /* private mode or full: the strip shows no counts */
  }
}

export function readAppointmentTabCounts(): AppointmentTabCounts {
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as AppointmentTabCounts) : {};
  } catch {
    return {};
  }
}
