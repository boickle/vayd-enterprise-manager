import { DateTime } from 'luxon';
import type { AppointmentType } from '../api/appointmentSettings';
import type { DoctorDayAppt } from '../api/appointments';
import { effectiveWindowForScheduledStart } from './appointmentArrivalWindow';
import {
  fixedTimeRouteEtaMeaningfullyAfterScheduledStart,
  shouldShowEtaWindowWarning,
} from './windowWarning';

export type EditVisitPreviewKind = 'time' | 'type';

export type EditVisitTimePreview = {
  appointmentId: number;
  appointmentStart: string;
  appointmentEnd: string;
  /** Practice-local YYYY-MM-DD for the preview day. */
  practiceDateKey: string;
  /** Time change vs appointment type change (windows / drive impact). */
  kind: EditVisitPreviewKind;
  /** Draft type when kind is `type` (unsaved). */
  appointmentTypeId?: number;
  /** Display name for doctor-day / routing preview (e.g. `Fixed Time`). */
  appointmentTypeName?: string;
  /** Booked visit times before this preview (for Was / Now in popover). */
  originalAppointmentStart?: string;
  originalAppointmentEnd?: string;
  /** Booked type name before type-change preview. */
  originalAppointmentTypeName?: string;
};

export function isFixedTimeTypeName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return lower === 'fixed time' || lower.includes('fixed time');
}

/** Arrival window for type-preview drive ETA + calendar warnings (API `after` wins). */
export function effectiveWindowForTypePreview(
  preview: EditVisitTimePreview,
  draftType: AppointmentType | undefined,
  practiceTz: string,
  arrivalWindowAfter?: { startIso: string; endIso: string } | null
): { startIso: string; endIso: string } | undefined {
  if (arrivalWindowAfter?.startIso && arrivalWindowAfter?.endIso) {
    return arrivalWindowAfter;
  }
  return effectiveWindowForScheduledStart(
    preview.appointmentStart,
    draftType ??
      (preview.appointmentTypeName
        ? { name: preview.appointmentTypeName, prettyName: preview.appointmentTypeName }
        : undefined),
    practiceTz,
    { appointmentEndIso: preview.appointmentEnd }
  );
}

/** Window warning for type preview using draft type windows + routed ETA (not slot-search score). */
export function computeEditVisitTypePreviewWindowWarning(args: {
  preview: EditVisitTimePreview;
  draftType: AppointmentType | undefined;
  practiceTz: string;
  etaIso: string | null;
  arrivalWindowAfter?: { startIso: string; endIso: string } | null;
  withNewTypeFeasible?: boolean | null;
  withNewTypeReason?: string | null;
}): boolean {
  if (args.withNewTypeFeasible === false && args.withNewTypeReason === 'window-violation') {
    return true;
  }
  const eta = args.etaIso?.trim();
  if (!eta) return false;

  const window = effectiveWindowForTypePreview(
    args.preview,
    args.draftType,
    args.practiceTz,
    args.arrivalWindowAfter
  );
  if (!window?.endIso) return false;

  const typeName = (args.draftType?.name || args.draftType?.prettyName || args.preview.appointmentTypeName || '').trim();
  if (isFixedTimeTypeName(typeName) && window.endIso) {
    return shouldShowEtaWindowWarning(eta, window.endIso, window.startIso);
  }
  if (isFixedTimeTypeName(typeName)) {
    return fixedTimeRouteEtaMeaningfullyAfterScheduledStart(args.preview.appointmentStart, eta);
  }
  return shouldShowEtaWindowWarning(eta, window.endIso, window.startIso);
}

export function editVisitTimePreviewPracticeDateKey(
  startUtc: string,
  practiceTz: string
): string | null {
  const dt = DateTime.fromISO(startUtc, { zone: 'utc' }).setZone(practiceTz);
  return dt.isValid ? dt.toISODate() : null;
}

