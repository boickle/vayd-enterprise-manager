/**
 * The bill's "covered by the plan" total row. The amount is the full price of the lines the
 * pet's plan pays for (Office exam, DHPP, ...), already taken off. It is not account credit
 * and not the multi-pet credit, so the label names what was covered.
 */
export type CoveredLineLike = {
  description?: string | null;
  isCovered?: boolean | null;
  isDeleted?: boolean | null;
};

export function membershipCoveredLabel(lines: readonly CoveredLineLike[]): string {
  const names: string[] = [];
  for (const l of lines) {
    if (!l.isCovered || l.isDeleted) continue;
    const name = (l.description ?? '').trim();
    if (name && !names.includes(name)) names.push(name);
  }
  if (names.length === 1) return `${names[0]} included in membership`;
  if (names.length === 2) return `${names[0]} and ${names[1]} included in membership`;
  if (names.length > 2) return `${names.length} items included in membership`;
  return 'Included in membership';
}

/** "$75.00 covered" for a covered amount stored as -75 or 75 (owner, Nov 11, 2026: reads better than "−$75.00"). */
export function membershipCoveredAmount(amount: number | string | null | undefined): string {
  const n = Math.abs(Number(amount) || 0);
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} covered`;
}
