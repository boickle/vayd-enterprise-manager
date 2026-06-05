import { DateTime } from 'luxon';
import type { AppointmentType } from '../api/appointmentSettings';
import type { Provider } from '../api/employee';
import { fetchTypeChangePreview, type TypeChangePreviewResponse } from '../api/routing';
import type { Appointment } from '../api/roomLoader';
import { buildEditVisitPreviewScoreCompare } from './editVisitInPlaceScoreCompare';
import {
  editVisitPreviewErrorSummaryLine,
  isEditVisitPreviewUnavailableError,
  resolveEditVisitRoutingDoctorId,
} from './editVisitPreviewApi';

export type EditVisitTypeScoreCompare = import('./editVisitInPlaceScoreCompare').EditVisitPreviewScoreCompare;

/** Shared score-compare shape for type and time edit-visit previews. */
export type EditVisitPreviewScoreCompare = EditVisitTypeScoreCompare;

export { humanizeInPlaceReason, inPlacePreviewNewScore } from './editVisitInPlaceScoreCompare';

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
  calendarProvider?: Provider | null;
}): Promise<EditVisitTypeScoreCompare> {
  const { appt, newAppointmentTypeId, practiceDateKey, practiceTz } = args;
  const doctorPimsId = resolveEditVisitRoutingDoctorId(
    appt,
    args.providers,
    args.calendarProvider
  );
  const originalType = appt.appointmentType as AppointmentType | undefined;
  const newType = args.appointmentTypes.find((t) => t.id === newAppointmentTypeId);

  const empty = (summaryLine: string): EditVisitTypeScoreCompare => ({
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

    const windowLine = windowLineFromPreview(preview, originalType, newType, practiceTz);
    const windowWarningMayChange = Boolean(
      windowLine &&
        (isFixedTimeTypeName(newType?.name || newType?.prettyName || '') ||
          isFixedTimeTypeName(originalType?.name || originalType?.prettyName || ''))
    );

    return buildEditVisitPreviewScoreCompare({
      original: preview.original,
      withNew: preview.withNewType,
      apiDelta: preview.delta,
      context: 'type',
      apptId,
      feedbackHandoffRaw: preview.feedbackHandoff,
      windowLine,
      windowWarningMayChange,
      arrivalWindowAfter,
    });
  } catch (err: unknown) {
    if (isEditVisitPreviewUnavailableError(err)) {
      return empty(editVisitPreviewErrorSummaryLine(err));
    }
    throw err;
  }
}
