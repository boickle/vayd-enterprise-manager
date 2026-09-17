import { DateTime } from 'luxon';
import { DEFAULT_PRACTICE_TIMEZONE } from './practiceTimezone';

/** Stamped onto rows flattened from `byDay[].cancellations` (API cancel-day bucket). */
export const ANALYTICS_CANCEL_DATE_KEY = 'analyticsCancelDate';

const CANCELLED_CONFIRM_STATUSES = new Set([
  'canceled appointment',
  'cancelled appointment',
  'canceled',
  'cancelled',
]);

function truthyApiFlag(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    return t === 'true' || t === '1' || t === 'yes';
  }
  return false;
}

function normStatus(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Whether an analytics row counts as a cancellation.
 * Broader than exact "Canceled Appointment" string match — includes British spelling,
 * statusName, and cancellationFlag (same intent as practice-calendar cancel detection).
 */
export function isCancelledAnalyticsRow(row: Record<string, unknown>): boolean {
  if (truthyApiFlag(row.cancellationFlag)) return true;
  if (truthyApiFlag(row.isCancelled) || truthyApiFlag(row.cancelled) || truthyApiFlag(row.isCanceled)) {
    return true;
  }
  const confirm = normStatus(row.confirmStatusName);
  const status = normStatus(row.statusName);
  return (
    (confirm !== '' && CANCELLED_CONFIRM_STATUSES.has(confirm)) ||
    (status !== '' && CANCELLED_CONFIRM_STATUSES.has(status))
  );
}

function isYyyyMmDd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Prefer dedicated cancel timestamps; fall back to last-touch / sync fields. */
export function getCancellationSortTimeIso(row: Record<string, unknown>): string | null {
  const keys = [
    'cancelledAt',
    'canceledAt',
    'cancellationDate',
    'cancellationTime',
    'cancelDate',
    'cancelTime',
    'statusChangedAt',
    'confirmStatusChangedAt',
    'lastTouchedAt',
    'externalUpdated',
    'modifiedAt',
    'updated',
  ] as const;
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Calendar day the cancellation counts toward (practice timezone).
 * Prefers API `byDay[].date` stamped as analyticsCancelDate so FE does not drop
 * rows whose lastTouchedAt is missing or outside the selected range.
 */
export function cancellationLocalDate(
  row: Record<string, unknown>,
  practiceTz: string = DEFAULT_PRACTICE_TIMEZONE
): string | null {
  const stamped = row[ANALYTICS_CANCEL_DATE_KEY];
  if (typeof stamped === 'string') {
    const day = stamped.trim().slice(0, 10);
    if (isYyyyMmDd(day)) return day;
  }

  const iso = getCancellationSortTimeIso(row);
  if (!iso) return null;
  if (isYyyyMmDd(iso)) return iso;

  const dt = DateTime.fromISO(iso, { setZone: true }).setZone(practiceTz);
  return dt.isValid ? (dt.toISODate() ?? null) : null;
}

export function stampAnalyticsCancelDate(
  row: Record<string, unknown>,
  dayDate: string
): Record<string, unknown> {
  const day = dayDate.trim().slice(0, 10);
  if (!isYyyyMmDd(day)) return row;
  if (row[ANALYTICS_CANCEL_DATE_KEY] != null) return row;
  return { ...row, [ANALYTICS_CANCEL_DATE_KEY]: day };
}
