import type { ForwardBookingListTab } from './utils/forwardBookingListVisibility';

export type SchedulingToolTab = {
  path: string;
  label: string;
};

export const SCHEDULING_TOOLS_PATH_PREFIX = '/schedule/scheduling-tools';

/** Outreach queues — care outreach through texted offers. */
export const SCHEDULING_TOOL_OUTREACH_TABS: SchedulingToolTab[] = [
  { path: 'care-outreach', label: 'Care outreach' },
  { path: 'schedule-loader', label: 'Schedule loader' },
  { path: 'forward-booking', label: 'Forward booking' },
  { path: 'texted-offers', label: 'Texted offers' },
];

/** Workflow views after outreach — calendar holds and booked visits. */
export const SCHEDULING_TOOL_WORKFLOW_TABS: SchedulingToolTab[] = [
  { path: 'on-hold', label: 'On hold' },
  { path: 'booked', label: 'Booked' },
];

/** Scheduling Tools tabs (appointment-request holds live under /schedule/appointments/on-hold). */
export const SCHEDULING_TOOL_TABS: SchedulingToolTab[] = [
  ...SCHEDULING_TOOL_OUTREACH_TABS,
  ...SCHEDULING_TOOL_WORKFLOW_TABS,
];

export const FORWARD_BOOKING_STATUS_PARAM = 'status';

/** Legacy Booked / Complete paths fold into top-level Booked / Forward booking. */
export const LEGACY_WORKFLOW_STATUS_BY_PATH: Record<
  string,
  Extract<ForwardBookingListTab, 'booked' | 'complete'>
> = {
  booked: 'booked',
  complete: 'complete',
};

export function bookedListPath(search = ''): string {
  const base = `${SCHEDULING_TOOLS_PATH_PREFIX}/booked`;
  return search ? `${base}${search.startsWith('?') ? search : `?${search}`}` : base;
}

export function onHoldListPath(search = ''): string {
  const base = `${SCHEDULING_TOOLS_PATH_PREFIX}/on-hold`;
  return search ? `${base}${search.startsWith('?') ? search : `?${search}`}` : base;
}

/** URL for a Forward booking status view (pending uses the bare path). */
export function forwardBookingStatusListPath(status: ForwardBookingListTab): string {
  if (status === 'onHold') return onHoldListPath();
  if (status === 'booked') return bookedListPath();
  const base = `${SCHEDULING_TOOLS_PATH_PREFIX}/forward-booking`;
  return status === 'pending' ? base : `${base}?${FORWARD_BOOKING_STATUS_PARAM}=${status}`;
}

export function schedulingToolsLink(base: string, segment: string): string {
  return `${base.replace(/\/$/, '')}/${segment}`;
}

export function isSchedulingToolTabActive(
  pathname: string,
  tabPath: string,
  search = ''
): boolean {
  const base = `${SCHEDULING_TOOLS_PATH_PREFIX}/${tabPath}`;
  if (pathname === base || pathname.startsWith(`${base}/`)) return true;
  if (
    tabPath === 'schedule-loader' &&
    (pathname === SCHEDULING_TOOLS_PATH_PREFIX || pathname === `${SCHEDULING_TOOLS_PATH_PREFIX}/`)
  ) {
    return true;
  }
  // Legacy Booked / Complete paths map to top-level Booked or forward-booking query.
  if (tabPath === 'booked') {
    for (const legacy of Object.keys(LEGACY_WORKFLOW_STATUS_BY_PATH)) {
      const legacyPath = `${SCHEDULING_TOOLS_PATH_PREFIX}/${legacy}`;
      if (pathname === legacyPath || pathname.startsWith(`${legacyPath}/`)) {
        return legacy === 'booked';
      }
    }
    const forwardBookingBooked =
      pathname === `${SCHEDULING_TOOLS_PATH_PREFIX}/forward-booking` &&
      new URLSearchParams(search).get(FORWARD_BOOKING_STATUS_PARAM) === 'booked';
    if (forwardBookingBooked) return true;
  }
  if (tabPath === 'forward-booking') {
    for (const legacy of Object.keys(LEGACY_WORKFLOW_STATUS_BY_PATH)) {
      if (legacy === 'booked') continue;
      const legacyPath = `${SCHEDULING_TOOLS_PATH_PREFIX}/${legacy}`;
      if (pathname === legacyPath || pathname.startsWith(`${legacyPath}/`)) return true;
    }
  }
  if (tabPath === 'on-hold') {
    const forwardBookingOnHold =
      pathname === `${SCHEDULING_TOOLS_PATH_PREFIX}/forward-booking` &&
      new URLSearchParams(search).get(FORWARD_BOOKING_STATUS_PARAM) === 'onHold';
    if (forwardBookingOnHold) return true;
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
