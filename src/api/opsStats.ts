import dayjs from 'dayjs';
import dayOfYear from 'dayjs/plugin/dayOfYear';
import { http } from './http';

// ----------------------------------
// Types
// ----------------------------------
export type OpsStatPoint = {
  date: string; // YYYY-MM-DD
  driveMin: number; // total minutes driving for the day
  householdMin: number; // total minutes on-site (service) for the day
  shiftMin: number; // total shift minutes for the day
  whiteMin: number; // whitespace minutes (shift - drive - household)
  whitePct: number; // 0..100
  hdRatio: number; // householdMin / driveMin
  points: number; // euth=2, tech=0.5, else 1 (simulated here)
};

export type OpsAnalyticsParams = {
  start: string; // YYYY-MM-DD inclusive
  end: string; // YYYY-MM-DD inclusive
  providerIds?: string[]; // empty/omitted => ALL providers (mock will simulate several)
};

const hadAppt = (p?: Partial<OpsStatPoint>) =>
  !!p && ((Number(p.points) || 0) > 0 || (Number(p.householdMin) || 0) > 0);
// ----------------------------------
// Real API wrapper (replace path if needed)
// ----------------------------------
export async function fetchOpsStatsAnalytics(params: {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  providerIds?: string[]; // optional
}): Promise<OpsStatPoint[]> {
  const query: Record<string, string> = {
    start: params.start,
    end: params.end,
  };

  if (params.providerIds?.length) {
    query.providerIds = params.providerIds.map(String).join(',');
  }

  const { data } = await http.get('/analytics/ops', { params: query });
  const rows: OpsStatPoint[] = Array.isArray(data) ? data : [];
  return rows.filter(hadAppt);
}
// ----------------------------------
// MOCK DATA GENERATOR
// ----------------------------------
// Deterministic PRNG so charts are stable across renders
function prng(seed: string) {
  // xmur3 + mulberry32 combo
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function mulberry32() {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function round(n: number) {
  return Math.round(n);
}

function enumerateDays(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  let d = dayjs(startISO).startOf('day');
  const end = dayjs(endISO).startOf('day');
  while (!d.isAfter(end)) {
    out.push(d.format('YYYY-MM-DD'));
    d = d.add(1, 'day');
  }
  return out;
}

// Generate one provider's day, then we'll sum across providers when needed
function generateProviderDay(seedFn: () => number, date: string): OpsStatPoint {
  // Seasonality + weekday effects
  const dow = dayjs(date).day(); // 0..6
  const weekdayLoad = [0.7, 0.85, 1.0, 1.05, 1.1, 1.0, 0.5][dow];
  const seasonal = 0.9 + 0.2 * Math.sin((dayjs(date).dayOfYear() / 365) * Math.PI * 2);
  const noise = 0.85 + seedFn() * 0.3; // 0.85..1.15
  const load = weekdayLoad * seasonal * noise;

  // Base minutes for a typical solo-doctor day
  const baseShift = 8 * 60; // 8h
  const shiftMin = clamp(round(baseShift * (0.9 + seedFn() * 0.4)), 6 * 60, 10 * 60);

  const baseDrive = 90; // minutes
  const driveMin = clamp(round(baseDrive * (0.7 + seedFn() * 0.8) * load), 40, 220);

  const baseHousehold = 220; // minutes
  const householdMin = clamp(round(baseHousehold * (0.7 + seedFn() * 0.8) * load), 90, 420);

  // Ensure whitespace can go negative occasionally (overbooked days)
  const whiteMinRaw = shiftMin - driveMin - householdMin;
  const whiteMin = round(whiteMinRaw);
  const whitePct = round(clamp((whiteMin / Math.max(shiftMin, 1)) * 100, -50, 80));

  const hdRatio = driveMin > 0 ? householdMin / driveMin : householdMin > 0 ? 10 : 0;

  // Points: roughly 1 pt / appt (40–60 min each), with some tech appt halves
  const estAppts = clamp(Math.round(householdMin / (40 + seedFn() * 20)), 2, 12);
  const techShare = 0.15 + seedFn() * 0.15; // 15–30%
  const euthShare = 0.05 + seedFn() * 0.05; // 5–10%
  const tech = Math.round(estAppts * techShare);
  const euth = Math.round(estAppts * euthShare);
  const regular = Math.max(0, estAppts - tech - euth);
  const points = regular * 1 + tech * 0.5 + euth * 2;

  return {
    date,
    driveMin,
    householdMin,
    shiftMin,
    whiteMin,
    whitePct,
    hdRatio: Number(hdRatio.toFixed(2)),
    points: Number(points.toFixed(1)),
  };
}

function addPoints(a: OpsStatPoint, b: OpsStatPoint): OpsStatPoint {
  const shiftMin = a.shiftMin + b.shiftMin; // naive sum (multiple providers = more total shift)
  const driveMin = a.driveMin + b.driveMin;
  const householdMin = a.householdMin + b.householdMin;
  const whiteMin = shiftMin - driveMin - householdMin;
  const whitePct = Math.round((whiteMin / Math.max(shiftMin, 1)) * 100);
  const hdRatio = driveMin > 0 ? householdMin / driveMin : householdMin > 0 ? 10 : 0;
  return {
    date: a.date,
    driveMin,
    householdMin,
    shiftMin,
    whiteMin,
    whitePct,
    hdRatio: Number(hdRatio.toFixed(2)),
    points: Number((a.points + b.points).toFixed(1)),
  };
}

// Public mock: generates per-provider and aggregates by date
export async function fetchOpsStatsAnalyticsMock(
  params: OpsAnalyticsParams & { simulatedProviderCount?: number }
): Promise<OpsStatPoint[]> {
  const days = enumerateDays(params.start, params.end);
  const providerIds =
    params.providerIds && params.providerIds.length ? params.providerIds : undefined;

  const ids =
    providerIds ??
    Array.from(
      { length: Math.max(2, params.simulatedProviderCount || 4) },
      (_, i) => `prov-${i + 1}`
    );

  // Build a table of date -> aggregated point
  const aggByDate = new Map<string, OpsStatPoint>();

  for (const id of ids) {
    const rand = prng(`${id}|${params.start}|${params.end}`);
    for (const date of days) {
      const pt = generateProviderDay(rand, date);
      const existing = aggByDate.get(date);
      if (!existing) aggByDate.set(date, pt);
      else aggByDate.set(date, addPoints(existing, pt));
    }
  }

  // Return chronologically sorted
  return days.map((d) => aggByDate.get(d)!).filter(Boolean);
}

// Convenience: switch between real and mock via env flag
export async function fetchOpsStatsAnalyticsAuto(
  params: OpsAnalyticsParams
): Promise<OpsStatPoint[]> {
  if (typeof window !== 'undefined' && (window as any).__USE_OPS_ANALYTICS_MOCK__) {
    return fetchOpsStatsAnalyticsMock(params);
  }
  return fetchOpsStatsAnalytics(params);
}
