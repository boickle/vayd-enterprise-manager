import type { Provider } from '../api/employee';
import { fetchTimeChangePreview } from '../api/routing';
import type { Appointment } from '../api/roomLoader';
import { buildEditVisitPreviewScoreCompare, type EditVisitPreviewScoreCompare } from './editVisitInPlaceScoreCompare';
import {
  editVisitPreviewErrorSummaryLine,
  isEditVisitPreviewUnavailableError,
  resolveEditVisitRoutingDoctorId,
} from './editVisitPreviewApi';
import {
  arrivalWindowChangeLine,
  editVisitPremedsChanged,
  premedsWindowLine,
} from './editVisitTypeScoreCompare';

export type { EditVisitPreviewScoreCompare };

export async function fetchEditVisitTimeScoreCompare(args: {
  appt: Appointment;
  newAppointmentStartIso: string;
  newAppointmentEndIso: string;
  practiceDateKey: string;
  providers: readonly Provider[];
  calendarProvider?: Provider | null;
  newNeedsPremeds?: boolean;
  practiceTz: string;
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
      ...(typeof args.newNeedsPremeds === 'boolean' ? { newNeedsPremeds: args.newNeedsPremeds } : {}),
      useTraffic: true,
    });

    const premedsChanged = editVisitPremedsChanged(appt, args.newNeedsPremeds);
    const changeLine = premedsChanged
      ? arrivalWindowChangeLine(preview.arrivalWindow, args.practiceTz)
      : null;
    const arrivalWindowAfter =
      premedsChanged && preview.arrivalWindow?.after?.startIso && preview.arrivalWindow?.after?.endIso
        ? preview.arrivalWindow.after
        : null;

    return buildEditVisitPreviewScoreCompare({
      original: preview.original,
      withNew: preview.withNewTime,
      apiDelta: preview.delta,
      context: 'time',
      apptId,
      feedbackHandoffRaw: preview.feedbackHandoff,
      ...(premedsChanged
        ? {
            windowLine: premedsWindowLine(args.newNeedsPremeds === true, changeLine),
            windowWarningMayChange: Boolean(changeLine),
            arrivalWindowAfter,
          }
        : {}),
    });
  } catch (err: unknown) {
    if (isEditVisitPreviewUnavailableError(err)) {
      return empty(editVisitPreviewErrorSummaryLine(err));
    }
    throw err;
  }
}
