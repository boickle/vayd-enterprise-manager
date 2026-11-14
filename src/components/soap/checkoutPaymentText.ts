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
  if (card?.expired) return 'Card on file';
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

/** PAY-C5: "Expired, ending 4242" for a card on file that can no longer be charged. */
export function expiredCardText(card: { last4: string | null }): string {
  return card.last4 ? `Expired, ending ${card.last4}` : 'Expired';
}

export type CashTenderPlan = {
  amount: number;
  cashReceived: number | null;
  changeGiven: number | null;
  error?: string;
};

/**
 * What a cash payment records, from the "Cash received" box (owner, Nov 13, 2026).
 * Blank or the full amount: pays the bill. More: pays the bill and gives change.
 * Less: records just that much, so the rest can go on a card.
 */
export function cashTenderPlan(due: number, raw: string | null | undefined): CashTenderPlan {
  const round = (n: number) => Math.round(n * 100) / 100;
  const text = String(raw ?? '').trim();
  if (!text) return { amount: round(due), cashReceived: null, changeGiven: null };
  const received = round(Number(text.replace(/[^0-9.]/g, '')));
  if (!Number.isFinite(received) || received <= 0) {
    return { amount: 0, cashReceived: null, changeGiven: null, error: 'Enter the cash received, for example 50.00.' };
  }
  if (received < due - 0.009) return { amount: received, cashReceived: received, changeGiven: null };
  const change = round(received - due);
  return { amount: round(due), cashReceived: received, changeGiven: change > 0.009 ? change : null };
}

/** The note after a cash payment: paid in full (with any change), or what is still due. */
export function cashTenderNote(due: number, amount: number, changeGiven: number | null): string {
  const left = Math.round((due - amount) * 100) / 100;
  if (left > 0.009) {
    return `Recorded ${checkoutMoney(amount)} in cash. ${checkoutMoney(left)} is still due: take the rest by card or another way.`;
  }
  return changeGiven
    ? `Recorded cash payment of ${checkoutMoney(amount)}. Give ${checkoutMoney(changeGiven)} change.`
    : `Recorded cash payment of ${checkoutMoney(amount)}.`;
}
