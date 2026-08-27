import { HOLDS_PATH } from './holds-nav';
import type { ForwardBookingListTab } from './utils/forwardBookingListVisibility';

export type SchedulingToolTab = {
  path: string;
  label: string;
};

export const SCHEDULING_TOOLS_PATH_PREFIX = '/schedule/scheduling-tools';

/** Outreach queues — care outreach through schedule loader. */
export const SCHEDULING_TOOL_OUTREACH_TABS: SchedulingToolTab[] = [
  { path: 'care-outreach', label: 'Care outreach' },
  { path: 'forward-booking', label: 'Forward booking' },
  { path: 'texted-offers', label: 'Texted offers' },
  { path: 'schedule-loader', label: 'Schedule loader' },
  { path: 'waitlist', label: 'Waitlist' },
];

/** Workflow views after outreach — booked visits. */
export const SCHEDULING_TOOL_WORKFLOW_TABS: SchedulingToolTab[] = [
  { path: 'booked', label: 'Booked' },
];

/** Scheduling Tools tabs (holds board: /schedule/holds). */
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
  return search ? `${HOLDS_PATH}${search.startsWith('?') ? search : `?${search}`}` : HOLDS_PATH;
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
    tabPath === 'care-outreach' &&
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

/** After book, return to the outreach list the user came from (hold) or the Booked tab (real visit). */
export function schedulingReturnPathAfterBook(args: {
  isHold: boolean;
  origin?: 'care_outreach' | 'schedule_loader' | 'waitlist' | 'forward_booking';
  scheduleLoaderReturnHref?: string | null;
  waitlistReturnHref?: string | null;
}): string {
  if (args.isHold) {
    if (args.origin === 'care_outreach') {
      return `${SCHEDULING_TOOLS_PATH_PREFIX}/care-outreach`;
    }
    if (args.origin === 'schedule_loader') {
      const href = args.scheduleLoaderReturnHref?.trim();
      if (href) return href;
      return `${SCHEDULING_TOOLS_PATH_PREFIX}/schedule-loader`;
    }
    if (args.origin === 'waitlist') {
      const href = args.waitlistReturnHref?.trim();
      if (href) return href;
      return `${SCHEDULING_TOOLS_PATH_PREFIX}/waitlist`;
    }
    return `${SCHEDULING_TOOLS_PATH_PREFIX}/forward-booking`;
  }
  if (args.origin === 'waitlist') {
    const href = args.waitlistReturnHref?.trim();
    if (href) return href;
    return `${SCHEDULING_TOOLS_PATH_PREFIX}/waitlist`;
  }
  if (args.origin === 'forward_booking') {
    return `${SCHEDULING_TOOLS_PATH_PREFIX}/forward-booking`;
  }
  return schedulingWorkflowListPathAfterBook(false);
}
