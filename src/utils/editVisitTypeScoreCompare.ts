import { DateTime } from 'luxon';
import type { AppointmentType } from '../api/appointmentSettings';
import type { Provider } from '../api/employee';
import { fetchTypeChangePreview, type TypeChangePreviewResponse } from '../api/routing';
import type { TypeChangeFeedbackHandoff } from '../api/routing';
import type { Appointment } from '../api/roomLoader';
import {
  feedbackHandoffFromPreviewResult,
  inPlacePreviewOverflowOverrunSeconds,
} from './editVisitPreviewScoreHandoff';
import {
  rescheduleOriginalScoreSummary,
  rescheduleScoreHeaderSuffix,
} from './routingRescheduleScoreCompare';

export type EditVisitTypeScoreCompare = {
  originalScore: number | null;
  newScore: number | null;
  headerSuffix: string | null;
  summaryLine: string | null;
  originalScoreLine: string | null;
  newTypeUnavailableLine: string | null;
  windowLine: string | null;
  windowWarningMayChange: boolean;
  arrivalWindowAfter: { startIso: string; endIso: string } | null;
  withNewTypeFeasible: boolean | null;
  withNewTypeReason: string | null;
  /** From `withNewType.scoringComponents` — downstream visits may need window badges on the calendar. */
  downstreamWindowEdge: number | null;
  /** When preview scored with depot overflow — informational, does not block score or feedback. */
  overflowOverrunSeconds: number | null;
  /** For POST /routing/feedback after Book; null when infeasible or unscorable. */
  feedbackHandoff: TypeChangeFeedbackHandoff | null;
};

/** Shared score-compare shape for type and time edit-visit previews. */
export type EditVisitPreviewScoreCompare = EditVisitTypeScoreCompare;

function formatScore(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function humanizeInPlaceReason(
  reason: string,
  context: 'type' | 'time' = 'type'
): string {
  const r = reason.trim().toLowerCase();
  switch (r) {
    case 'window-violation':
      return context === 'time'
        ? 'This time cannot be served within the arrival window at this slot.'
        : 'This type cannot be served on time at the current slot (arrival window or fixed-time violation).';
    case 'personal-block-conflict':
      return 'The visit overlaps a personal block at this time.';
    case 'overtime':
      return context === 'time'
        ? 'This time would push return-to-depot past the allowed overtime.'
        : 'This type at this slot would push return-to-depot past the allowed overtime.';
    case 'drive-infeasible':
      return context === 'time'
        ? 'Drive timing is infeasible at this time on the route.'
        : 'Drive timing is infeasible at this slot with the new type.';
    default:
      return reason.trim().replace(/-/g, ' ');
  }
}

/** Numeric score from in-place preview snapshot — include even when feasible is false. */
export function inPlacePreviewNewScore(
  snapshot: { found?: boolean; score?: number | null } | null | undefined
): number | null {
  if (!snapshot?.found || typeof snapshot.score !== 'number' || !Number.isFinite(snapshot.score)) {
    return null;
  }
  return snapshot.score;
}

function resolveDoctorPimsId(appt: Appointment, providers: readonly Provider[]): string | null {
  const pp = appt.primaryProvider;
  if (!pp) return null;
  const internal = pp.id != null ? String(pp.id) : '';
  const byInternal = internal
    ? providers.find((p) => String(p.id) === internal)
    : undefined;
  if (byInternal?.pimsId != null && String(byInternal.pimsId).trim()) {
    return String(byInternal.pimsId).trim();
  }
  if (pp.pimsId != null && String(pp.pimsId).trim()) return String(pp.pimsId).trim();
  return internal.trim() || null;
}

function isFixedTimeTypeName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return lower === 'fixed time' || lower.includes('fixed time');
}

function arrivalWindowLabel(type: AppointmentType | undefined): string | null {
  if (!type) return null;
  const name = (type.name || type.prettyName || '').trim();
  if (isFixedTimeTypeName(name)) return 'Fixed time (scheduled slot)';
  const before = type.windowBeforeMinutes;
  const after = type.windowAfterMinutes;
  if (before == null && after == null) return 'Standard window (default ~2 hr)';
  const b = before ?? 60;
  const a = after ?? 60;
  const total = b + a;
  if (total <= 75) return `~${Math.round(total / 60)} hr total arrival window`;
  return `${b} min before · ${a} min after scheduled time`;
}

function formatArrivalWindowRange(
  range: { startIso: string; endIso: string } | null | undefined,
  practiceTz: string
): string | null {
  if (!range?.startIso || !range?.endIso) return null;
  const start = DateTime.fromISO(range.startIso).setZone(practiceTz);
  const end = DateTime.fromISO(range.endIso).setZone(practiceTz);
  if (!start.isValid || !end.isValid) return null;
  const sameDay = start.toISODate() === end.toISODate();
  if (start.equals(end)) return start.toFormat('t');
  if (sameDay) {
    return `${start.toFormat('t')}–${end.toFormat('t')}`;
  }
  return `${start.toFormat('ccc t')} – ${end.toFormat('ccc t')}`;
}

function windowLineFromPreview(
  preview: TypeChangePreviewResponse,
  originalType: AppointmentType | undefined,
  newType: AppointmentType | undefined,
  practiceTz: string
): string | null {
  const beforeLabel = formatArrivalWindowRange(preview.arrivalWindow?.before, practiceTz);
  const afterLabel = formatArrivalWindowRange(preview.arrivalWindow?.after, practiceTz);
  if (beforeLabel && afterLabel && beforeLabel !== afterLabel) {
    return `Arrival window: ${beforeLabel} → ${afterLabel}`;
  }
  const originalWindow = arrivalWindowLabel(originalType);
  const newWindow = arrivalWindowLabel(newType);
  if (originalWindow && newWindow && originalWindow !== newWindow) {
    return `Arrival window: ${originalWindow} → ${newWindow}`;
  }
  return null;
}

