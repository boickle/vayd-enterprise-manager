// src/api/permissions.ts
// Practice permissions – GET /practice/:practiceId/permissions/me and the
// role-override / individual-grant editors behind Employee Settings.
//
// The server returns each held permission as `{ scope, source, sourceLabel }`.
// These functions flatten that into a scope map plus a parallel source map, so
// components can ask "can they?" without unpacking objects.
import { http } from './http';

/** How much of the data a permission reaches. */
export type PermissionScope = 'none' | 'own' | 'team' | 'all';

export const PERMISSION_SCOPES: PermissionScope[] = ['none', 'own', 'team', 'all'];

export type RoleSlug =
  | 'practice_admin'
  | 'practice_manager'
  | 'medical_director'
  | 'veterinarian'
  | 'relief_veterinarian'
  | 'lead_technician'
  | 'technician'
  | 'lead_client_liaison'
  | 'client_liaison'
  | 'inventory_manager'
  | 'billing_ar'
  | 'observer'
  | 'controlled_substances_director'
  | 'mail_order_manager'
  | 'mail_order_team'
  | 'executive';

export const ROLE_LABELS: Record<RoleSlug, string> = {
  practice_admin: 'Practice Admin',
  practice_manager: 'Practice Manager',
  medical_director: 'Medical Director',
  veterinarian: 'Veterinarian',
  relief_veterinarian: 'Relief Veterinarian',
  lead_technician: 'Lead Technician',
  technician: 'Technician',
  lead_client_liaison: 'Lead Client Liaison',
  client_liaison: 'Client Liaison',
  inventory_manager: 'Inventory Manager',
  billing_ar: 'Billing / AR',
  observer: 'Observer',
  controlled_substances_director: 'Controlled Substances Director',
  mail_order_manager: 'Mail Order Manager',
  mail_order_team: 'Mail Order Team Member',
  executive: 'Executive (read-only)',
};

export type EffectivePermissions = {
  employeeId: number | null;
  roles: RoleSlug[];
  isLicensed: boolean;
  licenseType: 'veterinarian' | 'technician' | null;
  isPlatformAdmin: boolean;
  /** Only keys the person actually holds; anything absent is `none`. */
  permissions: Record<string, PermissionScope>;
  /** Where each held permission came from, e.g. "veterinarian" or "Granted by Jane Doe". */
  sources: Record<string, string>;
};

export type PermissionCatalogEntry = {
  key: string;
  /** Section slug; look up the display name in `PermissionCatalog.sections`. */
  section: string;
  label: string;
  /** Shipped default scope per role. Roles absent here default to `none`. */
  roles: Partial<Record<RoleSlug, PermissionScope>>;
  /** Requires a typed reason, which is written to the audit log. */
  reason: boolean;
  /** License class required no matter what the role or grant says. */
  requiresLicense: 'any' | 'veterinarian' | null;
  /** False when the permission can never be handed out or re-tuned. */
  grantable: boolean;
  /** Scout has no screen for this action yet. */
  unbuilt: boolean;
  /** False when no API code checks this key yet, so switching it off changes nothing (RP-A7). Absent = enforced. */
  enforced?: boolean;
  note: string | null;
};

export type PermissionCatalog = {
  sections: Record<string, string>;
  roleSlugs: RoleSlug[];
  entries: PermissionCatalogEntry[];
};

export type EmployeePermissionGrant = {
  id: number;
  permissionKey: string;
  scope: PermissionScope;
  reason: string;
  grantedByName: string | null;
  expiresAt: string | null;
  created: string;
};

export type PermissionAuditEntry = {
  id: number;
  permissionKey: string;
  employeeId: number | null;
  employeeName: string | null;
  grantedBy: string | null;
  entityType: string | null;
  entityId: number | null;
  clientId: number | null;
  patientId: number | null;
  reason: string | null;
  amount: string | null;
  detail: Record<string, unknown> | null;
  created: string;
};

type ServerEffective = {
  employeeId: number | null;
  roleSlugs?: RoleSlug[];
  isLicensed?: boolean;
  licenseType?: string | null;
  isPlatformAdmin?: boolean;
  permissions?: Record<string, { scope: PermissionScope; sourceLabel?: string } | undefined>;
};

