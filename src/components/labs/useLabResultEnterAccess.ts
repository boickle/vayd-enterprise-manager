import { useAuth } from '../../auth/useAuth';
import { isAnalyticsAdmin, normalizeAuthRoles } from '../../utils/analyticsAccess';
import { usePermissions } from '../../permissions/PermissionContext';

/**
 * LAB-A9: who sees the in-house result entry controls (Save results, Save, finish later).
 * The server checks `lab_result.enter` on the save call; admin logins pass there, so they keep the
 * controls too. Everyone else (front desk, client liaisons) sees the form read-only.
 */
export function useLabResultEnterAccess(): { canEnter: boolean } {
  const { role } = useAuth() as { role?: string | string[] };
  const perms = usePermissions();
  return { canEnter: perms.can('lab_result.enter') || isAnalyticsAdmin(normalizeAuthRoles(role)) };
}