export async function fetchEditVisitTypeScoreCompare(args: {
  appt: Appointment;
  newAppointmentTypeId: number;
  practiceDateKey: string;
  practiceTz: string;
  providers: readonly Provider[];
  appointmentTypes: readonly AppointmentType[];
}): Promise<EditVisitTypeScoreCompare> {
  const { appt, newAppointmentTypeId, practiceDateKey, practiceTz } = args;
  const doctorPimsId = resolveDoctorPimsId(appt, args.providers);
  const originalType = appt.appointmentType as AppointmentType | undefined;
  const newType = args.appointmentTypes.find((t) => t.id === newAppointmentTypeId);

  const empty = (summaryLine: string): EditVisitTypeScoreCompare => ({
    originalScore: null,
    newScore: null,
    headerSuffix: null,
    summaryLine,
    originalScoreLine: null,
    newTypeUnavailableLine: null,
    windowLine: null,
    windowWarningMayChange: false,
    arrivalWindowAfter: null,
    withNewTypeFeasible: null,
    withNewTypeReason: null,
    downstreamWindowEdge: null,
    overflowOverrunSeconds: null,
    feedbackHandoff: null,
  });

  if (!doctorPimsId || !practiceDateKey) {
    return empty('Select a provider and valid visit date to compare routing scores.');
  }

  const apptId = Number(appt.id);
  if (!Number.isFinite(apptId)) {
    return empty('Invalid appointment — score comparison unavailable.');
  }

  const preview = await fetchTypeChangePreview({
    doctorId: doctorPimsId,
    date: practiceDateKey,
    appointmentId: apptId,
    newAppointmentTypeId,
    useTraffic: true,
  });

  const arrivalWindowAfter =
    preview.arrivalWindow?.after?.startIso && preview.arrivalWindow?.after?.endIso
      ? preview.arrivalWindow.after
      : null;
  const withNewTypeFeasible =
    preview.withNewType.feasible === true
      ? true
      : preview.withNewType.feasible === false
        ? false
        : null;
  const withNewTypeReason = preview.withNewType.reason?.trim() || null;
  const downstreamEdge = preview.withNewType.scoringComponents?.downstreamWindowEdge;
  const downstreamWindowEdge =
    typeof downstreamEdge === 'number' && Number.isFinite(downstreamEdge) && downstreamEdge > 0
      ? downstreamEdge
      : null;
  const feedbackHandoff = feedbackHandoffFromPreviewResult({
    feedbackHandoff: preview.feedbackHandoff,
    withNew: preview.withNewType,
    apptId,
  });
  const overflowOverrunSeconds = inPlacePreviewOverflowOverrunSeconds(preview.withNewType);

  const windowLine = windowLineFromPreview(preview, originalType, newType, practiceTz);
  const windowWarningMayChange = Boolean(
    windowLine &&
      (isFixedTimeTypeName(newType?.name || newType?.prettyName || '') ||
        isFixedTimeTypeName(originalType?.name || originalType?.prettyName || ''))
  );

  const originalScore =
    preview.original.found && typeof preview.original.score === 'number'
      ? preview.original.score
      : null;
  const newScore = inPlacePreviewNewScore(preview.withNewType);
  const isInfeasible = preview.withNewType.feasible === false;

  const originalVisitForSummary = {
    found: originalScore != null,
    score: originalScore ?? undefined,
    appointmentId: apptId,
  };
  const originalScoreLine = rescheduleOriginalScoreSummary(originalVisitForSummary);

  if (newScore == null) {
    const reason = preview.withNewType.reason
      ? humanizeInPlaceReason(preview.withNewType.reason, 'type')
      : preview.withNewType.feasible === false
        ? 'This type is not feasible at the current scheduled time.'
        : 'Could not score this visit at the current slot with the new type.';
    return {
      originalScore,
      newScore: null,
      headerSuffix: null,
      summaryLine: originalScoreLine == null ? reason : null,
      originalScoreLine,
      newTypeUnavailableLine: reason,
      windowLine,
      windowWarningMayChange,
      arrivalWindowAfter,
      withNewTypeFeasible,
      withNewTypeReason,
      downstreamWindowEdge,
      overflowOverrunSeconds,
      feedbackHandoff: null,
    };
  }

  const headerSuffix = rescheduleScoreHeaderSuffix(newScore, originalVisitForSummary);
  const summaryLine = headerSuffix
    ? headerSuffix.replace(/^\(/, '').replace(/\)$/, '')
    : `Score with new type: ${formatScore(newScore)}`;

  const infeasibleReason =
    isInfeasible && preview.withNewType.reason
      ? humanizeInPlaceReason(preview.withNewType.reason, 'type')
      : isInfeasible
        ? 'This type is not feasible at the current scheduled time.'
        : null;

  return {
    originalScore,
    newScore,
    headerSuffix,
    summaryLine,
    originalScoreLine: infeasibleReason ? null : originalScoreLine,
    newTypeUnavailableLine: infeasibleReason,
    windowLine,
    windowWarningMayChange,
    arrivalWindowAfter,
    withNewTypeFeasible,
    withNewTypeReason,
    downstreamWindowEdge,
    overflowOverrunSeconds,
    feedbackHandoff: isInfeasible ? null : feedbackHandoff,
  };
}
