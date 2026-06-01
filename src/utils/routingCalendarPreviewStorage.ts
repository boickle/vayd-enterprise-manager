/**
 * Session payload when Routing → "My Week" opens the practice calendar with a proposed slot.
 * Read by Scheduler; written by Routing.
 */
import type { RescheduleOriginalVisitSnapshot } from '../api/routing';
/** Same id on practice `Appointment` rows and doctor-day synthetic visits so drive ETA maps line up. */
export const SCHEDULER_ROUTING_PREVIEW_SYNTHETIC_APPT_ID = -0x7eedf00d;

export const ROUTING_CALENDAR_PREVIEW_STORAGE_KEY = 'vayd:routing-calendar-preview';

/** Fired on `window` after `writeRoutingCalendarPreview` when the practice calendar is embedded beside Routing. */
export const ROUTING_CALENDAR_PREVIEW_UPDATED_EVENT = 'vayd:routing-calendar-preview-updated';

/** Return embedded calendar to the visit being rescheduled (clear purple preview, green highlight). */
export const ROUTING_FOCUS_RESCHEDULE_SOURCE_EVENT = 'vayd:routing-focus-reschedule-source';

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
  /** Used for calendar preview chip; may be a fallback when the user did not pick a type in Routing. */
  appointmentTypeId: number;
  /** True when the user picked a type in Routing → Calculate Time before opening the calendar preview. */
  appointmentTypeChosenInRouting?: boolean;
  clientDisplayLabel?: string;
  /** PATCH target when confirming from routing calendar preview (reschedule flow). */
  rescheduleAppointmentId?: number;
  /** When rescheduling all household pets today, PATCH each id to the new slot. */
  rescheduleAppointmentIds?: number[];
  reschedulePatientId?: string;
  /** Pets shown on the calendar preview chip (all household when rescheduling "all pets today"). */
  previewPatients?: { id: number | string; name: string }[];
  /** From POST /routing/v2 — required for POST /routing/feedback after book. */
  routingRequestId?: string;
  /** Source doctor score at the visit's current slot (cross-doctor reschedule compare). */
  rescheduleSourceVisitSnapshot?: RescheduleOriginalVisitSnapshot;
  /** Index in routing `top` (0 = winner); required for accepted feedback. */
  candidateIndex?: number;
  candidateId?: string;
  /**
   * Routing result card key (`doctorPimsId-date-insertionIndex-candidateIndex`) using the
   * list’s PIMS doctor id — not the internal id stored on `option.doctorPimsId` for the calendar.
   */
  listOptionKey?: string;
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
  notifyRoutingCalendarPreviewUpdated();
}

export function clearRoutingCalendarPreview(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(ROUTING_CALENDAR_PREVIEW_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  notifyRoutingCalendarPreviewUpdated();
}

/** Match key used by Routing result cards (`routingOptionKey`). */
export function routingCalendarPreviewOptionKey(preview: RoutingCalendarPreviewPayloadV1): string {
  if (preview.listOptionKey?.trim()) return preview.listOptionKey.trim();
  const o = preview.option;
  const cand =
    preview.candidateIndex ??
    (typeof o.candidateIndex === 'number' ? o.candidateIndex : undefined);
  return routingCalendarOptionKey({
    doctorPimsId: String(o.doctorPimsId ?? ''),
    date: String(o.date ?? ''),
    insertionIndex: Number(o.insertionIndex ?? 0),
    candidateIndex: cand,
  });
}

function notifyRoutingCalendarPreviewUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ROUTING_CALENDAR_PREVIEW_UPDATED_EVENT));
  }
}
