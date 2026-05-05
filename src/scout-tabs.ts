// Sub-routes under /scout (Routing, My Day, My Week, Scheduling Tools, Room Loader).

export type ScoutTabId = 'routing' | 'my-day' | 'my-week' | 'scheduling-tools' | 'room-loader';

export type ScoutTabConfig = {
  id: ScoutTabId;
  /** URL segment under /scout */
  path: string;
  label: string;
  /** If set, `getAccessiblePages`-style abilities must include this permission. */
  permission?: string;
};

export const SCOUT_TABS: ScoutTabConfig[] = [
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

function permissionOk(perm: string | undefined, abilities?: string[]): boolean {
  if (!perm) return true;
  if (!abilities || abilities.length === 0) return true;
  return abilities.includes(perm);
}

/** Tabs the current user should see in the Scout menu. */
export function getVisibleScoutTabs(abilities?: string[], roles?: string[]): ScoutTabConfig[] {
  const userRoles = (roles ?? []).map((r) => String(r).toLowerCase().trim()).filter(Boolean);
  if (!matchesRole(userRoles)) return [];
  return SCOUT_TABS.filter((tab) => permissionOk(tab.permission, abilities));
}

/** First path segment (e.g. `routing`) for default redirect. */
export function getFirstScoutSegment(abilities?: string[], roles?: string[]): string {
  const visible = getVisibleScoutTabs(abilities, roles);
  return visible[0]?.path ?? 'routing';
}
