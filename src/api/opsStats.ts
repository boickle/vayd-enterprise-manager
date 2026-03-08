import { http } from './http';

/* =========================
 * Veterinary Services Delivered (Ops Analytics Revenue)
 * Base path: /analytics/ops
 * All endpoints require auth. Revenue is from treatment items (production employee).
 * ========================= */

export type DoctorRevenueRow = {
  doctorId: number | null;
  doctorName: string | null;
  totalServiceValue: number;
};

/** Build providerIds query: comma-separated IDs or "all". Omit = all doctors. */
function providerIdsParam(ids?: string[]): string | undefined {
  if (!ids?.length) return undefined;
  const single = ids.length === 1 && ids[0].toLowerCase() === 'all';
  return single ? 'all' : ids.map(String).join(',');
}

/**
 * GET /analytics/ops/revenue/day
 * One day: total revenue + breakdown by doctor.
 * Query: date (YYYY-MM-DD, optional, default today UTC), providerIds (optional, admins only: comma-separated or "all").
 */
export async function fetchRevenueForDay(params?: {
  date?: string;
  providerIds?: string[];
}): Promise<{
  date: string;
  providerIds: string | string[];
  total: number;
  byDoctor: DoctorRevenueRow[];
}> {
  const query: Record<string, string> = {};
  if (params?.date) query.date = params.date;
  const pids = providerIdsParam(params?.providerIds);
  if (pids) query.providerIds = pids;

  const { data } = await http.get('/analytics/ops/revenue/day', { params: query });
  return data;
}

/**
 * GET /analytics/ops/revenue/day/total
 * One day: total only (no byDoctor).
 * Query: date (optional), providerIds (optional, admins only).
 */
export async function fetchRevenueTotalForDay(params?: {
  date?: string;
  providerIds?: string[];
}): Promise<number> {
  const query: Record<string, string> = {};
  if (params?.date) query.date = params.date;
  const pids = providerIdsParam(params?.providerIds);
  if (pids) query.providerIds = pids;

  const { data } = await http.get('/analytics/ops/revenue/day/total', { params: query });
  return Number(data?.total ?? 0);
}

/**
 * GET /analytics/ops/revenue/day/doctors
 * One day: list of doctors with revenue only (no total in response; sum client-side if needed).
 * Query: date (optional), providerIds (optional, admins only).
 */
export async function fetchRevenueByDoctorForDay(params?: {
  date?: string;
  providerIds?: string[];
}): Promise<DoctorRevenueRow[]> {
  const query: Record<string, string> = {};
  if (params?.date) query.date = params.date;
  const pids = providerIdsParam(params?.providerIds);
  if (pids) query.providerIds = pids;

  const { data } = await http.get('/analytics/ops/revenue/day/doctors', { params: query });
  return Array.isArray(data) ? (data as DoctorRevenueRow[]) : [];
}

/* =========================
 * Ops stats (drive/household/points) – not revenue
 * GET /analytics/ops
 * ========================= */

export type OpsStatPoint = {
  date: string;
  driveMin: number;
  householdMin: number;
  shiftMin: number;
  whiteMin: number;
  whitePct: number;
  hdRatio: number;
  points: number;
};

const hadAppt = (p?: Partial<OpsStatPoint>) =>
  !!p && ((Number(p?.points) || 0) > 0 || (Number(p?.householdMin) || 0) > 0);

/**
 * GET /analytics/ops
 * Ops metrics by date (drive time, household time, shift, whitespace, points). Not revenue.
 * Query: start (YYYY-MM-DD), end (YYYY-MM-DD), providerIds (optional, admins only: comma-separated or "all").
 */
export async function fetchOpsStatsAnalytics(params: {
  start: string;
  end: string;
  providerIds?: string[];
}): Promise<OpsStatPoint[]> {
  const query: Record<string, string> = {
    start: params.start,
    end: params.end,
  };
  const pids = providerIdsParam(params.providerIds);
  if (pids) query.providerIds = pids;

  const { data } = await http.get('/analytics/ops', { params: query });
  const rows: OpsStatPoint[] = Array.isArray(data) ? data : [];
  return rows.filter(hadAppt);
}

/* =========================
 * One doctor's revenue series over a date range
 * GET /analytics/ops/revenue/doctor/series
 * ========================= */

export type DoctorRevenueSeriesItem = {
  treatmentItemId: number;
  cost: number;
  description: string | null;
  patientName?: string | null;
  clientName?: string | null;
};

export type DoctorRevenuePoint = {
  date: string;
  total: number;
  items?: DoctorRevenueSeriesItem[];
};

export type DoctorRevenueSeriesResponse = {
  doctorId: number | null;
  start: string;
  end: string;
  total: number;
  series: DoctorRevenuePoint[];
};

/**
 * GET /analytics/ops/revenue/doctor/series
 * One doctor: daily revenue over a date range + sum. Days with no revenue may be omitted from series.
 * Query: start (YYYY-MM-DD), end (YYYY-MM-DD), doctorId (optional: omit = own doctor; pass '' or null for revenue with no doctor).
 */
export async function fetchDoctorRevenueSeries(params: {
  start: string;
  end: string;
  doctorId?: string | number | null;
}): Promise<DoctorRevenueSeriesResponse> {
  const query: Record<string, string> = {
    start: params.start,
    end: params.end,
  };
  // Send doctorId when explicitly requested (including '' for "Not Specified" / no-doctor revenue)
  if (params.doctorId !== undefined) {
    query.doctorId = params.doctorId === null || params.doctorId === '' ? '' : String(params.doctorId);
  }

  const { data } = await http.get('/analytics/ops/revenue/doctor/series', { params: query });

  const resp = data ?? {};
  const series = Array.isArray(resp.series) ? resp.series : [];
  const isUnspecified =
    params.doctorId === null || params.doctorId === '';
  return {
    doctorId:
      resp.doctorId != null
        ? Number(resp.doctorId)
        : isUnspecified
          ? null
          : Number(params.doctorId ?? 0),
    start: String(resp.start ?? params.start),
    end: String(resp.end ?? params.end),
    total: Number(resp.total ?? series.reduce((s: number, r: any) => s + Number(r?.total || 0), 0)),
    series: series.map((r: any) => ({
      date: String(r?.date ?? ''),
      total: Number(r?.total ?? 0),
      items: Array.isArray(r?.items)
        ? (r.items as any[]).map((i: any) => ({
            treatmentItemId: Number(i?.treatmentItemId ?? 0),
            cost: Number(i?.cost ?? 0),
            description: i?.description ?? null,
            patientName: i?.patientName ?? null,
            clientName: i?.clientName ?? null,
          }))
        : undefined,
    })),
  };
}
