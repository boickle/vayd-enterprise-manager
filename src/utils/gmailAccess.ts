import { normalizeAuthRoles } from './analyticsAccess';

export function isGmailInboxAdmin(roles: string[]): boolean {
  const r = normalizeAuthRoles(roles);
  return r.includes('admin') || r.includes('superadmin');
}

/** Staff who may open Scout Email (all active employees, plus admin/superadmin). */
export function isGmailFeatureEmployee(roles: string[]): boolean {
  const r = normalizeAuthRoles(roles);
  if (isGmailInboxAdmin(r)) return true;
  if (r.includes('client')) return false;
  return r.includes('employee') || r.includes('provider');
}
