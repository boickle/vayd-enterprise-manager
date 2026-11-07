/**
 * Wave 8A (owner decision Nov 6, 2026): a pay link asks for what is owed minus the family's
 * spendable account credit; the credit is applied to the bills when they pay. This is the
 * ledger's preview of what the link will ask for (the server works it out again when sending).
 */
export function payLinkPreview(owed: number, spendableCredit: number): { amount: number; creditUsed: number } {
  const due = Math.max(0, Math.round((Number(owed) || 0) * 100));
  const credit = Math.min(due, Math.max(0, Math.round((Number(spendableCredit) || 0) * 100)));
  return { amount: (due - credit) / 100, creditUsed: credit / 100 };
}

/** The line under the pay-link buttons. */
export function payLinkPreviewText(
  owed: number,
  spendableCredit: number,
  invoiceCount: number,
  money: (n: number) => string
): string {
  const { amount, creditUsed } = payLinkPreview(owed, spendableCredit);
  if (amount <= 0.009 && creditUsed > 0.009) {
    return 'Their account credit covers this balance. Use Account credit on the bill instead of a pay link.';
  }
  const what = invoiceCount > 1 ? `${invoiceCount} unpaid invoices` : 'the unpaid invoice';
  const after = creditUsed > 0.009 ? ` (${money(creditUsed)} account credit comes off first)` : '';
  return `Sends ${money(amount)} for ${what}${after}`;
}
