export type StoreReminderCadence = {
  dueAt: number;
  periodUnit: string;
  adjustByQuantity: boolean;
};

/** Map a catalog reminder interval (optionally × qty) to a store autoship frequency. */
export function reminderAutoshipFrequency(
  cadence: StoreReminderCadence | null | undefined,
  qty: number
): string | null {
  if (!cadence || !(Number(cadence.dueAt) > 0)) return null;
  const units = Math.max(1, Math.floor(Number(qty) || 1));
  const count = cadence.adjustByQuantity
    ? Number(cadence.dueAt) * units
    : Number(cadence.dueAt);
  if (!(count > 0)) return null;
  const unit = String(cadence.periodUnit || 'Months').toLowerCase();
  if (unit.startsWith('year')) {
    return count === 1 ? 'yearly' : `every_${count * 12}_months`;
  }
  if (unit.startsWith('month')) {
    if (count === 1) return 'monthly';
    if (count === 2) return 'every_2_months';
    if (count === 3) return 'quarterly';
    if (count === 6) return 'every_6_months';
    if (count === 12) return 'yearly';
    return `every_${count}_months`;
  }
  if (unit.startsWith('week')) {
    if (count === 1) return 'weekly';
    return `every_${count}_weeks`;
  }
  if (unit.startsWith('day')) {
    return count === 1 ? 'every_1_days' : `every_${count}_days`;
  }
  return null;
}

export function storeRecommendedFrequency(
  cadence: StoreReminderCadence | null | undefined,
  fallback: string | null | undefined,
  qty: number
): string | null {
  return reminderAutoshipFrequency(cadence, qty) || fallback || null;
}
