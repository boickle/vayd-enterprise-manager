/**
 * Smoke: Cancellations analytics cancel-day attribution
 * (thread #internal-scout 1789581192.409119 — missing Quinn cancellations).
 *
 * API buckets cancels under byDay[].date. FE must keep that day and not drop
 * rows when lastTouchedAt is missing or outside the selected range.
 *
 * Run: node scripts/cancellationsAnalyticsCancelDateSmoke.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DateTime } from 'luxon';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const ANALYTICS_CANCEL_DATE_KEY = 'analyticsCancelDate';
const DEFAULT_PRACTICE_TIMEZONE = 'America/New_York';

const CANCELLED_CONFIRM_STATUSES = new Set([
  'canceled appointment',
  'cancelled appointment',
  'canceled',
  'cancelled',
]);

function truthyApiFlag(v) {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    return t === 'true' || t === '1' || t === 'yes';
  }
  return false;
}

function normStatus(v) {
  if (typeof v !== 'string') return '';
  return v.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isCancelledAnalyticsRow(row) {
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

function isYyyyMmDd(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function getCancellationSortTimeIso(row) {
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
  ];
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function cancellationLocalDate(row, practiceTz = DEFAULT_PRACTICE_TIMEZONE) {
  const stamped = row[ANALYTICS_CANCEL_DATE_KEY];
  if (typeof stamped === 'string') {
    const day = stamped.trim().slice(0, 10);
    if (isYyyyMmDd(day)) return day;
  }
  const iso = getCancellationSortTimeIso(row);
  if (!iso) return null;
  if (isYyyyMmDd(iso)) return iso;
  const dt = DateTime.fromISO(iso, { setZone: true }).setZone(practiceTz);
  return dt.isValid ? dt.toISODate() : null;
}

function stampAnalyticsCancelDate(row, dayDate) {
  const day = String(dayDate || '')
    .trim()
    .slice(0, 10);
  if (!isYyyyMmDd(day)) return row;
  if (row[ANALYTICS_CANCEL_DATE_KEY] != null) return row;
  return { ...row, [ANALYTICS_CANCEL_DATE_KEY]: day };
}

function flattenByDay(o) {
  const byDay = o.byDay;
  if (!Array.isArray(byDay)) return [];
  const out = [];
  for (const day of byDay) {
    if (!day || typeof day !== 'object') continue;
    const dayDate = typeof day.date === 'string' ? day.date : '';
    const cans = day.cancellations;
    if (!Array.isArray(cans)) continue;
    for (const row of cans) {
      if (!row || typeof row !== 'object') continue;
      out.push(stampAnalyticsCancelDate(row, dayDate));
    }
  }
  return out;
}

/** Old FE behavior: prefer lastTouchedAt and drop when day missing / out of range. */
function oldCancellationLocalDate(row) {
  const keys = [
    'lastTouchedAt',
    'externalUpdated',
    'cancelledAt',
    'canceledAt',
    'cancellationDate',
    'cancellationTime',
    'cancelDate',
    'cancelTime',
    'statusChangedAt',
    'confirmStatusChangedAt',
    'modifiedAt',
    'updated',
  ];
  let iso = null;
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.trim()) {
      iso = v.trim();
      break;
    }
  }
  if (!iso) return null;
  // dayjs-local equivalent without dayjs: use UTC date of the instant (agent TZ is UTC)
  const dt = DateTime.fromISO(iso);
  return dt.isValid ? dt.toUTC().toISODate() : null;
}

function oldIsCancelledStatus(name) {
  const n = typeof name === 'string' ? name.trim() : '';
  return n === 'Canceled Appointment' || n === 'Canceled';
}

function filterOld(rows, from, to) {
  return rows.filter((appt) => {
    if (!oldIsCancelledStatus(appt.confirmStatusName)) return false;
    const d = oldCancellationLocalDate(appt);
    if (!d) return false;
    return d >= from && d <= to;
  });
}

