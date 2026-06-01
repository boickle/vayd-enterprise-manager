import type { Provider } from '../api/employee';
import { fetchTimeChangePreview } from '../api/routing';
import type { Appointment } from '../api/roomLoader';
import { buildEditVisitPreviewScoreCompare, type EditVisitPreviewScoreCompare } from './editVisitInPlaceScoreCompare';
import {
  editVisitPreviewErrorSummaryLine,
  isEditVisitPreviewUnavailableError,
  resolveEditVisitRoutingDoctorId,
} from './editVisitPreviewApi';

export type { EditVisitPreviewScoreCompare };

export async function fetchEditVisitTimeScoreCompare(args: {
  appt: Appointment;
  newAppointmentStartIso: string;
  newAppointmentEndIso: string;
  practiceDateKey: string;
  providers: readonly Provider[];
  calendarProvider?: Provider | null;
}): Promise<EditVisitPreviewScoreCompare> {
  const { appt, newAppointmentStartIso, newAppointmentEndIso, practiceDateKey } = args;
  const doctorPimsId = resolveEditVisitRoutingDoctorId(
    appt,
    args.providers,
    args.calendarProvider
  );

  const empty = (summaryLine: string): EditVisitPreviewScoreCompare => ({
    originalScore: null,
    newScore: null,
    delta: null,
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

  try {
    const preview = await fetchTimeChangePreview({
      doctorId: doctorPimsId,
      date: practiceDateKey,
      appointmentId: apptId,
      newAppointmentStartIso,
      newAppointmentEndIso,
      useTraffic: true,
    });

    return buildEditVisitPreviewScoreCompare({
      original: preview.original,
      withNew: preview.withNewTime,
      apiDelta: preview.delta,
      context: 'time',
      apptId,
      feedbackHandoffRaw: preview.feedbackHandoff,
    });
  } catch (err: unknown) {
    if (isEditVisitPreviewUnavailableError(err)) {
      return empty(editVisitPreviewErrorSummaryLine(err));
    }
    throw err;
  }
}
