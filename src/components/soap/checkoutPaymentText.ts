import type { InvoiceCardOnFile, VisitInvoiceTender } from '../../api/visitWorkflow';

export function checkoutMoney(n: number | null | undefined): string {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

/** "Visa •4242", or "Card" when the brand and last four are not known. */
export function cardText(brand?: string | null, last4?: string | null): string {
  const b = (brand || '').trim();
  const name = b ? b.replace(/^./, (c) => c.toUpperCase()) : '';
  if (name && last4) return `${name} •${last4}`;
  if (last4) return `Card •${last4}`;
  return name || 'Card';
}

/** Button text: "Card on file · Visa •4242" when the card is known. */
export function cardOnFileButtonText(card: InvoiceCardOnFile | null): string {
  if (card && (card.last4 || card.brand)) return `Card on file · ${cardText(card.brand, card.last4)}`;
  return 'Card on file';
}

/** Account credit button text: "Account credit ($30.00)" while the household has credit. */
export function accountCreditButtonText(credit: number | null | undefined): string {
  return (Number(credit) || 0) > 0.005 ? `Account credit (${checkoutMoney(credit)})` : 'Account credit';
}

export type PaidTenderLine = { id: string; label: string; amount: number };

/**
 * One line per tender that still counts: "Gift card ••••9PVM", "Account credit", "Visa •4242".
 * The API sends a gift card's last characters on the tender (`giftCardLast4`); the ones the panel
 * saw redeemed (`giftLast4ByTender`) only cover an older API answer.
 */
export function paidTenderLines(
  tenders: VisitInvoiceTender[] | undefined,
  giftLast4ByTender: Record<string, string> = {},
): PaidTenderLine[] {
  const out: PaidTenderLine[] = [];
  for (const t of tenders ?? []) {
    if (t.voidedAt) continue;
    const amount = (Number(t.amount) || 0) - (Number(t.refundedAmount) || 0);
    if (amount <= 0.004) continue;
    let label: string;
    switch (t.method) {
      case 'gift_card': {
        const last = t.giftCardLast4 || giftLast4ByTender[t.id] || t.cardLast4;
        label = last ? `Gift card ••••${last}` : 'Gift card';
        break;
      }
      case 'account_credit':
        label = 'Account credit';
        break;
      case 'card':
        label = cardText(t.cardBrand, t.cardLast4);
        break;
      case 'cash':
        label = 'Cash';
        break;
      case 'check':
        label = t.checkNumber ? `Check #${t.checkNumber}` : 'Check';
        break;
      case 'carecredit':
        label = 'CareCredit';
        break;
      default:
        label = t.paymentTypeName?.trim() || 'Other';
    }
    out.push({ id: t.id, label, amount });
  }
  return out;
}
