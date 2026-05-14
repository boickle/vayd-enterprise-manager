// Sub-routes under /schedule (was /scout): Home dashboard, Routing, My Day, My Week, Scheduling Tools, Room Loader.

export type ScoutTabId = 'home' | 'routing' | 'my-day' | 'my-week' | 'scheduling-tools' | 'room-loader';

export type ScoutTabConfig = {
  id: ScoutTabId;
  /** URL segment under /schedule */
  path: string;
  label: string;
  /** If set, `getAccessiblePages`-style abilities must include this permission. */
  permission?: string;
};

/** Valid `/schedule/:segment` outlets not listed in SCOUT_TABS (e.g. calendar only). */
export const SCHEDULE_OUTLET_EXTRA_SEGMENTS: string[] = [
  'scheduler',
  'inventory',
  'tasks',
  'clients',
  'patients',
  'settings',
  'admin',
  'analytics',
];

export const SCOUT_TABS: ScoutTabConfig[] = [
  { id: 'home', path: 'home', label: 'Home' },
  { id: 'routing', path: 'routing', label: 'Routing', permission: 'canSeeRouting' },
  { id: 'my-day', path: 'my-day', label: 'My Day', permission: 'canSeeDoctorDay' },
  { id: 'my-week', path: 'my-week', label: 'My Week', permission: 'canSeeDoctorDay' },
  { id: 'scheduling-tools', path: 'scheduling-tools', label: 'Scheduling Tools' },
  { id: 'room-loader', path: 'room-loader', label: 'Room Loader' },
];

function matchesRole(userRoles: string[]): boolean {
  if (userRoles.includes('superadmin')) return true;
  return ['employee', 'admin', 'superadmin'].some((r) => userRoles.includes(r));
}

/** Same rule as `ScoutTabConfig.permission` (used by hub tabs and Scheduling menu extras). */
export function scoutTabPermissionOk(perm: string | undefined, abilities?: string[]): boolean {
  if (!perm) return true;
  if (!abilities || abilities.length === 0) return true;
  return abilities.includes(perm);
}

/** Legacy full-page My Week (`/schedule/my-week`) — tab config kept for future use; hidden from nav in favor of Practice calendar (`/schedule/scheduler`). */
export const SHOW_MY_WEEK_SCOUT_TAB = false;

/** Tabs the current user should see in the Schedule hub. */
export function getVisibleScoutTabs(abilities?: string[], roles?: string[]): ScoutTabConfig[] {
  const userRoles = (roles ?? []).map((r) => String(r).toLowerCase().trim()).filter(Boolean);
  if (!matchesRole(userRoles)) return [];
  return SCOUT_TABS.filter((tab) => {
    if (!SHOW_MY_WEEK_SCOUT_TAB && tab.id === 'my-week') return false;
    return scoutTabPermissionOk(tab.permission, abilities);
  });
}

/** First path segment under /schedule (Home dashboard when available). */
export function getFirstScheduleSegment(abilities?: string[], roles?: string[]): string {
  return getFirstScoutSegment(abilities, roles);
}

/** First path segment (e.g. `home`, `routing`) for default redirect. */
export function getFirstScoutSegment(abilities?: string[], roles?: string[]): string {
  const visible = getVisibleScoutTabs(abilities, roles);
  return visible[0]?.path ?? 'home';
}
