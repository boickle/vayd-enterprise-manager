import { http } from './http';

/**
 * Single cancellation row (flattened from `byDay[].cancellations[]` or a top-level array).
 * The UI shows every field in a detail modal.
 */
export type CancelledAppointmentAnalyticsRow = Record<string, unknown>;

/** One calendar day from GET /analytics/appointment-cancellations. */
export type AppointmentCancellationsByDay = {
  date: string;
  count: number;
  cancellations: CancelledAppointmentAnalyticsRow[];
};

/**
 * Primary response shape from GET /analytics/appointment-cancellations.
 * Rows are nested under `byDay[].cancellations`; `normalizeAppointmentCancellationsResponse` flattens them.
 */
export type AppointmentCancellationsAnalyticsResponse = {
  startDate?: string;
  endDate?: string;
  totalCancellations?: number;
  byDay?: AppointmentCancellationsByDay[];
  appointments?: CancelledAppointmentAnalyticsRow[];
};

function asArray(raw: unknown): CancelledAppointmentAnalyticsRow[] {
  if (Array.isArray(raw)) return raw as CancelledAppointmentAnalyticsRow[];
  return [];
}

function flattenByDay(o: Record<string, unknown>): CancelledAppointmentAnalyticsRow[] {
  const byDay = o.byDay;
  if (!Array.isArray(byDay)) return [];
  const out: CancelledAppointmentAnalyticsRow[] = [];
  for (const day of byDay) {
    if (!day || typeof day !== 'object') continue;
    const d = day as Record<string, unknown>;
    const cans = d.cancellations;
    if (!Array.isArray(cans)) continue;
    for (const row of cans) {
      if (row && typeof row === 'object') out.push(row as CancelledAppointmentAnalyticsRow);
    }
  }
  return out;
}

/** Flatten `byDay` or fall back to a top-level array field. */
export function normalizeAppointmentCancellationsResponse(raw: unknown): CancelledAppointmentAnalyticsRow[] {
  if (!raw || typeof raw !== 'object') return [];
  if (Array.isArray(raw)) return raw as CancelledAppointmentAnalyticsRow[];
  const o = raw as Record<string, unknown>;
  if (Array.isArray(o.byDay)) return flattenByDay(o);
  const from =
    o.appointments ??
    o.cancellations ??
    o.items ??
    o.data ??
    o.rows ??
    (Array.isArray(o.results) ? o.results : null);
  return asArray(from);
}

export async function fetchAppointmentCancellationsAnalytics(params: {
  startDate: string;
  endDate: string;
}): Promise<CancelledAppointmentAnalyticsRow[]> {
  const { data } = await http.get<unknown>('/analytics/appointment-cancellations', {
    params: {
      startDate: params.startDate,
      endDate: params.endDate,
    },
  });
  return normalizeAppointmentCancellationsResponse(data);
}
