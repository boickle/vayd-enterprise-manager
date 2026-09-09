/**
 * Prefetch POST /routing/eta window warnings for Get Best Route result cards
 * without requiring View Placement (Whelan / Crispell #bugs-scout 1788960436.153099).
 *
 * Same doctor-day + candidateSlot path as Scheduler View Placement so the amber
 * card alert matches the calendar preview Book popover.
 */
import type { AppointmentType } from '../api/appointmentSettings';
import { computeDepotReturnOverrunSeconds } from './depotReturnOverrun';
import { summarizeReconciledDayWindowWarnings } from './routingCardWindowWarning';
import type {
  RoutingCalendarPreviewPayloadV1,
  RoutingPreviewEtaWindowWarningsDetail,
} from './routingCalendarPreviewStorage';
import type { RoutingRescheduleIntentV1 } from './routingRescheduleIntent';
import { fetchSchedulerDriveContextForDate } from './schedulerDriveEta';

export type RoutingResultEtaPrefetchOption = {
  date: string;
  suggestedStartIso: string;
  doctorPimsId: string;
  doctorName: string;
  insertionIndex: number;
  positionInDay?: number;
  candidateIndex?: number;
  candidateId?: string;
  arrivalWindow?: {
    windowStartIso?: string | null;
    windowEndIso?: string | null;
  } | null;
  lat?: number | null;
  lon?: number | null;
};

export type RoutingResultEtaPrefetchInput = {
  optionKey: string;
  /** Internal employee id for GET /appointments/doctor + POST /routing/eta. */
  doctorInternalId: string;
  option: RoutingResultEtaPrefetchOption;
  serviceMinutes: number;
  appointmentTypeId: number;
  appointmentType?: AppointmentType | null;
  newApptMeta: RoutingCalendarPreviewPayloadV1['newApptMeta'];
  rescheduleIntent?: RoutingRescheduleIntentV1 | null;
  routingUsesAlternateAddress?: boolean;
};

function practiceDateKey(isoOrDate: string): string {
  const s = String(isoOrDate ?? '').trim();
  return s.length >= 10 ? s.slice(0, 10) : s;
}

/** Build the same preview payload shape View Placement writes (minus session side effects). */
export function buildRoutingResultEtaPrefetchPreview(
  input: RoutingResultEtaPrefetchInput
): RoutingCalendarPreviewPayloadV1 {
  const date = practiceDateKey(input.option.date);
  const opt = input.option;
  return {
    version: 1,
    listOptionKey: input.optionKey,
    option: {
      date,
      suggestedStartIso: opt.suggestedStartIso,
      doctorPimsId: input.doctorInternalId,
      doctorName: opt.doctorName,
      insertionIndex: opt.insertionIndex,
      ...(typeof opt.positionInDay === 'number' ? { positionInDay: opt.positionInDay } : {}),
      ...(opt.arrivalWindow?.windowStartIso && opt.arrivalWindow?.windowEndIso
        ? {
            arrivalWindow: {
              windowStartIso: opt.arrivalWindow.windowStartIso,
              windowEndIso: opt.arrivalWindow.windowEndIso,
            },
          }
        : {}),
      ...(opt.candidateIndex != null ? { candidateIndex: opt.candidateIndex } : {}),
      ...(opt.candidateId ? { candidateId: opt.candidateId } : {}),
      ...(Number.isFinite(opt.lat as number) ? { lat: opt.lat } : {}),
      ...(Number.isFinite(opt.lon as number) ? { lon: opt.lon } : {}),
    },
    serviceMinutes: Math.max(1, Math.floor(input.serviceMinutes) || 30),
    newApptMeta: { ...input.newApptMeta },
    ...(input.routingUsesAlternateAddress ? { routingUsesAlternateAddress: true } : {}),
    appointmentTypeId: input.appointmentTypeId,
    candidateIndex: opt.candidateIndex,
    candidateId: opt.candidateId,
  };
}

/**
 * Run doctor-day + /routing/eta for one result card; return the same detail
 * Scheduler emits on ROUTING_PREVIEW_ETA_WINDOW_WARNINGS_EVENT.
 */
export async function prefetchRoutingResultEtaWindowWarnings(
  input: RoutingResultEtaPrefetchInput
): Promise<RoutingPreviewEtaWindowWarningsDetail | null> {
  const date = practiceDateKey(input.option.date);
  if (!date || !input.doctorInternalId.trim()) return null;
  if (!String(input.option.suggestedStartIso ?? '').trim()) return null;

  const lat = input.newApptMeta.lat ?? input.option.lat;
  const lon = input.newApptMeta.lon ?? input.option.lon;
  if (!Number.isFinite(lat as number) || !Number.isFinite(lon as number)) return null;

  const routingPreview = buildRoutingResultEtaPrefetchPreview(input);
  const drive = await fetchSchedulerDriveContextForDate(date, input.doctorInternalId, {
    routingPreview,
    previewPracticeDateKey: date,
    previewAppointmentType: input.appointmentType ?? null,
    rescheduleIntent: input.rescheduleIntent ?? null,
  });
  if (!drive?.dayData) return null;

  const etaWindowSummary = summarizeReconciledDayWindowWarnings(drive.dayData);
  const reconciledOverrunSeconds = computeDepotReturnOverrunSeconds(drive.dayData);
  return {
    optionKey: input.optionKey,
    hasWindowWarning: etaWindowSummary.hasPlacementRelevantWarning,
    warningStopCount: etaWindowSummary.warningStopCount,
    candidateHasWarning: etaWindowSummary.candidateHasWarning,
    reconciledOverrunSeconds,
  };
}
