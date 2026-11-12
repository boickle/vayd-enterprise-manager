import type {
  CheckItemPricingRequest,
  CheckItemPricingResponse,
  MembershipCoverageAlternative,
} from '../api/roomLoader';
import { checkItemPricing } from '../api/roomLoader';

export type CoverageChoicePrompt = {
  itemName: string;
  alternatives: MembershipCoverageAlternative[];
  initialId: number | null;
};

/**
 * Runs check-item-pricing; when multiple membership benefits still apply to the
 * same catalog item, asks which one to use (via `askCoverageChoice`) and re-prices.
 */
export async function checkItemPricingWithCoverageChoice(args: {
  request: CheckItemPricingRequest;
  itemName: string;
  askCoverageChoice: (prompt: CoverageChoicePrompt) => Promise<number | null>;
}): Promise<CheckItemPricingResponse> {
  const first = await checkItemPricing(args.request);
  const alts = first.wellnessPlanPricing?.coverageAlternatives;
  if (!alts || alts.length < 2) return first;

  const picked = await args.askCoverageChoice({
    itemName: args.itemName,
    alternatives: alts,
    initialId: first.wellnessPlanPricing?.wellnessPlanItemId ?? null,
  });
  if (picked == null) {
    throw new Error('Coverage choice cancelled');
  }
  if (picked === first.wellnessPlanPricing?.wellnessPlanItemId) return first;

  return checkItemPricing({
    ...args.request,
    preferredWellnessPlanItemId: picked,
  });
}
