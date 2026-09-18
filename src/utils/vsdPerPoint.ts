import type { Dayjs } from 'dayjs';

function toLocalDateStr(d: Dayjs) {
  return d.format('YYYY-MM-DD');
}

function dateRange(start: Dayjs, end: Dayjs): string[] {
  const out: string[] = [];
  let d = start.startOf('day');
  const e = end.startOf('day');
  while (!d.isAfter(e)) {
    out.push(toLocalDateStr(d));
    d = d.add(1, 'day');
  }
  return out;
}

function seriesByDate(series: { date?: string; total?: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of series) {
    const d = String(p?.date ?? '').slice(0, 10);
    if (d) m.set(d, (m.get(d) ?? 0) + Number(p?.total ?? 0));
  }
  return m;
}

/**
 * Trailing VSD per point: total production ÷ total appointment points over the window.
 * Days with no calendar points are skipped so leftover production is not treated as infinite $/pt.
 */
export function volumeWeightedVsdPerPoint(
  series: { date?: string; total?: number }[],
  pointsByDate: Record<string, number>,
  histStart: Dayjs,
  histEnd: Dayjs
): number | null {
  const revByDate = seriesByDate(series);
  let rev = 0;
  let pts = 0;
  for (const dateStr of dateRange(histStart, histEnd)) {
    const dayPts = pointsByDate[dateStr] ?? 0;
    if (dayPts <= 0) continue;
    rev += revByDate.get(dateStr) ?? 0;
    pts += dayPts;
  }
  if (pts <= 0) return null;
  return rev / pts;
}

/**
 * Practice-wide trailing VSD per point over the same window.
 * A provider's production is included only on days they have calendar points.
 */
export function volumeWeightedPracticeVsdPerPoint(
  providerIds: string[],
  histResponses: { doctorId: string; response: { series?: { date?: string; total?: number }[] } }[],
  pointsByDoctorByDate: Record<string, Record<string, number>>,
  histStart: Dayjs,
  histEnd: Dayjs
): number | null {
  const revByDoctorByDate = new Map<string, Map<string, number>>();
  for (const id of providerIds) {
    const key = String(id);
    const hist = histResponses.find((x) => String(x.doctorId) === key);
    if (!hist) continue;
    revByDoctorByDate.set(key, seriesByDate(hist.response.series ?? []));
  }
  let rev = 0;
  let pts = 0;
  for (const dateStr of dateRange(histStart, histEnd)) {
    for (const id of providerIds) {
      const key = String(id);
      const doctorPts = pointsByDoctorByDate[key]?.[dateStr] ?? 0;
      if (doctorPts <= 0) continue;
      rev += revByDoctorByDate.get(key)?.get(dateStr) ?? 0;
      pts += doctorPts;
    }
  }
  if (pts <= 0) return null;
  return rev / pts;
}

export type VsdPerPointTrend = {
  /** Volume-weighted VSD/pt from the more recent half of the lookback (or the full window). */
  baseline: number | null;
  /** (second-half − first-half) per day between half midpoints. */
  dailyGrowth: number;
};

function splitLookback(
  histStart: Dayjs,
  histEnd: Dayjs
): {
  firstStart: Dayjs;
  firstEnd: Dayjs;
  secondStart: Dayjs;
  secondEnd: Dayjs;
  spanDays: number;
  canSplit: boolean;
} {
  const dates = dateRange(histStart, histEnd);
  const mid = Math.floor(dates.length / 2);
  if (mid <= 0 || mid >= dates.length) {
    return {
      firstStart: histStart,
      firstEnd: histEnd,
      secondStart: histStart,
      secondEnd: histEnd,
      spanDays: 1,
      canSplit: false,
    };
  }
  const firstMid = (mid - 1) / 2;
  const secondMid = mid + (dates.length - mid - 1) / 2;
  return {
    firstStart: histStart,
    firstEnd: histStart.add(mid - 1, 'day'),
    secondStart: histStart.add(mid, 'day'),
    secondEnd: histEnd,
    spanDays: Math.max(1, secondMid - firstMid),
    canSplit: true,
  };
}

function trendFromHalves(
  first: number | null,
  second: number | null,
  full: number | null,
  spanDays: number,
  canSplit: boolean
): VsdPerPointTrend {
  const baseline = second ?? first ?? full;
  if (!canSplit || first == null || second == null || baseline == null) {
    return { baseline, dailyGrowth: 0 };
  }
  return { baseline: second, dailyGrowth: (second - first) / spanDays };
}

/** Recent-half VSD/pt plus the measured half-to-half slope. */
export function vsdPerPointTrend(
  series: { date?: string; total?: number }[],
  pointsByDate: Record<string, number>,
  histStart: Dayjs,
  histEnd: Dayjs
): VsdPerPointTrend {
  const full = volumeWeightedVsdPerPoint(series, pointsByDate, histStart, histEnd);
  const split = splitLookback(histStart, histEnd);
  if (!split.canSplit) return { baseline: full, dailyGrowth: 0 };
  const first = volumeWeightedVsdPerPoint(
    series,
    pointsByDate,
    split.firstStart,
    split.firstEnd
  );
  const second = volumeWeightedVsdPerPoint(
    series,
    pointsByDate,
    split.secondStart,
    split.secondEnd
  );
  return trendFromHalves(first, second, full, split.spanDays, true);
}

export function practiceVsdPerPointTrend(
  providerIds: string[],
  histResponses: { doctorId: string; response: { series?: { date?: string; total?: number }[] } }[],
  pointsByDoctorByDate: Record<string, Record<string, number>>,
  histStart: Dayjs,
  histEnd: Dayjs
): VsdPerPointTrend {
  const full = volumeWeightedPracticeVsdPerPoint(
    providerIds,
    histResponses,
    pointsByDoctorByDate,
    histStart,
    histEnd
  );
  const split = splitLookback(histStart, histEnd);
  if (!split.canSplit) return { baseline: full, dailyGrowth: 0 };
  const first = volumeWeightedPracticeVsdPerPoint(
    providerIds,
    histResponses,
    pointsByDoctorByDate,
    split.firstStart,
    split.firstEnd
  );
  const second = volumeWeightedPracticeVsdPerPoint(
    providerIds,
    histResponses,
    pointsByDoctorByDate,
    split.secondStart,
    split.secondEnd
  );
  return trendFromHalves(first, second, full, split.spanDays, true);
}

/** Allow the measured $/pt trend to lift or cut the recent baseline by at most 50%. */
const PROJECTED_RATE_FLOOR = 0.7;
const PROJECTED_RATE_CEILING = 1.5;

export function projectVsdPerPoint(
  trend: VsdPerPointTrend | null | undefined,
  daysUntil: number
): number | null {
  if (trend?.baseline == null) return null;
  const raw = trend.baseline + trend.dailyGrowth * Math.max(0, daysUntil);
  const lo = trend.baseline * PROJECTED_RATE_FLOOR;
  const hi = trend.baseline * PROJECTED_RATE_CEILING;
  return Math.max(lo, Math.min(hi, raw));
}
