import type { EmployeeRole } from '../api/appointmentSettings';

export function normalizeRoleNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

export function humanizeEmployeeRoleName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  return trimmed
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

export type EmployeeRoleNameGroup = {
  nameKey: string;
  displayName: string;
  roles: EmployeeRole[];
  roleIds: number[];
};

export function groupEmployeeRolesByName(roles: EmployeeRole[]): EmployeeRoleNameGroup[] {
  const map = new Map<string, EmployeeRole[]>();
  for (const role of roles) {
    const key = normalizeRoleNameKey(role.name);
    if (!key) continue;
    const list = map.get(key) ?? [];
    list.push(role);
    map.set(key, list);
  }

  return Array.from(map.entries())
    .map(([nameKey, list]) => {
      const sorted = [...list].sort((a, b) => a.id - b.id);
      const displayName = humanizeEmployeeRoleName(sorted[0]?.name ?? nameKey);
      return {
        nameKey,
        displayName,
        roles: sorted,
        roleIds: sorted.map((role) => role.id),
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));
}

export function isEmployeeRoleNameGroupSelected(
  group: EmployeeRoleNameGroup,
  selectedRoleIds: number[],
): boolean {
  const selected = new Set(selectedRoleIds);
  return group.roleIds.some((id) => selected.has(id));
}

export function toggleEmployeeRoleNameGroup(
  group: EmployeeRoleNameGroup,
  selectedRoleIds: number[],
  checked: boolean,
): number[] {
  const groupIds = new Set(group.roleIds);
  if (!checked) {
    return selectedRoleIds.filter((id) => !groupIds.has(id));
  }
  const next = new Set(selectedRoleIds);
  for (const id of groupIds) next.add(id);
  return Array.from(next).sort((a, b) => a - b);
}

/** Assign one canonical role id per name when enabling; remove all variants when disabling. */
export function assignEmployeeRoleNameGroup(
  group: EmployeeRoleNameGroup,
  selectedRoleIds: number[],
  checked: boolean,
): number[] {
  const groupIds = new Set(group.roleIds);
  if (!checked) {
    return selectedRoleIds.filter((id) => !groupIds.has(id));
  }
  if (group.roleIds.some((id) => selectedRoleIds.includes(id))) {
    return selectedRoleIds;
  }
  const canonicalId = group.roleIds[0];
  if (canonicalId == null) return selectedRoleIds;
  return [...selectedRoleIds, canonicalId].sort((a, b) => a - b);
}
