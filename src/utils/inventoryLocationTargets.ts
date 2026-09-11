/** Default-location min (when to buy) and max (order up to). Other locations use par. */

export function shortBy(onHand: number, target: number | null): number | null {
  if (target == null || !Number.isFinite(Number(target))) return null;
  const n = Number(target) - Number(onHand);
  return n > 0 ? n : null;
}

export function surplusBy(onHand: number, target: number | null): number | null {
  if (target == null || !Number.isFinite(Number(target))) return null;
  const n = Number(onHand) - Number(target);
  return n > 0 ? n : null;
}

export function isDefaultLocationId(
  locId: number,
  defaultLocationId: number | null | undefined
): boolean {
  return defaultLocationId != null && locId === defaultLocationId;
}

export function resolveDefaultLocationId<T extends { id?: number; branchLocationId?: number; isDefault?: boolean; code?: string }>(
  locations: T[]
): number | null {
  const flagged = locations.find((l) => l.isDefault);
  const main = locations.find((l) => String(l.code ?? '').toLowerCase() === 'main');
  const row = flagged ?? main ?? locations[0];
  if (!row) return null;
  const id = row.id ?? row.branchLocationId;
  return id != null && Number.isFinite(Number(id)) ? Number(id) : null;
}

/** Order when on-hand is at or below min. Qty brings stock back to max (or min if max is blank). */
export function orderQtyForDefault(args: {
  effectiveOnHand: number;
  min: number | null;
  max: number | null;
}): number {
  const min = args.min;
  if (min == null || !Number.isFinite(min)) return 0;
  if (Number(args.effectiveOnHand) > min) return 0;
  const max = args.max != null && Number.isFinite(args.max) ? Number(args.max) : min;
  const target = Math.max(max, min);
  const qty = target - Number(args.effectiveOnHand);
  return qty > 0 ? qty : 0;
}

export function hitsDefaultMin(onHand: number, min: number | null): boolean {
  return min != null && Number.isFinite(min) && Number(onHand) <= min;
}

export function locationNeedsAttention(args: {
  isDefault: boolean;
  onHand: number;
  parOrMax: number | null;
  min: number | null;
}): boolean {
  if (args.isDefault) return hitsDefaultMin(args.onHand, args.min);
  return shortBy(args.onHand, args.parOrMax) != null;
}
