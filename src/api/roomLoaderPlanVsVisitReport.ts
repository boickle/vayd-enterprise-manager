// src/api/roomLoaderPlanVsVisitReport.ts
import { http } from './http';

export type PlanVsVisitDateBasis = 'created' | 'updated' | 'appointment_start';

export type PlanVsVisitPlannedLineItem = {
  patientId?: number | null;
  patientName?: string | null;
  itemId?: number | null;
  itemType?: string | null;
  code?: string | null;
  name?: string | null;
  category?: string | null;
  quantity?: number | null;
  source?: string | null;
};

export type PlanVsVisitOfferedReminder = {
  reminderId?: number | null;
  id?: number | null;
  code?: string | null;
  type?: string | null;
  name?: string | null;
};

export type PlanVsVisitPerformedLineItem = {
  id?: number | null;
  /** Primary id on treatment lines in plan-vs-visit report. */
  treatmentItemId?: number | null;
  /** Catalog / item definition id (used with matchedBy: catalog_id). */
  catalogId?: number | null;
  labId?: number | null;
  procedureId?: number | null;
  inventoryItemId?: number | null;
  code?: string | null;
  name?: string | null;
  itemType?: string | null;
  quantity?: number | null;
  isDeclined?: boolean | null;
};

export type PlanVsVisitAppointmentRow = {
  /** API uses appointmentId (preferred). */
  appointmentId?: number | null;
  id?: number | null;
  appointmentPimsId?: string | null;
  pimsId?: string | null;
  appointmentStart?: string | null;
  appointmentEnd?: string | null;
  start?: string | null;
  end?: string | null;
  isComplete?: boolean | null;
  patientId?: number | null;
  patientName?: string | null;
  treatmentId?: number | null;
  treatmentPatientId?: number | null;
  performedLineItems?: PlanVsVisitPerformedLineItem[];
};

/** One row inside `matches[]`: planned payload + match outcome (current API). */
export type PlanVsVisitPlannedMatchEnvelope = {
  planned: PlanVsVisitPlannedLineItem;
  matchedPerformedTreatmentItemId?: number | string | null;
  matchedPerformedItemId?: number | string | null;
  matchedBy?: string | null;
};

/** One appointment’s planned lines vs performed matches (shape may vary slightly by API version). */
export type PlanVsVisitPlannedMatchesForAppointment = {
  appointmentId?: number | null;
  id?: number | null;
  patientId?: number | null;
  /** Backend may use plannedLines, lines, matches, or plannedLineMatches */
  plannedLines?: PlanVsVisitPlannedMatchLine[];
  lines?: PlanVsVisitPlannedMatchLine[];
  /** Often an array of `{ planned, matchedPerformedTreatmentItemId, matchedBy }` envelopes. */
  matches?: Array<PlanVsVisitPlannedMatchLine | PlanVsVisitPlannedMatchEnvelope>;
  plannedLineMatches?: PlanVsVisitPlannedMatchLine[];
};

export type PlanVsVisitPlannedMatchLine = {
  patientId?: number | null;
  itemId?: number | null;
  /** Backend may send catalog id under another key. */
  plannedItemId?: number | null;
  catalogItemId?: number | null;
  itemType?: string | null;
  code?: string | null;
  name?: string | null;
  category?: string | null;
  quantity?: number | null;
  matchedPerformedTreatmentItemId?: number | string | null;
  matchedPerformedItemId?: number | string | null;
};

/** One patient on a room loader: planned/offered data and that pet’s appointments + match blocks. */
export type PlanVsVisitPetRow = {
  patientId?: number | null;
  patientName?: string | null;
  plannedLineItems?: PlanVsVisitPlannedLineItem[];
  offeredReminders?: PlanVsVisitOfferedReminder[];
  offeredAddedItems?: PlanVsVisitOfferedReminder[];
  structuredForm?: Record<string, unknown> | null;
  appointments?: PlanVsVisitAppointmentRow[];
  plannedMatchesByAppointment?: PlanVsVisitPlannedMatchesForAppointment[];
};

export type PlanVsVisitReportRow = {
  roomLoaderId: number;
  roomLoaderPimsId?: string | null;
  sentStatus?: string | null;
  timesSentToClient?: number | null;
  created?: string | null;
  updated?: string | null;
  hasSentToClient?: boolean;
  hasResponseFromClient?: boolean;
  hasSavedForm?: boolean;
  /** New API: per-patient buckets (preferred when present). */
  pets?: PlanVsVisitPetRow[];
  /** Line items not tied to a patient (e.g. store add-ons). */
  plannedLineItemsWithoutPatient?: PlanVsVisitPlannedLineItem[];
  offeredRemindersWithoutPatient?: PlanVsVisitOfferedReminder[];
  offeredAddedItemsWithoutPatient?: PlanVsVisitOfferedReminder[];
  /** Legacy flat shape (single RL batch); ignored when `pets` is non-empty. */
  plannedLineItems?: PlanVsVisitPlannedLineItem[];
  offeredReminders?: PlanVsVisitOfferedReminder[];
  offeredAddedItems?: PlanVsVisitOfferedReminder[];
  structuredForm?: Record<string, unknown> | null;
  appointments?: PlanVsVisitAppointmentRow[];
  plannedMatchesByAppointment?: PlanVsVisitPlannedMatchesForAppointment[];
};