function filterNew(rows, from, to) {
  return rows.filter((appt) => {
    if (!isCancelledAnalyticsRow(appt)) return false;
    const d = cancellationLocalDate(appt);
    if (!d) return false;
    return d >= from && d <= to;
  });
}

// --- Scenario: Quinn cancels this week; API buckets by cancel day; lastTouchedAt missing ---
const apiPayload = {
  startDate: '2026-09-14',
  endDate: '2026-09-16',
  byDay: [
    {
      date: '2026-09-15',
      count: 3,
      cancellations: [
        {
          id: 1,
          confirmStatusName: 'Canceled Appointment',
          primaryProviderName: 'Dr. Quinn',
          clientName: 'Client A',
          // no lastTouchedAt — old FE dropped this
        },
        {
          id: 2,
          confirmStatusName: 'Canceled Appointment',
          primaryProviderName: 'Dr. Quinn',
          clientName: 'Client B',
          // stale lastTouchedAt outside selected range — old FE dropped this
          lastTouchedAt: '2026-08-01T15:00:00.000Z',
        },
        {
          id: 3,
          confirmStatusName: 'Canceled Appointment',
          primaryProviderName: 'Dr. Quinn',
          clientName: 'Client C',
          lastTouchedAt: '2026-09-15T18:00:00.000Z',
        },
      ],
    },
  ],
};

const flattened = flattenByDay(apiPayload);
assert(flattened.length === 3, 'flatten keeps all byDay rows');
assert(
  flattened.every((r) => r.analyticsCancelDate === '2026-09-15'),
  'each row stamped with byDay date',
);

const from = '2026-09-14';
const to = '2026-09-16';
const oldKept = filterOld(flattened, from, to);
const newKept = filterNew(flattened, from, to);

assert(oldKept.length === 1, `old FE kept only lastTouchedAt-in-range (got ${oldKept.length})`);
assert(oldKept[0].id === 3, 'old FE kept Client C only');
assert(newKept.length === 3, `new FE keeps all byDay cancels (got ${newKept.length})`);

// Prefer cancel timestamp over lastTouchedAt for day when no stamp
assert(
  cancellationLocalDate({
    cancelledAt: '2026-09-15T22:30:00.000Z',
    lastTouchedAt: '2026-08-01T12:00:00.000Z',
  }) === '2026-09-15',
  'prefers cancelledAt over stale lastTouchedAt',
);

// Practice TZ: late UTC evening still Mon Sep 15 ET
assert(
  cancellationLocalDate({ cancelledAt: '2026-09-16T03:30:00.000Z' }) === '2026-09-15',
  'practice TZ maps late UTC to prior ET calendar day',
);

// Broader cancel detection
assert(isCancelledAnalyticsRow({ cancellationFlag: true }), 'cancellationFlag counts');
assert(
  isCancelledAnalyticsRow({ confirmStatusName: 'Cancelled Appointment' }),
  'British spelling counts',
);
assert(!oldIsCancelledStatus('Cancelled Appointment'), 'old exact match rejected British spelling');

// Source files exist and contain the key symbols
const utilSrc = fs.readFileSync(path.join(root, 'src/utils/cancellationsAnalytics.ts'), 'utf8');
assert(utilSrc.includes('ANALYTICS_CANCEL_DATE_KEY'), 'util exports stamp key');
assert(utilSrc.includes('cancellationLocalDate'), 'util has cancellationLocalDate');

const apiSrc = fs.readFileSync(path.join(root, 'src/api/appointmentCancellationsAnalytics.ts'), 'utf8');
assert(apiSrc.includes('stampAnalyticsCancelDate'), 'API normalizer stamps byDay date');

const pageSrc = fs.readFileSync(path.join(root, 'src/pages/CancellationsAnalytics.tsx'), 'utf8');
assert(pageSrc.includes('isCancelledAnalyticsRow'), 'page uses broadened cancel check');
assert(pageSrc.includes('cancellationLocalDate'), 'page uses shared cancel day helper');

console.log('cancellationsAnalyticsCancelDateSmoke: ok');
