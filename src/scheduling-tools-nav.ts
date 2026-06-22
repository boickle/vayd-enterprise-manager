import type { ForwardBookingListTab } from './utils/forwardBookingListVisibility';

export type SchedulingToolTab = {
  path: string;
  label: string;
};

export const SCHEDULING_TOOLS_PATH_PREFIX = '/schedule/scheduling-tools';

/** Top-level Scheduling Tools tabs. Forward-booking lifecycle statuses live as pills inside Forward booking. */
export const SCHEDULING_TOOL_TABS: SchedulingToolTab[] = [
  { path: 'schedule-loader', label: 'Schedule loader' },
  { path: 'care-outreach', label: 'Care outreach' },
  { path: 'forward-booking', label: 'Forward booking' },
  { path: 'texted-offers', label: 'Texted offers' },
  { path: 'appointments', label: 'Appointments' },
];

export const FORWARD_BOOKING_STATUS_PARAM = 'status';

/** Legacy standalone workflow tab paths now fold into Forward booking via ?status=. */
export const LEGACY_WORKFLOW_STATUS_BY_PATH: Record<
  string,
  Extract<ForwardBookingListTab, 'onHold' | 'booked' | 'complete'>
> = {
  'on-hold': 'onHold',
  booked: 'booked',
  complete: 'complete',
};

/** URL for a Forward booking status view (pending uses the bare path). */
export function forwardBookingStatusListPath(status: ForwardBookingListTab): string {
  const base = `${SCHEDULING_TOOLS_PATH_PREFIX}/forward-booking`;
  return status === 'pending' ? base : `${base}?${FORWARD_BOOKING_STATUS_PARAM}=${status}`;
}

export function schedulingToolsLink(base: string, segment: string): string {
  return `${base.replace(/\/$/, '')}/${segment}`;
}

export function isSchedulingToolTabActive(pathname: string, tabPath: string): boolean {
  const base = `${SCHEDULING_TOOLS_PATH_PREFIX}/${tabPath}`;
  if (pathname === base || pathname.startsWith(`${base}/`)) return true;
  if (
    tabPath === 'schedule-loader' &&
    (pathname === SCHEDULING_TOOLS_PATH_PREFIX || pathname === `${SCHEDULING_TOOLS_PATH_PREFIX}/`)
  ) {
    return true;
  }
  // Legacy On Hold / Booked / Complete paths are part of Forward booking now.
  if (tabPath === 'forward-booking') {
    for (const legacy of Object.keys(LEGACY_WORKFLOW_STATUS_BY_PATH)) {
      const legacyPath = `${SCHEDULING_TOOLS_PATH_PREFIX}/${legacy}`;
      if (pathname === legacyPath || pathname.startsWith(`${legacyPath}/`)) return true;
    }
  }
  return false;
}

export function workflowPathForStatusFilter(
  status: Extract<ForwardBookingListTab, 'onHold' | 'booked' | 'complete'>
): string {
  return forwardBookingStatusListPath(status);
}

export function schedulingWorkflowListPathAfterBook(isHold: boolean): string {
  return workflowPathForStatusFilter(isHold ? 'onHold' : 'booked');
}
