import { useAuth } from '../../auth/useAuth';
import { isAnalyticsAdmin, normalizeAuthRoles } from '../../utils/analyticsAccess';
import { usePermissions } from '../../permissions/PermissionContext';

const VET_ROLES = ['veterinarian', 'relief_veterinarian', 'medical_director'] as const;

/**
 * LAB-04: who sees Mark reviewed / Approve wording, and who must give a reason. The server decides
 * again; this only shows the right controls. The permission is `lab_result.review` (vets, techs, lead
 * techs); admin logins pass on the server, so they are not hidden. Anyone who is not a vet gives a reason.
 */
export function useIdexxReviewAccess(): { canReview: boolean; mustGiveReason: boolean } {
  const { role } = useAuth() as { role?: string | string[] };
  const perms = usePermissions();
  const canReview = perms.can('lab_result.review') || isAnalyticsAdmin(normalizeAuthRoles(role));
  const isVet =
    (perms.isLicensed && perms.licenseType === 'veterinarian') || perms.hasRole(...VET_ROLES);
  return { canReview, mustGiveReason: canReview && !isVet };
}