function normalizeEffective(raw: ServerEffective): EffectivePermissions {
  const permissions: Record<string, PermissionScope> = {};
  const sources: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw?.permissions ?? {})) {
    if (!value?.scope || value.scope === 'none') continue;
    permissions[key] = value.scope;
    if (value.sourceLabel) sources[key] = value.sourceLabel;
  }
  const licenseType =
    raw?.licenseType === 'veterinarian' || raw?.licenseType === 'technician'
      ? raw.licenseType
      : null;
  return {
    employeeId: raw?.employeeId ?? null,
    roles: raw?.roleSlugs ?? [],
    isLicensed: raw?.isLicensed === true,
    licenseType,
    isPlatformAdmin: raw?.isPlatformAdmin === true,
    permissions,
    sources,
  };
}

/** The signed-in user's effective permissions, already merged across all three layers. */
export async function fetchMyPermissions(practiceId: number): Promise<EffectivePermissions> {
  const { data } = await http.get<ServerEffective>(`/practice/${practiceId}/permissions/me`);
  return normalizeEffective(data);
}

export async function fetchPermissionCatalog(practiceId: number): Promise<PermissionCatalog> {
  const { data } = await http.get<{
    sections?: Record<string, string>;
    roleSlugs?: RoleSlug[];
    permissions?: PermissionCatalogEntry[];
  }>(`/practice/${practiceId}/permissions/catalog`);
  return {
    sections: data?.sections ?? {},
    roleSlugs: data?.roleSlugs ?? [],
    entries: Array.isArray(data?.permissions) ? data.permissions : [],
  };
}

export async function fetchPermissionAudit(
  practiceId: number,
  params: {
    from?: string;
    to?: string;
    permissionKeys?: string[];
    employeeId?: number;
    /** Changes made TO one record, e.g. entityType 'employee' with that person's id. */
    entityType?: string;
    entityId?: number;
    limit?: number;
  } = {}
): Promise<PermissionAuditEntry[]> {
  const { permissionKeys, ...rest } = params;
  const { data } = await http.get<PermissionAuditEntry[]>(
    `/practice/${practiceId}/permissions/audit`,
    { params: { ...rest, keys: permissionKeys?.join(',') || undefined } }
  );
  return Array.isArray(data) ? data : [];
}

export type RolePermissionDetail = {
  roleId: number;
  slug: RoleSlug;
  name: string;
  /** Shipped scope for every catalog key. */
  defaults: Record<string, PermissionScope>;
  /** Only the keys this practice has tuned away from the shipped default. */
  overrides: Record<string, PermissionScope>;
};

export async function fetchRolePermissions(
  practiceId: number,
  roleId: number
): Promise<RolePermissionDetail> {
  const { data } = await http.get<RolePermissionDetail>(
    `/practice/${practiceId}/roles/${roleId}/permissions`
  );
  return { ...data, defaults: data?.defaults ?? {}, overrides: data?.overrides ?? {} };
}

/**
 * Setting a key back to its shipped default removes the override, so the
 * practice picks up future catalog changes for it again.
 */
export async function saveRolePermissionOverrides(
  practiceId: number,
  roleId: number,
  changes: Record<string, PermissionScope>
): Promise<Record<string, PermissionScope>> {
  const { data } = await http.put<{ overrides?: Record<string, PermissionScope> }>(
    `/practice/${practiceId}/roles/${roleId}/permissions`,
    { changes }
  );
  return data?.overrides ?? {};
}

export type EmployeePermissionDetail = {
  effective: EffectivePermissions;
  grants: EmployeePermissionGrant[];
};

export async function fetchEmployeePermissions(
  practiceId: number,
  employeeId: number
): Promise<EmployeePermissionDetail> {
  const { data } = await http.get<ServerEffective & { grants?: EmployeePermissionGrant[] }>(
    `/practice/${practiceId}/employees/${employeeId}/permissions`
  );
  return {
    effective: normalizeEffective(data),
    grants: Array.isArray(data?.grants) ? data.grants : [],
  };
}

/** Grants are additive only — to take something away, change the person's role. */
export async function addEmployeePermissionGrant(
  practiceId: number,
  employeeId: number,
  body: {
    permissionKey: string;
    reason: string;
    scope?: PermissionScope;
    expiresAt?: string | null;
  }
): Promise<EmployeePermissionGrant> {
  const { data } = await http.post<EmployeePermissionGrant>(
    `/practice/${practiceId}/employees/${employeeId}/permissions/grants`,
    body
  );
  return data;
}

export async function removeEmployeePermissionGrant(
  practiceId: number,
  employeeId: number,
  permissionKey: string
): Promise<void> {
  await http.delete(
    `/practice/${practiceId}/employees/${employeeId}/permissions/grants/${encodeURIComponent(permissionKey)}`
  );
}

