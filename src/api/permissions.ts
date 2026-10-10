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
  | 'observer';

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
  /** Licence class required no matter what the role or grant says. */
  requiresLicense: 'any' | 'veterinarian' | null;
  /** False when the permission can never be handed out or re-tuned. */
  grantable: boolean;
  /** Scout has no screen for this action yet. */
  unbuilt: boolean;
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

/** The licence — not the role — is what allows signing and locking records. */
export async function saveEmployeeLicense(
  practiceId: number,
  employeeId: number,
  body: { isLicensed: boolean; licenseType: 'veterinarian' | 'technician' | null }
): Promise<void> {
  await http.put(`/practice/${practiceId}/employees/${employeeId}/permissions/license`, body);
}
