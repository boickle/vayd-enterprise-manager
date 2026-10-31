import type { MembershipBenefit, MembershipGroup, PatientMembership } from '../api/memberships';
import type { VisitInvoiceLine } from '../api/visitWorkflow';

function formatUsedOn(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function usedDates(
  m: PatientMembership,
  group: MembershipGroup,
  benefit: MembershipBenefit
): string[] {
  const shared = group.id > 0 && group.selectionMode !== 'all';
  const dates = (m.usage ?? [])
    .filter((u) => (shared ? u.groupId === group.id : u.benefitId === benefit.id))
    .map((u) => formatUsedOn(u.usedAt))
    .filter((d): d is string => Boolean(d));
  return [...new Set(dates)];
}

/** Active membership for this pet with benefits paused (checkout / invoice headers). */
export function membershipBenefitsPausedForPatient(
  memberships: PatientMembership[],
  patientId: number | null | undefined,
): PatientMembership['benefitsPaused'] {
  if (patientId == null) return null;
  for (const m of memberships) {
    if (m.patientId !== patientId || m.status !== 'active') continue;
    if (m.benefitsPaused) return m.benefitsPaused;
  }
  return null;
}

/**
 * For a charged (not covered) line whose item is a used-up membership benefit:
 * "Membership: used 1 of 1 on 6/3/2026".
 */
export function usedUpMembershipNote(
  memberships: PatientMembership[],
  line: Pick<VisitInvoiceLine, 'isCovered' | 'patientId' | 'catalogItemId' | 'catalogItemType'>
): string | null {
  if (
    line.isCovered ||
    line.patientId == null ||
    line.catalogItemId == null ||
    !line.catalogItemType
  ) {
    return null;
  }
  for (const m of memberships) {
    if (m.patientId !== line.patientId || m.status !== 'active' || m.benefitsPaused) continue;
    for (const group of m.groups) {
      const benefit = group.benefits.find(
        (b) =>
          !b.isRemoved &&
          b.itemType === line.catalogItemType &&
          b.catalogItemId === line.catalogItemId
      );
      if (!benefit) continue;

      const shared = group.id > 0 && group.selectionMode !== 'all';
      const included = shared ? group.allowedQuantity : benefit.includedQuantity;
      const used = shared ? group.usedQuantity : benefit.usedQuantity;
      const remaining = shared ? group.remainingQuantity : benefit.remainingQuantity;
      if (included < 0 || remaining !== 0 || used <= 0) continue;

      const dates = usedDates(m, group, benefit);
      const what = shared ? ` (${group.name})` : '';
      const when = dates.length ? ` on ${dates.join(', ')}` : ' this term';
      return `Membership${what}: used ${used} of ${included}${when}`;
    }
  }
  return null;
}
