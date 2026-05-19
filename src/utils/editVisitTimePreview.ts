import { DateTime } from 'luxon';
import type { DoctorDayAppt } from '../api/appointments';

export type EditVisitTimePreview = {
  appointmentId: number;
  appointmentStart: string;
  appointmentEnd: string;
  /** Practice-local YYYY-MM-DD for the preview day. */
  practiceDateKey: string;
};

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
  practiceTz: string
): EditVisitTimePreview | null {
  const practiceDateKey = editVisitTimePreviewPracticeDateKey(startUtc, practiceTz);
  if (!practiceDateKey) return null;
  return { appointmentId, appointmentStart: startUtc, appointmentEnd: endUtc, practiceDateKey };
}

export function applyEditTimePreviewToDoctorDayAppts(
  appts: DoctorDayAppt[],
  preview: EditVisitTimePreview
): DoctorDayAppt[] {
  const original = appts.find((a) => a.id === preview.appointmentId);
  if (!original) return appts;

  const without = appts.filter((a) => a.id !== preview.appointmentId);
  const moved: DoctorDayAppt = {
    ...original,
    startIso: preview.appointmentStart,
    endIso: preview.appointmentEnd,
  };
  (moved as { isPreview?: boolean }).isPreview = true;

  const combined = [...without, moved];
  combined.sort((a, b) => {
    const ma = a.startIso ? DateTime.fromISO(a.startIso).toMillis() : 0;
    const mb = b.startIso ? DateTime.fromISO(b.startIso).toMillis() : 0;
    return ma - mb;
  });
  return combined;
}
