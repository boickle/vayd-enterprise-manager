/** Normalize roles from JWT / user payload to lowercase strings. */
export function normalizeAuthRoles(role: string | string[] | undefined | null): string[] {
  if (!role) return [];
  const arr = Array.isArray(role) ? role : [role];
  return arr.map((r) => String(r).toLowerCase().trim()).filter(Boolean);
}

export function isAnalyticsAdmin(roles: string[]): boolean {
  return roles.some((r) => r === 'admin' || r === 'superadmin');
}

/**
 * Staff with the employee role who are not admin/superadmin get a restricted analytics view:
 * practice-wide totals are allowed; per-doctor breakdowns are limited to assigned doctors.
 */
export function isEmployeeAnalyticsRestricted(roles: string[]): boolean {
  if (isAnalyticsAdmin(roles)) return false;
  return roles.includes('employee');
}

/** Collect doctor / provider ids assigned to the user (supports several API shapes). */
export function collectAssignedDoctorIds(user: Record<string, unknown> | null | undefined): string[] {
  const ids = new Set<string>();
  const push = (v: unknown) => {
    if (v == null) return;
    if (Array.isArray(v)) {
      v.forEach(push);
      return;
    }
    const s = String(v).trim();
    if (s) ids.add(s);
  };
  if (!user || typeof user !== 'object') return [];
  const u = user as Record<string, unknown>;
  push(u.doctorId);
  push(u.doctorIds);
  push(u.assignedDoctorIds);
  push(u.doctorIDList);
  if (Array.isArray(u.doctors)) {
    for (const d of u.doctors) {
      if (d != null && typeof d === 'object') {
        const o = d as Record<string, unknown>;
        push(o.id ?? o.doctorId);
      } else {
        push(d);
      }
    }
  }
  return [...ids];
}

export function appointmentMatchesAssignedDoctorIds(
  assignedDoctorIds: string[],
  idSet: Set<string>
): boolean {
  if (!assignedDoctorIds.length) return false;
  const want = new Set(assignedDoctorIds.map((x) => String(x).trim()).filter(Boolean));
  for (const k of idSet) {
    if (want.has(String(k).trim())) return true;
  }
  return false;
}
