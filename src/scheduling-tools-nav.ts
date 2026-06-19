import type { ForwardBookingListTab } from './utils/forwardBookingListVisibility';

export type SchedulingToolTab = {
  path: string;
  label: string;
};

export type SchedulingWorkflowTab = {
  path: string;
  label: string;
  statusFilter: Extract<ForwardBookingListTab, 'onHold' | 'booked' | 'complete'>;
};

export const SCHEDULING_TOOLS_PATH_PREFIX = '/schedule/scheduling-tools';

export const SCHEDULING_TOOL_TABS: SchedulingToolTab[] = [
  { path: 'schedule-loader', label: 'Schedule loader' },
  { path: 'care-outreach', label: 'Care outreach' },
  { path: 'forward-booking', label: 'Forward booking' },
];

export const SCHEDULING_WORKFLOW_TABS: SchedulingWorkflowTab[] = [
  { path: 'on-hold', label: 'On Hold', statusFilter: 'onHold' },
  { path: 'booked', label: 'Booked', statusFilter: 'booked' },
  { path: 'complete', label: 'Complete', statusFilter: 'complete' },
];

export function schedulingToolsLink(base: string, segment: string): string {
  return `${base.replace(/\/$/, '')}/${segment}`;
}

export function isSchedulingToolTabActive(pathname: string, tabPath: string): boolean {
  if (SCHEDULING_WORKFLOW_TABS.some((t) => t.path === tabPath)) return false;
  const base = `${SCHEDULING_TOOLS_PATH_PREFIX}/${tabPath}`;
  if (pathname === base || pathname.startsWith(`${base}/`)) return true;
  if (
    tabPath === 'schedule-loader' &&
    (pathname === SCHEDULING_TOOLS_PATH_PREFIX || pathname === `${SCHEDULING_TOOLS_PATH_PREFIX}/`)
  ) {
    return true;
  }
  return false;
}

export function isSchedulingWorkflowTabActive(pathname: string, tabPath: string): boolean {
  const base = `${SCHEDULING_TOOLS_PATH_PREFIX}/${tabPath}`;
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function isSchedulingWorkflowPath(pathname: string): boolean {
  return SCHEDULING_WORKFLOW_TABS.some((tab) => isSchedulingWorkflowTabActive(pathname, tab.path));
}

export function workflowPathForStatusFilter(
  status: Extract<ForwardBookingListTab, 'onHold' | 'booked' | 'complete'>
): string {
  const tab = SCHEDULING_WORKFLOW_TABS.find((t) => t.statusFilter === status);
  return tab
    ? `${SCHEDULING_TOOLS_PATH_PREFIX}/${tab.path}`
    : `${SCHEDULING_TOOLS_PATH_PREFIX}/forward-booking`;
}

export function schedulingWorkflowListPathAfterBook(isHold: boolean): string {
  return isHold ? workflowPathForStatusFilter('onHold') : workflowPathForStatusFilter('booked');
}
