/**
 * Owner decision D1 (Nov 2, 2026): euthanasia visits are paid through the estimate +
 * consent hold (EstimateSettlePanel; by phone: Scheduler → Euthanasia consent → estimate →
 * Take card). The older euthanasia prepay on the invoice (Save card, Authorize, Convert
 * Authorization to Payment) only finishes invoices that already use it.
 *
 * Same rule as vayd-api src/visitWorkflow/euthanasia-prepay.ts: the prepay flag plus a card
 * saved through the prepay, a saved card, or a live hold on the invoice. A flag alone is an
 * ordinary bill.
 */
export function usesLegacyEuthanasiaPrepay(
  invoice:
    | {
        isEuthanasiaPrepay?: boolean | null;
        stripeSetupIntentId?: string | null;
        savedPaymentMethodId?: string | null;
        stripePaymentIntentId?: string | null;
        lastChargeStatus?: string | null;
      }
    | null
    | undefined,
): boolean {
  if (!invoice?.isEuthanasiaPrepay) return false;
  return Boolean(
    invoice.stripeSetupIntentId ||
      invoice.savedPaymentMethodId ||
      (invoice.lastChargeStatus === 'requires_capture' && invoice.stripePaymentIntentId),
  );
}