/** The license — not the role — is what allows signing and locking records. */
export async function saveEmployeeLicense(
  practiceId: number,
  employeeId: number,
  body: { isLicensed: boolean; licenseType: 'veterinarian' | 'technician' | null }
): Promise<void> {
  await http.put(`/practice/${practiceId}/employees/${employeeId}/permissions/license`, body);
}

/**
 * Offices where the signed-in user holds `key`: 'all', or branch ids. A role assigned to one
 * office (e.g. an inventory manager for her own location) counts only there.
 */
export async function fetchMyOffices(practiceId: number, key: string): Promise<number[] | 'all'> {
  const { data } = await http.get<{ offices: number[] | 'all' }>(
    `/practice/${practiceId}/permissions/offices`,
    { params: { key } }
  );
  return data?.offices === 'all' ? 'all' : Array.isArray(data?.offices) ? data.offices : [];
}

/** The audit action keys behind "recent changes" (role, license and grant changes). */
export const ACCESS_CHANGE_KEYS = [
  'staff.role.assign',
  'staff.license.manage',
  'staff.permission.grant',
];

export type AuditRoleRef = {
  roleId: number;
  slug: string | null;
  name: string;
  branchId: number | null;
  office: string | null;
};

function roleRefs(value: unknown): AuditRoleRef[] {
  return Array.isArray(value) ? (value as AuditRoleRef[]) : [];
}

function roleLabel(r: AuditRoleRef): string {
  return r.office ? `${r.name} (${r.office})` : r.name;
}

/** One plain sentence for a role, license or grant audit row about a person. */
export function describeAccessChange(
  entry: PermissionAuditEntry,
  labelOfKey: (key: string) => string = (k) => k
): string {
  const detail = (entry.detail ?? {}) as Record<string, unknown>;
  if (entry.permissionKey === 'staff.role.assign') {
    const before = roleRefs(detail.before);
    const after = roleRefs(detail.after);
    const keyOf = (r: AuditRoleRef) => `${r.roleId}:${r.branchId ?? 'all'}`;
    const was = new Set(before.map(keyOf));
    const now = new Set(after.map(keyOf));
    const added = after.filter((r) => !was.has(keyOf(r))).map(roleLabel);
    const removed = before.filter((r) => !now.has(keyOf(r))).map(roleLabel);
    const parts = [
      added.length ? `added ${added.join(', ')}` : '',
      removed.length ? `removed ${removed.join(', ')}` : '',
    ].filter(Boolean);
    return `Roles: ${parts.join('; ') || 'changed'}`;
  }
  if (entry.permissionKey === 'staff.license.manage') {
    const fmt = (v: unknown) => {
      const o = (v ?? {}) as { isLicensed?: boolean; licenseType?: string | null };
      return o.isLicensed ? (o.licenseType ?? 'licensed') : 'not licensed';
    };
    return `License: ${fmt(detail.before)} → ${fmt(detail.after)}`;
  }
  if (entry.permissionKey === 'staff.permission.grant') {
    const key = typeof detail.permissionKey === 'string' ? detail.permissionKey : '';
    return detail.action === 'revoke'
      ? `Grant removed: ${labelOfKey(key)}`
      : `Granted: ${labelOfKey(key)}`;
  }
  return labelOfKey(entry.permissionKey);
}

/**
 * Who was added to or removed from one role, from the role-change audit rows.
 * Each result names the person (by id, the caller looks up the name) and the office, if any.
 */
export function roleMembershipChanges(
  entries: PermissionAuditEntry[],
  roleId: number
): Array<{
  id: number;
  when: string;
  actor: string | null;
  targetId: number | null;
  kind: 'added' | 'removed';
  office: string | null;
}> {
  const out: ReturnType<typeof roleMembershipChanges> = [];
  for (const entry of entries) {
    if (entry.permissionKey !== 'staff.role.assign') continue;
    const detail = (entry.detail ?? {}) as Record<string, unknown>;
    const before = roleRefs(detail.before).filter((r) => r.roleId === roleId);
    const after = roleRefs(detail.after).filter((r) => r.roleId === roleId);
    const keyOf = (r: AuditRoleRef) => String(r.branchId ?? 'all');
    const was = new Set(before.map(keyOf));
    const now = new Set(after.map(keyOf));
    for (const r of after) {
      if (!was.has(keyOf(r)))
        out.push({ id: entry.id, when: entry.created, actor: entry.employeeName, targetId: entry.entityId, kind: 'added', office: r.office });
    }
    for (const r of before) {
      if (!now.has(keyOf(r)))
        out.push({ id: entry.id, when: entry.created, actor: entry.employeeName, targetId: entry.entityId, kind: 'removed', office: r.office });
    }
  }
  return out;
}
