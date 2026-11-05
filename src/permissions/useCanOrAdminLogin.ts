import { useAuth } from '../auth/useAuth';
import { isAnalyticsAdmin, normalizeAuthRoles } from '../utils/analyticsAccess';
import { useCan } from './PermissionContext';

/**
 * `useCan`, plus admin and superadmin logins. The server lets those through every staff permission
 * check (some admin logins have no employee or role rows), so the screen must not hide the control
 * from them (PAY-A8).
 */
export function useCanOrAdminLogin(permissionKey: string): boolean {
  const { role } = useAuth() as { role?: string | string[] };
  const can = useCan(permissionKey);
  return can || isAnalyticsAdmin(normalizeAuthRoles(role));
}
