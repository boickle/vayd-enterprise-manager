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
  clientId?: number | null;
  appointmentId?: number | string | null;
  isMember?: boolean;
};

function mapRevenueSeriesItem(i: any): DoctorRevenueSeriesItem {
  return {
    treatmentItemId: Number(i?.treatmentItemId ?? 0),
    cost: Number(i?.cost ?? 0),
    description: i?.description ?? null,
    patientName: i?.patientName ?? null,
    clientName: i?.clientName ?? null,
    clientId:
      i?.clientId != null
        ? Number(i.clientId)
        : i?.client?.id != null
          ? Number(i.client.id)
          : null,
    appointmentId: i?.appointmentId ?? i?.appointment?.id ?? null,
    isMember: i?.isMember === true,
  };
}

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
        ? (r.items as any[]).map(mapRevenueSeriesItem)
        : undefined,
    })),
  };
}

/* =========================
 * One client's revenue series over a date range
 * GET /analytics/ops/revenue/client/series
 * ========================= */

export type ClientRevenuePoint = {
  date: string;
  total: number;
  items?: DoctorRevenueSeriesItem[];
};

export type ClientRevenueSeriesResponse = {
  clientId: number;
  start: string;
  end: string;
  total: number;
  series: ClientRevenuePoint[];
};

/**
 * GET /analytics/ops/revenue/client/series
 * Treatment-item revenue for one client by day.
 * Query: clientId, start (YYYY-MM-DD), end (YYYY-MM-DD).
 */
export async function fetchClientRevenueSeries(params: {
  clientId: number | string;
  start: string;
  end: string;
}): Promise<ClientRevenueSeriesResponse> {
  const { data } = await http.get('/analytics/ops/revenue/client/series', {
    params: {
      clientId: String(params.clientId),
      start: params.start,
      end: params.end,
    },
  });

  const resp = data ?? {};
  const series = Array.isArray(resp.series) ? resp.series : [];
  return {
    clientId: Number(resp.clientId ?? params.clientId),
    start: String(resp.start ?? params.start),
    end: String(resp.end ?? params.end),
    total: Number(
      resp.total ?? series.reduce((s: number, r: any) => s + Number(r?.total ?? 0), 0)
    ),
    series: series.map((r: any) => ({
      date: String(r?.date ?? ''),
      total: Number(r?.total ?? 0),
      items: Array.isArray(r?.items) ? r.items.map(mapRevenueSeriesItem) : undefined,
    })),
  };
}

export type VsdPaymentsMatchDay = {
  date: string;
  vsd: number;
  practicePayments: number;
  pharmacyPayments: number;
  membershipPayments: number;
};

export type VsdPaymentsMatchInvoice = {
  invoiceNumber: number;
  status: 'open' | 'closed' | 'paid';
  serviceDate: string;
  client: string;
  remaining: number;
  vsd: number;
  doctor: string;
  billedBy: string;
  billedRole: string;
  paymentType: string;
  age: string;
};

export type VsdPaymentsMatchReport = {
  start: string;
  end: string;
  timezone: string;
  totals: {
    vsd: number;
    practicePayments: number;
    pharmacyPayments: number;
    membershipPayments: number;
    gap: number;
    paidVsd: number;
    openVsd: number;
    closedVsd: number;
    membershipDiscount: number;
    membershipCoveredVsd: number;
    memberVsd: number;
    memberBilled: number;
    billed: number;
    openToCollect: number;
  };
  daily: VsdPaymentsMatchDay[];
  doctors: {
    doctor: string;
    vsd: number;
    paidVsd: number;
    openVsd: number;
    closedVsd: number;
    openMemberVsd: number;
    openMembershipDiscount: number;
    membershipDiscount: number;
    openToCollect: number;
    openInvoices: number;
  }[];
  billers: { name: string; role: string; invoices: number; remaining: number }[];
  openInvoices: VsdPaymentsMatchInvoice[];
  closedInvoices: VsdPaymentsMatchInvoice[];
  paymentTypes: {
    type: string;
    count: number;
    total: number;
    inPracticeCompare: boolean;
  }[];
};

/**
 * GET /analytics/ops/revenue/vsd-payments-match
 * Practice-wide VSD vs practice payments for a date range (admins).
 */
