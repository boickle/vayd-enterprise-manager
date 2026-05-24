import type { Provider } from '../api/employee';
import { fetchTimeChangePreview } from '../api/routing';
import type { Appointment } from '../api/roomLoader';
import { buildEditVisitPreviewScoreCompare, type EditVisitPreviewScoreCompare } from './editVisitInPlaceScoreCompare';

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
    return empty('Could not load time-change score preview.');
  }

  return buildEditVisitPreviewScoreCompare({
    original: preview.original,
    withNew: preview.withNewTime,
    apiDelta: preview.delta,
    context: 'time',
    apptId,
    feedbackHandoffRaw: preview.feedbackHandoff,
  });
}
