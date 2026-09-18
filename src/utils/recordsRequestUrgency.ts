import type { RecordsRequestRow } from '../api/recordsRequests';

/**
 * Urgency is driven by how close the visit is, not by how long we have waited.
 * A request sent yesterday for a visit on Friday matters more than one sent a
 * month ago for a visit in October.
 */
export const RECORDS_URGENT_DAYS_BEFORE_VISIT = 3;

/** Whole days from today to the visit. Negative once the visit has passed. */
export function daysUntilVisit(row: {
  appointmentStart: string | null;
}): number | null {
  if (!row.appointmentStart) return null;
  const visit = new Date(row.appointmentStart);
  if (Number.isNaN(visit.getTime())) return null;
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round(
    (startOfDay(visit) - startOfDay(new Date())) / 86_400_000,
  );
}

/** Still outstanding with the visit three days out or closer (or already here). */
export function isRecordsRequestUrgent(row: {
  status: string;
  appointmentStart: string | null;
}): boolean {
  if (row.status !== 'pending') return false;
  const days = daysUntilVisit(row);
  return days != null && days <= RECORDS_URGENT_DAYS_BEFORE_VISIT;
}

/** Short human label for the countdown column. */
export function visitCountdownLabel(row: {
  appointmentStart: string | null;
}): string | null {
  const days = daysUntilVisit(row);
  if (days == null) return null;
  if (days < 0) return `visit was ${Math.abs(days)}d ago`;
  if (days === 0) return 'visit today';
  if (days === 1) return 'visit tomorrow';
  return `visit in ${days}d`;
}

export function recordsRequestPhoneHref(
  row: Pick<RecordsRequestRow, 'hospitalPhone'>,
): string | null {
  const digits = (row.hospitalPhone ?? '').replace(/[^\d+]/g, '');
  return digits.length >= 7 ? `tel:${digits}` : null;
}
