import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import type { SeasonalIndexResponse, SeasonalWeekPoint } from '../api/opsStats';

dayjs.extend(isoWeek);

export const SEASONAL_FACTOR_FLOOR = 0.7;
export const SEASONAL_FACTOR_CEILING = 1.3;

export function isoWeekNumber(date: string): number {
  return dayjs(date.slice(0, 10)).isoWeek();
}

export function weekIndexMap(
  weeks: SeasonalWeekPoint[] | undefined,
): Map<number, SeasonalWeekPoint> {
  const m = new Map<number, SeasonalWeekPoint>();
  for (const w of weeks ?? []) {
    if (w?.week >= 1) m.set(w.week, w);
  }
  return m;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function relativeSeasonalFactor(
  targetIndex: number | null | undefined,
  lookbackIndex: number | null | undefined,
  floor = SEASONAL_FACTOR_FLOOR,
  ceiling = SEASONAL_FACTOR_CEILING,
): number {
  const target = Number(targetIndex);
  const lookback = Number(lookbackIndex);
  if (!(target > 0) || !(lookback > 0)) return 1;
  return clamp(target / lookback, floor, ceiling);
}

export type SeasonalFactors = {
  treatment: number;
  pharmacy: number;
  targetWeek: number;
  lookbackWeek: number;
};

export function seasonalFactorsForDate(
  date: string,
  lookbackWeek: number,
  byWeek: Map<number, SeasonalWeekPoint>,
  ready: boolean,
): SeasonalFactors {
  const targetWeek = isoWeekNumber(date);
  if (!ready || byWeek.size === 0) {
    return { treatment: 1, pharmacy: 1, targetWeek, lookbackWeek };
  }
  const target = byWeek.get(targetWeek);
  const lookback = byWeek.get(lookbackWeek);
  return {
    treatment: relativeSeasonalFactor(target?.index, lookback?.index),
    pharmacy: relativeSeasonalFactor(target?.pharmacyIndex, lookback?.pharmacyIndex),
    targetWeek,
    lookbackWeek,
  };
}

export function lookbackMidpointIso(histStart: string, histEnd: string): string {
  const start = dayjs(histStart.slice(0, 10));
  const end = dayjs(histEnd.slice(0, 10));
  const span = Math.max(0, end.diff(start, 'day'));
  return start.add(Math.floor(span / 2), 'day').format('YYYY-MM-DD');
}

export function seasonalIndexReady(
  index: SeasonalIndexResponse | null | undefined,
): boolean {
  return Boolean(index?.ready && (index.yearsUsed?.length ?? 0) > 0);
}