export function buildEditVisitTimePreview(
  appointmentId: number,
  startUtc: string,
  endUtc: string,
  practiceTz: string,
  opts?: {
    kind?: EditVisitPreviewKind;
    appointmentTypeId?: number;
    appointmentTypeName?: string;
    originalAppointmentStart?: string;
    originalAppointmentEnd?: string;
    originalAppointmentTypeName?: string;
  }
): EditVisitTimePreview | null {
  const practiceDateKey = editVisitTimePreviewPracticeDateKey(startUtc, practiceTz);
  if (!practiceDateKey) return null;
  return {
    appointmentId,
    appointmentStart: startUtc,
    appointmentEnd: endUtc,
    practiceDateKey,
    kind: opts?.kind ?? 'time',
    ...(opts?.appointmentTypeId != null ? { appointmentTypeId: opts.appointmentTypeId } : {}),
    ...(opts?.appointmentTypeName?.trim()
      ? { appointmentTypeName: opts.appointmentTypeName.trim() }
      : {}),
    ...(opts?.originalAppointmentStart?.trim()
      ? { originalAppointmentStart: opts.originalAppointmentStart.trim() }
      : {}),
    ...(opts?.originalAppointmentEnd?.trim()
      ? { originalAppointmentEnd: opts.originalAppointmentEnd.trim() }
      : {}),
    ...(opts?.originalAppointmentTypeName?.trim()
      ? { originalAppointmentTypeName: opts.originalAppointmentTypeName.trim() }
      : {}),
  };
}

function serviceMinutesFromIsoPair(
  startIso: string | null | undefined,
  endIso: string | null | undefined
): number | undefined {
  if (!startIso?.trim() || !endIso?.trim()) return undefined;
  const start = DateTime.fromISO(startIso);
  const end = DateTime.fromISO(endIso);
  if (!start.isValid || !end.isValid) return undefined;
  const mins = Math.round(end.diff(start, 'minutes').minutes);
  if (!Number.isFinite(mins) || mins <= 0) return undefined;
  return Math.max(1, mins);
}

export function applyEditTimePreviewToDoctorDayAppts(
  appts: DoctorDayAppt[],
  preview: EditVisitTimePreview,
  opts?: { draftType?: AppointmentType; practiceTz?: string }
): DoctorDayAppt[] {
  const practiceTz = opts?.practiceTz ?? 'utc';
  const draftType = opts?.draftType;
  const original = appts.find((a) => a.id === preview.appointmentId);
  if (!original) return appts;

  const serviceMinutes = serviceMinutesFromIsoPair(
    preview.appointmentStart,
    preview.appointmentEnd
  );

  const without = appts.filter((a) => a.id !== preview.appointmentId);
  const moved: DoctorDayAppt = {
    ...original,
    startIso: preview.appointmentStart,
    endIso: preview.appointmentEnd,
    appointmentStart: preview.appointmentStart,
    appointmentEnd: preview.appointmentEnd,
    ...(serviceMinutes != null ? { serviceMinutes } : {}),
  };
  const draftTypeName = preview.appointmentTypeName?.trim();
  if (preview.kind === 'type' && draftTypeName) {
    moved.appointmentType = draftTypeName;
    if (isFixedTimeTypeName(draftTypeName)) {
      moved.fixedTime = true;
      moved.isFixed = true;
      moved.isFlexible = false;
      moved.effectiveWindow = {
        startIso: preview.appointmentStart,
        endIso: preview.appointmentEnd,
      };
    } else {
      const ew = effectiveWindowForTypePreview(preview, draftType, practiceTz, undefined);
      if (ew) moved.effectiveWindow = ew;
    }
  }
  (moved as { isPreview?: boolean }).isPreview = true;

  const combined = [...without, moved];
  combined.sort((a, b) => {
    const ma = a.startIso ? DateTime.fromISO(a.startIso).toMillis() : 0;
    const mb = b.startIso ? DateTime.fromISO(b.startIso).toMillis() : 0;
    return ma - mb;
  });
  return combined;
}
