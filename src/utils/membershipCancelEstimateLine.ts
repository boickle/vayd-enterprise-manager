import {
  addEstimateLine,
  removeEstimateLine,
  updateEstimateLine,
  type VisitEstimate,
  type VisitEstimateLine,
} from '../api/visitEstimates';
import {
  listPatientMemberships,
  previewMembershipCancel,
  type MembershipCancelPreview,
} from '../api/memberships';

export const MEMBERSHIP_CANCEL_LINE_PREFIX = 'Membership cancellation —';

export type MembershipCancelEstimateSync = {
  estimate: VisitEstimate;
  previews: MembershipCancelPreview[];
};

function money(n: number): string {
  return Number(n || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

export function isMembershipCancelEstimateLine(line: VisitEstimateLine): boolean {
  return (line.description ?? '').trim().startsWith(MEMBERSHIP_CANCEL_LINE_PREFIX);
}

export function membershipCancelLineDescription(planName: string): string {
  const name = planName.trim() || 'membership';
  return `${MEMBERSHIP_CANCEL_LINE_PREFIX} ${name}`;
}

export function membershipCancelLineNote(preview: MembershipCancelPreview): string {
  if (preview.chargeAmount > 0.009) {
    return `${money(preview.chargeAmount)} due on cancel — added to this quote so the authorization includes it.`;
  }
  if (preview.refundAmount > 0.009) {
    return `${money(preview.refundAmount)} unused membership credit — subtracted from this quote so the authorization includes it.`;
  }
  return `${preview.planName} is even this term. Nothing is added to the quote.`;
}

function sameMoney(a: number, b: number): boolean {
  return Math.abs(Number(a || 0) - Number(b || 0)) < 0.009;
}

function lineMatchesPreview(line: VisitEstimateLine, preview: MembershipCancelPreview): boolean {
  return line.description.trim() === membershipCancelLineDescription(preview.planName);
}

/**
 * Put each active membership's cancel charge or credit on the euthanasia estimate
 * so consent authorization and later capture use that total.
 */
export async function syncMembershipCancelLinesOnEstimate(
  estimate: VisitEstimate,
  patientId: number,
): Promise<MembershipCancelEstimateSync> {
  if (estimate.status === 'converted') {
    return { estimate, previews: [] };
  }

  const memberships = (await listPatientMemberships({ patientId })).filter(
    (row) => row.status !== 'inactive',
  );
  const previews: MembershipCancelPreview[] = [];
  for (const membership of memberships) {
    try {
      previews.push(await previewMembershipCancel(membership.id));
    } catch {
      /* already canceled or not settleable — skip the line */
    }
  }

  let next = estimate;
  const keepIds = new Set<string>();

  for (const preview of previews) {
    const description = membershipCancelLineDescription(preview.planName);
    const existing = (next.lines ?? []).find(
      (line) => !line.hideOnInvoice && lineMatchesPreview(line, preview),
    );
    const charge = preview.chargeAmount > 0.009 ? preview.chargeAmount : 0;
    const refund = preview.refundAmount > 0.009 ? preview.refundAmount : 0;

    if (charge <= 0.009 && refund <= 0.009) {
      if (existing) {
        next = await removeEstimateLine(next.id, existing.id);
      }
      continue;
    }

    const qty = charge > 0.009 ? 1 : -1;
    const unitPrice = charge > 0.009 ? charge : refund;
    if (
      existing &&
      existing.description === description &&
      sameMoney(existing.qty, qty) &&
      sameMoney(existing.unitPrice, unitPrice)
    ) {
      keepIds.add(existing.id);
      continue;
    }

    if (existing) {
      next = await updateEstimateLine(next.id, existing.id, {
        description,
        qty,
        unitPrice,
        patientId,
        isCovered: false,
      });
      keepIds.add(existing.id);
    } else {
      next = await addEstimateLine(next.id, {
        description,
        qty,
        unitPrice,
        patientId,
        isCovered: false,
      });
      const added = (next.lines ?? []).find((line) => lineMatchesPreview(line, preview));
      if (added) keepIds.add(added.id);
    }
  }

  for (const line of next.lines ?? []) {
    if (!isMembershipCancelEstimateLine(line)) continue;
    if (keepIds.has(line.id)) continue;
    next = await removeEstimateLine(next.id, line.id);
  }

  return { estimate: next, previews };
}
