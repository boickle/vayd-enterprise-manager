// src/api/audit.ts
import { http } from './http';

/* =========================
 * Types
 * ========================= */

export type AuditSummary = {
  start: string;
  end: string;
  totalRequests: number;
  distinctUsers: number;
  errorCount: number;
  avgDurationMs: number;
  byMethod: Array<{ method: string; count: number; avgDurationMs: number }>;
  byStatus: Array<{ status: number; count: number }>;
  topEndpoints: Array<{
    path: string;
    count: number;
    uniqueUsers: number;
    avgDurationMs: number;
    errorRate: number; // 0..1
  }>;
};

export type AuditDailyPoint = {
  date: string; // YYYY-MM-DD (or ISO)
  requests: number;
  errors: number;
  avgDurationMs: number;
};
export type AuditDailySeries = {
  start: string;
  end: string;
  userId: string | null;
  days: AuditDailyPoint[];
};

export type AuditTopUser = {
  userId: string | null;
  count: number;
  avgDurationMs: number;
  errorCount: number;
  firstSeen?: string;
  lastSeen?: string;
};

export type AuditTopEndpoint = {
  path: string;
  count: number;
  uniqueUsers: number;
  avgDurationMs: number;
  errorRate: number; // 0..1
};

export type AuditHeatmapCell = {
  weekday: number; // 0=Sun .. 6=Sat
  hour: number; // 0..23
  count: number;
  avgDurationMs: number;
};
export type AuditHeatmap = {
  start: string;
  end: string;
  cells: AuditHeatmapCell[];
};

export type AuditEventRow = {
  occurredAt: string; // ISO datetime
  method: string;
  path: string;
  statusCode: number | null;
  userId: string | null;
  durationMs: number | null;
  requestId?: string;
};

/* =========================
 * Helpers
 * ========================= */

const n = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/* =========================
 * Calls
 * ========================= */

/** GET /admin/audit/summary */
export async function fetchAuditSummary(params: {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}): Promise<AuditSummary> {
  const { data } = await http.get('/admin/audit/summary', { params });

  // Normalize numbers where useful; keep unknown keys as-is
  const byMethod = (Array.isArray(data?.byMethod) ? data.byMethod : []).map((r: any) => ({
    method: String(r.method ?? ''),
    count: n(r.count),
    avgDurationMs: n(r.avgDurationMs),
  }));

  const byStatus = (Array.isArray(data?.byStatus) ? data.byStatus : []).map((r: any) => ({
    status: n(r.status),
    count: n(r.count),
  }));

  // Some backends might name this "byPath"; support both
  const rawTop = Array.isArray(data?.topEndpoints)
    ? data.topEndpoints
    : Array.isArray(data?.byPath)
      ? data.byPath
      : [];
  const topEndpoints = rawTop.map((r: any) => ({
    path: String(r.path ?? ''),
    count: n(r.count),
    uniqueUsers: n(r.uniqueUsers),
    avgDurationMs: n(r.avgDurationMs),
    errorRate: Number(r.errorRate ?? 0),
  }));

  return {
    start: String(data?.start ?? params.start),
    end: String(data?.end ?? params.end),
    totalRequests: n(data?.totalRequests),
    distinctUsers: n(data?.distinctUsers),
    errorCount: n(data?.errorCount),
    avgDurationMs: n(data?.avgDurationMs),
    byMethod,
    byStatus,
    topEndpoints,
  };
}

/** GET /admin/audit/series/daily */
export async function fetchAuditDailySeries(params: {
  start: string;
  end: string;
  userId?: string | null;
}): Promise<AuditDailySeries> {
  const { data } = await http.get('/admin/audit/series/daily', {
    params: { ...params, userId: params.userId ?? undefined },
  });

  const days = (Array.isArray(data?.days) ? data.days : []).map((r: any) => ({
    date: String(r.date),
    requests: n(r.requests),
    errors: n(r.errors),
    avgDurationMs: n(r.avgDurationMs),
  }));

  return {
    start: String(data?.start ?? params.start),
    end: String(data?.end ?? params.end),
    userId: data?.userId ?? params.userId ?? null,
    days,
  };
}

/** GET /admin/audit/top-users */
export async function fetchAuditTopUsers(params: {
  start: string;
  end: string;
  limit?: number;
  method?: string;
  pathPrefix?: string;
}): Promise<AuditTopUser[]> {
  const { data } = await http.get('/admin/audit/top-users', { params });
  const rows: any[] = Array.isArray(data) ? data : (data?.rows ?? []);
  return rows.map((r) => ({
    userId: r.userId ?? null,
    count: n(r.count),
    avgDurationMs: n(r.avgDurationMs),
    errorCount: n(r.errorCount),
    firstSeen: r.firstSeen ? String(r.firstSeen) : undefined,
    lastSeen: r.lastSeen ? String(r.lastSeen) : undefined,
  }));
}

/** GET /admin/audit/top-endpoints */
export async function fetchAuditTopEndpoints(params: {
  start: string;
  end: string;
  limit?: number;
  method?: string;
  pathPrefix?: string;
}): Promise<AuditTopEndpoint[]> {
  const { data } = await http.get('/admin/audit/top-endpoints', { params });
  const rows: any[] = Array.isArray(data) ? data : (data?.rows ?? []);
  return rows.map((r) => ({
    path: String(r.path ?? ''),
    count: n(r.count),
    uniqueUsers: n(r.uniqueUsers),
    avgDurationMs: n(r.avgDurationMs),
    errorRate: Number(r.errorRate ?? 0),
  }));
}

/** GET /admin/audit/heatmap */
export async function fetchAuditHeatmap(params: {
  start: string;
  end: string;
}): Promise<AuditHeatmap> {
  const { data } = await http.get('/admin/audit/heatmap', { params });
  const cells = (Array.isArray(data?.cells) ? data.cells : []).map((r: any) => ({
    weekday: n(r.weekday),
    hour: n(r.hour),
    count: n(r.count),
    avgDurationMs: n(r.avgDurationMs),
  }));
  return {
    start: String(data?.start ?? params.start),
    end: String(data?.end ?? params.end),
    cells,
  };
}

/** GET /admin/audit/errors/recent */
export async function fetchAuditRecentErrors(params: {
  start: string;
  end: string;
  limit?: number;
}): Promise<AuditEventRow[]> {
  const { data } = await http.get('/admin/audit/errors/recent', { params });
  const rows: any[] = Array.isArray(data) ? data : (data?.rows ?? []);
  return rows.map((r) => ({
    occurredAt: String(r.occurredAt),
    method: String(r.method ?? ''),
    path: String(r.path ?? ''),
    statusCode: r.statusCode != null ? n(r.statusCode) : null,
    userId: r.userId ?? null,
    durationMs: r.durationMs != null ? n(r.durationMs) : null,
    requestId: r.requestId ? String(r.requestId) : undefined,
  }));
}

/** GET /admin/audit/slow */
export async function fetchAuditSlowRequests(params: {
  start: string;
  end: string;
  minDurationMs?: number;
  limit?: number;
}): Promise<AuditEventRow[]> {
  const { data } = await http.get('/admin/audit/slow', { params });
  const rows: any[] = Array.isArray(data) ? data : (data?.rows ?? []);
  return rows.map((r) => ({
    occurredAt: String(r.occurredAt),
    method: String(r.method ?? ''),
    path: String(r.path ?? ''),
    statusCode: r.statusCode != null ? n(r.statusCode) : null,
    userId: r.userId ?? null,
    durationMs: r.durationMs != null ? n(r.durationMs) : null,
    requestId: r.requestId ? String(r.requestId) : undefined,
  }));
}
