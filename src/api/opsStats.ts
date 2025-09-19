import { http } from './http';

/* =========================
 * Revenue types + helpers
 * (unchanged)
 * ========================= */

export type DoctorRevenueRow = {
  doctorId: number | null;
  doctorName: string | null;
  totalServiceValue: number;
};

const csv = (ids?: string[]) => (ids && ids.length ? ids.map(String).join(',') : undefined);

/**
 * GET /analytics/ops/revenue/day
 * Returns { date, providerIds, total, byDoctor }
 */
export async function fetchRevenueForDay(params?: {
  date?: string; // YYYY-MM-DD (optional; server defaults to today UTC)
  providerIds?: string[]; // optional; omit or ["all"] -> ALL providers (admin only)
}): Promise<{
  date: string;
  providerIds: string[] | 'ALL';
  total: number;
  byDoctor: DoctorRevenueRow[];
}> {
  const query: Record<string, string> = {};
  if (params?.date) query.date = params.date;
  const pids = csv(params?.providerIds);
  if (pids) query.providerIds = pids;

  const { data } = await http.get('/analytics/ops/revenue/day', { params: query });
  return data;
}

/**
 * GET /analytics/ops/revenue/day/total
 * Convenience: returns just the numeric total for the day.
 */
export async function fetchRevenueTotalForDay(params?: {
  date?: string; // YYYY-MM-DD (optional; server defaults to today UTC)
  providerIds?: string[]; // optional
}): Promise<number> {
  const query: Record<string, string> = {};
  if (params?.date) query.date = params.date;
  const pids = csv(params?.providerIds);
  if (pids) query.providerIds = pids;

  const { data } = await http.get('/analytics/ops/revenue/day/total', { params: query });
  return Number(data?.total ?? 0);
}

/**
 * GET /analytics/ops/revenue/day/doctors
 * Returns an array of { doctorId, doctorName, totalServiceValue } for the day.
 */
export async function fetchRevenueByDoctorForDay(params?: {
  date?: string; // YYYY-MM-DD (optional; server defaults to today UTC)
  providerIds?: string[]; // optional
}): Promise<DoctorRevenueRow[]> {
  const query: Record<string, string> = {};
  if (params?.date) query.date = params.date;
  const pids = csv(params?.providerIds);
  if (pids) query.providerIds = pids;

  const { data } = await http.get('/analytics/ops/revenue/day/doctors', { params: query });
  return Array.isArray(data) ? (data as DoctorRevenueRow[]) : [];
}

/* =========================
 * Ops time-series (added)
 * ========================= */

export type OpsStatPoint = {
  date: string; // YYYY-MM-DD
  driveMin: number; // total minutes driving for the day
  householdMin: number; // total minutes on-site (service) for the day
  shiftMin: number; // total shift minutes for the day
  whiteMin: number; // whitespace minutes (shift - drive - household)
  whitePct: number; // 0..100
  hdRatio: number; // householdMin / driveMin
  points: number; // euth=2, tech=0.5, else 1
};

const hadAppt = (p?: Partial<OpsStatPoint>) =>
  !!p && ((Number(p?.points) || 0) > 0 || (Number(p?.householdMin) || 0) > 0);

/**
 * GET /analytics/ops
 * Returns daily OpsStatPoint[] for the date range; filters out all-zero days.
 */
export async function fetchOpsStatsAnalytics(params: {
  start: string; // YYYY-MM-DD inclusive
  end: string; // YYYY-MM-DD inclusive
  providerIds?: string[]; // optional; admin: omit/[] => ALL providers
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

/* =========================
 * Revenue: single doctor daily series
 * GET /analytics/ops/revenue/doctor/series
 * ========================= */

export type DoctorRevenuePoint = {
  date: string; // YYYY-MM-DD
  total: number; // revenue for that day
};

export type DoctorRevenueSeriesResponse = {
  doctorId: number;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  total: number; // sum(series.total)
  series: DoctorRevenuePoint[];
};

/**
 * Returns a daily revenue series for a single doctor within a date range.
 * - Admins: pass doctorId (required by backend).
 * - Non-admins: you may omit doctorId; backend will use the caller's doctor.
 */
export async function fetchDoctorRevenueSeries(params: {
  start: string; // YYYY-MM-DD inclusive
  end: string; // YYYY-MM-DD inclusive
  doctorId?: string | number; // optional for non-admins; required for admins
}): Promise<DoctorRevenueSeriesResponse> {
  const query: Record<string, string> = {
    start: params.start,
    end: params.end,
  };
  if (params.doctorId != null) query.doctorId = String(params.doctorId);

  const { data } = await http.get('/analytics/ops/revenue/doctor/series', { params: query });

  // Be defensive about shape
  const resp = data ?? {};
  const series = Array.isArray(resp.series) ? resp.series : [];
  return {
    doctorId: Number(resp.doctorId ?? params.doctorId ?? 0),
    start: String(resp.start ?? params.start),
    end: String(resp.end ?? params.end),
    total: Number(resp.total ?? series.reduce((s: number, r: any) => s + Number(r?.total || 0), 0)),
    series: series.map((r: any) => ({
      date: String(r?.date ?? ''),
      total: Number(r?.total ?? 0),
    })),
  };
}
