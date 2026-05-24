import type { Provider } from '../api/employee';
import { fetchTimeChangePreview } from '../api/routing';
import type { Appointment } from '../api/roomLoader';
import {
  feedbackHandoffFromPreviewResult,
  inPlacePreviewOverflowOverrunSeconds,
} from './editVisitPreviewScoreHandoff';
import {
  humanizeInPlaceReason,
  inPlacePreviewNewScore,
  type EditVisitPreviewScoreCompare,
} from './editVisitTypeScoreCompare';
import {
  rescheduleOriginalScoreSummary,
  rescheduleScoreHeaderSuffix,
} from './routingRescheduleScoreCompare';

export type { EditVisitPreviewScoreCompare };

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

function isTimeChangePreviewNotFound(err: unknown): boolean {
  const ax = err as {
    response?: { status?: number; data?: { statusCode?: number } };
  };
  const status = ax.response?.status ?? ax.response?.data?.statusCode;
  return status === 404;
}

export async function fetchEditVisitTimeScoreCompare(args: {
  appt: Appointment;
  newAppointmentStartIso: string;
  newAppointmentEndIso: string;
  practiceDateKey: string;
  providers: readonly Provider[];
}): Promise<EditVisitPreviewScoreCompare> {
  const { appt, newAppointmentStartIso, newAppointmentEndIso, practiceDateKey } = args;
  const doctorPimsId = resolveDoctorPimsId(appt, args.providers);

  const empty = (summaryLine: string): EditVisitPreviewScoreCompare => ({
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

  const preview = await fetchTimeChangePreview({
    doctorId: doctorPimsId,
    date: practiceDateKey,
    appointmentId: apptId,
    newAppointmentStartIso,
    newAppointmentEndIso,
    useTraffic: true,
  }).catch((err: unknown) => {
    if (isTimeChangePreviewNotFound(err)) {
      return null;
    }
    throw err;
  });

  if (!preview) {
    return empty(
      'Score comparison for time changes is not available yet (server update pending). Drive preview still works.'
    );
  }

  const withNewTimeFeasible =
    preview.withNewTime.feasible === true
      ? true
      : preview.withNewTime.feasible === false
        ? false
        : null;
  const withNewTimeReason = preview.withNewTime.reason?.trim() || null;
  const downstreamEdge = preview.withNewTime.scoringComponents?.downstreamWindowEdge;
  const downstreamWindowEdge =
    typeof downstreamEdge === 'number' && Number.isFinite(downstreamEdge) && downstreamEdge > 0
      ? downstreamEdge
      : null;
  const feedbackHandoff = feedbackHandoffFromPreviewResult({
    feedbackHandoff: preview.feedbackHandoff,
    withNew: preview.withNewTime,
    apptId,
  });
  const overflowOverrunSeconds = inPlacePreviewOverflowOverrunSeconds(preview.withNewTime);

  const originalScore =
    preview.original.found && typeof preview.original.score === 'number'
      ? preview.original.score
      : null;
  const newScore = inPlacePreviewNewScore(preview.withNewTime);
  const isInfeasible = preview.withNewTime.feasible === false;

  const originalVisitForSummary = {
    found: originalScore != null,
    score: originalScore ?? undefined,
    appointmentId: apptId,
  };
  const originalScoreLine = rescheduleOriginalScoreSummary(originalVisitForSummary);

  if (newScore == null) {
    const reason = preview.withNewTime.reason
      ? humanizeInPlaceReason(preview.withNewTime.reason, 'time')
      : preview.withNewTime.feasible === false
        ? 'This time is not feasible for the visit on this route.'
        : 'Could not score this visit at the proposed time.';
    return {
      originalScore,
      newScore: null,
      headerSuffix: null,
      summaryLine: originalScoreLine == null ? reason : null,
      originalScoreLine,
      newTypeUnavailableLine: reason,
      windowLine: null,
      windowWarningMayChange: false,
      arrivalWindowAfter: null,
      withNewTypeFeasible: withNewTimeFeasible,
      withNewTypeReason: withNewTimeReason,
      downstreamWindowEdge,
      overflowOverrunSeconds,
      feedbackHandoff: null,
    };
  }

  const headerSuffix = rescheduleScoreHeaderSuffix(newScore, originalVisitForSummary);
  const summaryLine = headerSuffix
    ? headerSuffix.replace(/^\(/, '').replace(/\)$/, '')
    : `Score with new time: ${Number.isInteger(newScore) ? String(newScore) : newScore.toFixed(1)}`;

  const infeasibleReason =
    isInfeasible && preview.withNewTime.reason
      ? humanizeInPlaceReason(preview.withNewTime.reason, 'time')
      : isInfeasible
        ? 'This time is not feasible for the visit on this route.'
        : null;

  return {
    originalScore,
    newScore,
    headerSuffix,
    summaryLine,
    originalScoreLine: infeasibleReason ? null : originalScoreLine,
    newTypeUnavailableLine: infeasibleReason,
    windowLine: null,
    windowWarningMayChange: false,
    arrivalWindowAfter: null,
    withNewTypeFeasible: withNewTimeFeasible,
    withNewTypeReason: withNewTimeReason,
    downstreamWindowEdge,
    overflowOverrunSeconds,
    feedbackHandoff: isInfeasible ? null : feedbackHandoff,
  };
}
