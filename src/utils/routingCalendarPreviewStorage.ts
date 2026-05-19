/**
 * Session payload when Routing → "My Week" opens the practice calendar with a proposed slot.
 * Read by Scheduler; written by Routing.
 */
/** Same id on practice `Appointment` rows and doctor-day synthetic visits so drive ETA maps line up. */
export const SCHEDULER_ROUTING_PREVIEW_SYNTHETIC_APPT_ID = -0x7eedf00d;

export const ROUTING_CALENDAR_PREVIEW_STORAGE_KEY = 'vayd:routing-calendar-preview';

/** Fired on `window` after `writeRoutingCalendarPreview` when the practice calendar is embedded beside Routing. */
export const ROUTING_CALENDAR_PREVIEW_UPDATED_EVENT = 'vayd:routing-calendar-preview-updated';

export type RoutingCalendarPreviewPayloadV1 = {
  version: 1;
  /** Routing candidate (UnifiedOption) with internal doctor id in `doctorPimsId`. */
  option: Record<string, unknown> & {
    date: string;
    suggestedStartIso: string;
    doctorPimsId: string;
    doctorName: string;
    insertionIndex: number;
  };
  serviceMinutes: number;
  newApptMeta: {
    clientId?: string;
    address?: string;
    lat?: number;
    lon?: number;
    city?: string;
    state?: string;
    zip?: string;
  };
  appointmentTypeId: number;
  clientDisplayLabel?: string;
  /** PATCH target when confirming from routing calendar preview (reschedule flow). */
  rescheduleAppointmentId?: number;
  reschedulePatientId?: string;
  /** From POST /routing/v2 — required for POST /routing/feedback after book. */
  routingRequestId?: string;
  /** Index in routing `top` (0 = winner); required for accepted feedback. */
  candidateIndex?: number;
  candidateId?: string;
};

export function routingCalendarOptionKey(opt: {
  doctorPimsId?: string;
  date?: string;
  insertionIndex?: number;
  candidateIndex?: number;
}): string {
  return `${String(opt.doctorPimsId ?? '')}-${String(opt.date ?? '')}-${String(opt.insertionIndex ?? '')}-${opt.candidateIndex ?? ''}`;
}

export function readRoutingCalendarPreview(): RoutingCalendarPreviewPayloadV1 | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(ROUTING_CALENDAR_PREVIEW_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as RoutingCalendarPreviewPayloadV1;
    if (p?.version !== 1 || !p.option?.suggestedStartIso || !p.option?.doctorPimsId) return null;
    return p;
  } catch {
    return null;
  }
}

export function writeRoutingCalendarPreview(payload: RoutingCalendarPreviewPayloadV1): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(ROUTING_CALENDAR_PREVIEW_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

export function clearRoutingCalendarPreview(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(ROUTING_CALENDAR_PREVIEW_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
