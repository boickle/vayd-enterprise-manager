export function applyMemberStoreDiscount(
  unitPrice: number,
  percent: number | null | undefined
): number {
  const price = Number(unitPrice) || 0;
  const pct = Number(percent) || 0;
  if (!(pct > 0)) return price;
  return Math.round(price * (1 - pct / 100) * 100) / 100;
}

export function memberDiscountForPets(
  discounts: Record<number, number>,
  patientIds: number[] | null | undefined
): number {
  return Math.max(0, ...(patientIds || []).map((id) => discounts[id] ?? 0));
}
