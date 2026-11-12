import { useAuth } from '../auth/useAuth';
import { isAnalyticsAdmin, normalizeAuthRoles } from '../utils/analyticsAccess';
import { useMayShow } from './PermissionContext';

/**
 * B7 (Nov 11, 2026): whether to show controls that save a client or patient record (pencils,
 * Save household defaults, Deactivate, Upload records). The API needs "Edit demographics" or
 * "Edit clinical fields" for those saves, which every role but Observer and Executive holds (owner,
 * Nov 11, 2026). Admin and superadmin logins pass, as they do on the server.
 */
export function useMayEditClientRecords(): boolean {
  const { role } = useAuth() as { role?: string | string[] };
  const may = useMayShow('client.edit', 'client.edit_clinical');
  return may || isAnalyticsAdmin(normalizeAuthRoles(role));
}