export async function fetchVsdPaymentsMatch(params: {
  start: string;
  end: string;
}): Promise<VsdPaymentsMatchReport> {
  const { data } = await http.get('/analytics/ops/revenue/vsd-payments-match', {
    params: { start: params.start, end: params.end },
  });
  const resp = data ?? {};
  const n = (v: unknown) => Number(v) || 0;
  return {
    start: String(resp.start ?? params.start),
    end: String(resp.end ?? params.end),
    timezone: String(resp.timezone ?? 'America/New_York'),
    totals: {
      vsd: n(resp.totals?.vsd),
      practicePayments: n(resp.totals?.practicePayments),
      pharmacyPayments: n(resp.totals?.pharmacyPayments),
      membershipPayments: n(resp.totals?.membershipPayments),
      gap: n(resp.totals?.gap),
      paidVsd: n(resp.totals?.paidVsd),
      openVsd: n(resp.totals?.openVsd),
      closedVsd: n(resp.totals?.closedVsd),
      membershipDiscount: n(resp.totals?.membershipDiscount),
      membershipCoveredVsd: n(resp.totals?.membershipCoveredVsd),
      memberVsd: n(resp.totals?.memberVsd),
      memberBilled: n(resp.totals?.memberBilled),
      billed: n(resp.totals?.billed),
      openToCollect: n(resp.totals?.openToCollect),
    },
    daily: Array.isArray(resp.daily)
      ? resp.daily.map((r: any) => ({
          date: String(r?.date ?? ''),
          vsd: n(r?.vsd),
          practicePayments: n(r?.practicePayments),
          pharmacyPayments: n(r?.pharmacyPayments),
          membershipPayments: n(r?.membershipPayments),
        }))
      : [],
    doctors: Array.isArray(resp.doctors)
      ? resp.doctors.map((r: any) => {
          const openVsd = n(r?.openVsd);
          const openMemberVsd = n(r?.openMemberVsd);
          const openMembershipDiscount = n(r?.openMembershipDiscount);
          const membershipDiscount = n(r?.membershipDiscount);
          const openToCollect = Math.max(0, openVsd - openMembershipDiscount);
          return {
            doctor: String(r?.doctor ?? 'Not specified'),
            vsd: n(r?.vsd),
            paidVsd: n(r?.paidVsd),
            openVsd,
            closedVsd: n(r?.closedVsd),
            openMemberVsd: n(r?.openMemberVsd),
            openMembershipDiscount,
            membershipDiscount,
            openToCollect,
            openInvoices: n(r?.openInvoices),
          };
        })
      : [],
    billers: Array.isArray(resp.billers)
      ? resp.billers.map((r: any) => ({
          name: String(r?.name ?? '—'),
          role: String(r?.role ?? '—'),
          invoices: n(r?.invoices),
          remaining: n(r?.remaining),
        }))
      : [],
    openInvoices: Array.isArray(resp.openInvoices)
      ? resp.openInvoices.map(mapMatchInvoice)
      : [],
    closedInvoices: Array.isArray(resp.closedInvoices)
      ? resp.closedInvoices.map(mapMatchInvoice)
      : [],
    paymentTypes: Array.isArray(resp.paymentTypes)
      ? resp.paymentTypes.map((r: any) => ({
          type: String(r?.type ?? '(none)'),
          count: n(r?.count),
          total: n(r?.total),
          inPracticeCompare: r?.inPracticeCompare !== false,
        }))
      : [],
  };
}

function mapMatchInvoice(r: any): VsdPaymentsMatchInvoice {
  const status = r?.status;
  return {
    invoiceNumber: Number(r?.invoiceNumber) || 0,
    status: status === 'closed' || status === 'paid' ? status : 'open',
    serviceDate: String(r?.serviceDate ?? '').slice(0, 10),
    client: String(r?.client ?? '—'),
    remaining: Number(r?.remaining) || 0,
    vsd: Number(r?.vsd) || 0,
    doctor: String(r?.doctor ?? 'Not specified'),
    billedBy: String(r?.billedBy ?? '—'),
    billedRole: String(r?.billedRole ?? '—'),
    paymentType: String(r?.paymentType ?? 'None on file'),
    age: String(r?.age ?? '—'),
  };
}
