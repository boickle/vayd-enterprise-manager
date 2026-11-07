/**
 * PAY-A15 (Wave 7): how "Return & refund" splits a refund on a bill. Same rule as the server's
 * returnLines: card payments are refunded first (through Stripe); whatever the cards can't take
 * goes back on the client's account, from the bill's account credit payments.
 */
export type ReturnRefundSplit = {
  /** Dollars refunded to the card(s). */
  card: number;
  /** Dollars put back as account credit. */
  credit: number;
  /** Most this bill can refund this way (card + credit payments still refundable). */
  max: number;
  /** True when the amount is more than the card and credit payments can give back. */
  over: boolean;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function splitReturnRefund(amount: number, cardAvailable: number, creditAvailable: number): ReturnRefundSplit {
  const amt = Math.max(0, r2(Number(amount) || 0));
  const cardAvail = Math.max(0, r2(Number(cardAvailable) || 0));
  const creditAvail = Math.max(0, r2(Number(creditAvailable) || 0));
  const max = r2(cardAvail + creditAvail);
  const card = Math.min(amt, cardAvail);
  const credit = Math.min(r2(amt - card), creditAvail);
  return { card: r2(card), credit: r2(credit), max, over: amt > max + 0.009 };
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** "$40.00 to card, $25.00 back as account credit" (or just one part when the other is zero). */
export function describeReturnRefund(split: Pick<ReturnRefundSplit, 'card' | 'credit'>): string {
  const parts: string[] = [];
  if (split.card > 0.009) parts.push(`${usd(split.card)} to card`);
  if (split.credit > 0.009) parts.push(`${usd(split.credit)} back as account credit`);
  return parts.join(', ');
}