export type PlanVsVisitReportMeta = {
  practiceId: number;
  startDate: string;
  endDate: string;
  timezone?: string;
  dateBasis?: string;
  limit: number;
  offset: number;
  totalInRange: number;
};

export type PlanVsVisitReportResponse = {
  meta: PlanVsVisitReportMeta;
  rows: PlanVsVisitReportRow[];
};

export type FetchPlanVsVisitReportParams = {
  practiceId: number;
  startDate: string;
  endDate: string;
  timezone?: string;
  dateBasis?: PlanVsVisitDateBasis;
  limit?: number;
  offset?: number;
};

/**
 * Coerce GET /room-loader/report/plan-vs-visit JSON into { meta, rows }.
 * Compares client planned summary lines to treatment items performed on linked appointments.
 * Handles missing `meta`, wrapped `{ data: ... }`, and snake_case if the server ever sends it.
 */
function metaFieldsFromFlatResponse(o: Record<string, unknown>): Record<string, unknown> {
  return {
    practiceId: o.practiceId ?? o.practice_id,
    startDate: o.startDate ?? o.start_date,
    endDate: o.endDate ?? o.end_date,
    timezone: o.timezone ?? o.time_zone,
    dateBasis: o.dateBasis ?? o.date_basis,
    limit: o.limit,
    offset: o.offset,
    totalInRange: o.totalInRange ?? o.total_in_range,
  };
}

export function normalizePlanVsVisitReportResponse(
  raw: unknown,
  request: FetchPlanVsVisitReportParams
): PlanVsVisitReportResponse {
  const root = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const inner =
    root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : root;
  const rowsRaw = inner.rows ?? inner.Rows;
  const rows = Array.isArray(rowsRaw) ? (rowsRaw as PlanVsVisitReportRow[]) : [];
  /** Nested `{ meta: { ... } }` or flat `{ practiceId, rows, totalInRange, ... }` (current API). */
  const metaRaw =
    inner.meta && typeof inner.meta === 'object'
      ? (inner.meta as Record<string, unknown>)
      : inner.Meta && typeof inner.Meta === 'object'
        ? (inner.Meta as Record<string, unknown>)
        : metaFieldsFromFlatResponse(inner);
  const lim = Number(metaRaw.limit ?? request.limit ?? 100);
  const off = Number(metaRaw.offset ?? request.offset ?? 0);
  const totalRaw = metaRaw.totalInRange ?? metaRaw.total_in_range;
  const totalInRange =
    totalRaw != null && Number.isFinite(Number(totalRaw)) ? Number(totalRaw) : rows.length;

  const meta: PlanVsVisitReportMeta = {
    practiceId:
      Number(metaRaw.practiceId ?? metaRaw.practice_id ?? request.practiceId) || request.practiceId,
    startDate: String(metaRaw.startDate ?? metaRaw.start_date ?? request.startDate),
    endDate: String(metaRaw.endDate ?? metaRaw.end_date ?? request.endDate),
    timezone:
      metaRaw.timezone != null
        ? String(metaRaw.timezone)
        : request.timezone != null
          ? request.timezone
          : undefined,
    dateBasis:
      metaRaw.dateBasis != null
        ? String(metaRaw.dateBasis)
        : metaRaw.date_basis != null
          ? String(metaRaw.date_basis)
          : request.dateBasis,
    limit: Number.isFinite(lim) && lim > 0 ? Math.min(500, lim) : 100,
    offset: Number.isFinite(off) && off >= 0 ? off : 0,
    totalInRange: totalInRange >= 0 ? totalInRange : 0,
  };

  return { meta, rows };
}

export async function fetchRoomLoaderPlanVsVisitReport(
  params: FetchPlanVsVisitReportParams
): Promise<PlanVsVisitReportResponse> {
  const { data } = await http.get<unknown>('/room-loader/report/plan-vs-visit', {
    params: {
      practiceId: params.practiceId,
      startDate: params.startDate,
      endDate: params.endDate,
      ...(params.timezone ? { timezone: params.timezone } : {}),
      ...(params.dateBasis ? { dateBasis: params.dateBasis } : {}),
      ...(params.limit != null ? { limit: params.limit } : {}),
      ...(params.offset != null ? { offset: params.offset } : {}),
    },
  });
  return normalizePlanVsVisitReportResponse(data, params);
}
