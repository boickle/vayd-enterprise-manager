import { useAuth } from '../auth/useAuth';
import { isAnalyticsAdmin, normalizeAuthRoles } from '../utils/analyticsAccess';
import { useMayShow } from './PermissionContext';

/**
 * Whether the signed-in user may work the Appointments list and Hold tab: change statuses, route,
 * contact the family, take or hand off requests. CLs, lead CLs, practice managers and practice
 * admins may; techs and doctors see both read-only (owner, Nov 13, 2026). Before permissions load
 * it says yes, so controls don't flicker away; admin logins always may (the server lets them).
 */
export function useMayWorkAppointments(): boolean {
  const { role } = useAuth() as { role?: string | string[] };
  const mayShow = useMayShow('appointment_request.manage');
  return mayShow || isAnalyticsAdmin(normalizeAuthRoles(role));
}
