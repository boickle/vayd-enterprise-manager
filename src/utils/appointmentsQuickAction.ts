import { isAnalyticsAdmin } from './analyticsAccess';

/** Staff roles that get the Appointments quick action (owner, Nov 11, 2026). */
export const APPOINTMENTS_QUICK_ACTION_ROLES = [
  'client_liaison',
  'lead_client_liaison',
  'practice_manager',
  'practice_admin',
] as const;

/** CLs, practice managers and admins see Appointments in Quick actions; other roles do not. */
export function mayShowAppointmentsQuickAction(
  loginRoles: string[],
  hasStaffRole: (...roles: (typeof APPOINTMENTS_QUICK_ACTION_ROLES)[number][]) => boolean
): boolean {
  return isAnalyticsAdmin(loginRoles) || hasStaffRole(...APPOINTMENTS_QUICK_ACTION_ROLES);
}
