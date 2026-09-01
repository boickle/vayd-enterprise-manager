/**
 * Session payload when Routing → "My Week" opens the practice calendar with a proposed slot.
 * Read by Scheduler; written by Routing.
 */
import type { RescheduleOriginalVisitSnapshot } from '../api/routing';
import type { OptimizeMove } from './scheduleOptimizeMoves';

/** Same id on practice `Appointment` rows and doctor-day synthetic visits so drive ETA maps line up. */
export const SCHEDULER_ROUTING_PREVIEW_SYNTHETIC_APPT_ID = -0x7eedf00d;

export const ROUTING_CALENDAR_PREVIEW_STORAGE_KEY = 'vayd:routing-calendar-preview';

/** Fired on `window` after `writeRoutingCalendarPreview` when the practice calendar is embedded beside Routing. */
export const ROUTING_CALENDAR_PREVIEW_UPDATED_EVENT = 'vayd:routing-calendar-preview-updated';

/** Scheduler → Routing: reconciled POST /routing/eta window warnings for the active preview card. */
export const ROUTING_PREVIEW_ETA_WINDOW_WARNINGS_EVENT = 'vayd:routing-preview-eta-window-warnings';

export type RoutingPreviewEtaWindowWarningsDetail = {
  optionKey: string;
  hasWindowWarning: boolean;
  warningStopCount: number;
  candidateHasWarning: boolean;
  /**
   * Depot-return overrun from reconciled POST /routing/eta (seconds past endDepotTime).
   * Used so Get Best Route OVERFLOW badges match calendar preview / post-book reality.
   */
  reconciledOverrunSeconds?: number | null;
};

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
    /** PIMS client id — matches doctor-day household grouping with booked visits. */
    clientPimsId?: string;
    address?: string;
    lat?: number;
    lon?: number;
    city?: string;
    state?: string;
    zip?: string;
  };
  /** When true with a linked client, `newApptMeta.address` is an alternate stop (not client home). */
  routingUsesAlternateAddress?: boolean;
  /** Used for calendar preview chip; may be a fallback when the user did not pick a type in Routing. */
  appointmentTypeId: number;
  /** True when the user picked a type in Routing → Calculate Time before opening the calendar preview. */
  appointmentTypeChosenInRouting?: boolean;
  /** Calculate Time dropdown value (`AppointmentType.name`) at preview time. */
  routingStatsTypeKey?: string;
  clientDisplayLabel?: string;
  /** PATCH target when confirming from routing calendar preview (reschedule flow). */
  rescheduleAppointmentId?: number;
  /** When rescheduling all household pets today, PATCH each id to the new slot. */
  rescheduleAppointmentIds?: number[];
  /**
   * Explore Alternatives: keep original appointment(s) on the calendar while previewing a new slot.
   * When set, Scheduler must not hide `rescheduleAppointmentIds` as it does for true reschedule.
   */
  exploreAlternatives?: boolean;
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
  /** Preview opened from Schedule Loader (Fill Day) rather than Get Best Route. */
  previewSource?: 'routing' | 'schedule-loader' | 'waitlist' | 'manual-book' | 'schedule-optimize';
  /** Return navigation when dismissing preview from Schedule Loader. */
  scheduleLoaderReturn?: {
    clientId: number;
    returnHref: string;
  };
  waitlistReturn?: {
    entryId: number;
    clientId: number;
    returnHref: string;
  };
  scheduleOptimizeReturn?: {
    queueItemId: string;
    returnHref: string;
    /** Opened from “view current appointment”; Back should restore that view. */
    fromCurrentView?: boolean;
    /** Full suggestion — used for Add to list and post-book SMS without auto-queueing on view. */
    listMove?: OptimizeMove;
  };
  /** Stored manual book form — Book from preview or Back to form restores this. */
  manualBookDraft?: ManualBookPreviewDraft;
};

export type ManualBookPreviewDraft = {
  practiceId: number;
  primaryProviderId: number;
  appointmentTypeId: number;
  clientId?: string;
  clientLabel?: string;
  patientId?: string;
  patientLabel?: string;
  description?: string;
  instructions?: string;
  alternateAddressText?: string;
  additionalEmployeeIds?: number[];
  appointmentStartIso: string;
  appointmentEndIso: string;
  modalTitle?: string;
  clientLat?: number;
  clientLon?: number;
  clientAddress?: string;
  clientCity?: string;
  clientState?: string;
  clientZip?: string;
  /** Co-visit add-pet: PATCH these existing household visits to the draft times on confirm. */
  coVisitAlignAppointmentIds?: number[];
  /** Anchor visit when adding another pet (for household clump / alt-stop preview). */
  coVisitAnchorAppointmentId?: number;
  /** Co-visit add-pet — skip manual booking type permission gate on create. */
  coVisitAddPet?: boolean;
  /**
   * After euthanasia future-appointment prompt in the book modal:
   * delete those patient-scoped future rows after a successful preview commit.
   */
  euthanasiaDeleteFutureAppointments?: boolean;
};

export function isScheduleLoaderCalendarPreview(
  preview: RoutingCalendarPreviewPayloadV1 | null | undefined,
): boolean {
  return preview?.previewSource === 'schedule-loader';
}

export function isManualBookCalendarPreview(
  preview: RoutingCalendarPreviewPayloadV1 | null | undefined,
): boolean {
  return preview?.previewSource === 'manual-book';
}

export function isWaitlistCalendarPreview(
  preview: RoutingCalendarPreviewPayloadV1 | null | undefined,
): boolean {
  return preview?.previewSource === 'waitlist';
}

export function isScheduleOptimizeCalendarPreview(
  preview: RoutingCalendarPreviewPayloadV1 | null | undefined,
): boolean {
  return preview?.previewSource === 'schedule-optimize';
}

export function scheduleLoaderReturnHref(
  preview: RoutingCalendarPreviewPayloadV1 | null | undefined,
): string | null {
  const href = preview?.scheduleLoaderReturn?.returnHref?.trim();
  return href || null;
}

export function waitlistReturnHref(
  preview: RoutingCalendarPreviewPayloadV1 | null | undefined,
): string | null {
  const href = preview?.waitlistReturn?.returnHref?.trim();
  return href || null;
}

export function scheduleOptimizeReturnHref(
  preview: RoutingCalendarPreviewPayloadV1 | null | undefined,
): string | null {
  const href = preview?.scheduleOptimizeReturn?.returnHref?.trim();
  return href || null;
}

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

export function notifyRoutingPreviewEtaWindowWarnings(detail: RoutingPreviewEtaWindowWarningsDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<RoutingPreviewEtaWindowWarningsDetail>(ROUTING_PREVIEW_ETA_WINDOW_WARNINGS_EVENT, {
      detail,
    })
  );
}
