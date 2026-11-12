import type { IdexxResultTest } from '../../api/idexx';

export type IdexxFlag = 'critical' | 'high' | 'low' | null;

export function idexxTestFlag(t: IdexxResultTest): IdexxFlag {
  const v = t.resultNumeric;
  if (v != null) {
    if (
      (t.criticalHigh != null && v >= t.criticalHigh) ||
      (t.criticalLow != null && v <= t.criticalLow)
    ) {
      return 'critical';
    }
  }
  const code = (t.outOfRangeCode || '').toUpperCase();
  if (code.includes('H')) return 'high';
  if (code.includes('L')) return 'low';
  if (t.outOfRange) {
    if (v != null && t.high != null && v > t.high) return 'high';
    if (v != null && t.low != null && v < t.low) return 'low';
    return 'high';
  }
  return null;
}
