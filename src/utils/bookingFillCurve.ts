import dayjs, { type Dayjs } from 'dayjs';
import { bookingLeadTimeDays } from './clPoints';

/** Max days-out horizon modeled on the fill curve. */
export const BOOKING_FILL_MAX_HORIZON_DAYS = 90;

/**
 * Completed service days used to build the curve (ending yesterday).
 * Wider = more stable; shorter reacts faster to recent booking behavior.
 */
export const BOOKING_FILL_SERVICE_LOOKBACK_DAYS = 60;

/**
 * How far back to fetch booking-creation rows so long-lead bookings for those
 * service days are included (API filters by booked date, not service date).
 */
export const BOOKING_FILL_BOOKED_LOOKBACK_DAYS =
  BOOKING_FILL_SERVICE_LOOKBACK_DAYS + BOOKING_FILL_MAX_HORIZON_DAYS;

/** Ignore tiny fill fractions when inverting (avoids huge multipliers). */
const MIN_FILL_FRACTION = 0.08;

/** Cap how much currently-booked points may be scaled up by the curve. */
const MAX_FILL_MULTIPLIER = 6;

export type BookingForFillCurve = {
  bookedAt?: string | null;
  appointmentStart?: string | null;
  points?: number | null;
  primaryProviderId?: number | string | null;
};

export type BookingFillCurve = {
  /**
   * Mean fraction of a day's final points that were already booked at least
   * `horizon` calendar days before the service day. Index = horizon days.
   */
  fractionBookedByHorizon: number[];
  /**
   * Mean points still expected to book between `horizon` days out and day-of
   * (final − already booked at that horizon).
   */
  avgRemainingPointsByHorizon: number[];
  /** Mean final points per completed service day in the sample. */
  avgFinalPoints: number;
  sampleDays: number;
  maxHorizon: number;
};

export type ProjectedFillResult = {
  /** Expected final points after late bookings (never below currently booked). */
  projectedPoints: number;
  /** Currently booked points passed in. */
  bookedPoints: number;
  /** Expected additional points still to book. */
  expectedAdditionalPoints: number;
  /** Historical fill fraction at this horizon (null if curve unavailable). */
  fillFraction: number | null;
  daysUntil: number;
};

/** Calendar-day lead time (appointment date − booked date). */
export function calendarLeadDays(
  bookedAt: string | null | undefined,
  appointmentStart: string | null | undefined
): number | null {
  if (!bookedAt || !appointmentStart) return null;
  const booked = dayjs(bookedAt).startOf('day');
  const start = dayjs(appointmentStart).startOf('day');
  if (!booked.isValid() || !start.isValid()) return null;
  return start.diff(booked, 'day');
}

function bookingPoints(b: BookingForFillCurve): number {
  const pts = Number(b.points);
  if (Number.isFinite(pts) && pts >= 0) return pts;
  // Fall back to 1 when the analytics row omits points (same default as most visit types).
  return 1;
}

/**
 * Build a practice (or provider-filtered) booking fill curve from historical bookings.
 * Only completed service days in [serviceStart, serviceEnd] contribute.
 */
export function buildBookingFillCurve(
  bookings: BookingForFillCurve[],
  serviceStart: Dayjs,
  serviceEnd: Dayjs,
  opts?: {
    maxHorizon?: number;
    /** When set, only bookings for this primary provider are included. */
    primaryProviderId?: string | number | null;
  }
): BookingFillCurve {
  const maxHorizon = opts?.maxHorizon ?? BOOKING_FILL_MAX_HORIZON_DAYS;
  const providerFilter =
    opts?.primaryProviderId != null && String(opts.primaryProviderId).trim() !== ''
      ? String(opts.primaryProviderId).trim()
      : null;

  const startStr = serviceStart.startOf('day').format('YYYY-MM-DD');
  const endStr = serviceEnd.startOf('day').format('YYYY-MM-DD');

  /** serviceDate → list of { leadDays, points } */
  const byServiceDate = new Map<string, { leadDays: number; points: number }[]>();

  for (const b of bookings) {
    if (providerFilter != null) {
      const pid = b.primaryProviderId != null ? String(b.primaryProviderId).trim() : '';
      if (!pid || pid !== providerFilter) continue;
    }
    const startIso = b.appointmentStart;
    if (!startIso) continue;
    const serviceDate = dayjs(startIso).startOf('day');
    if (!serviceDate.isValid()) continue;
    const dateStr = serviceDate.format('YYYY-MM-DD');
    if (dateStr < startStr || dateStr > endStr) continue;

    let lead = calendarLeadDays(b.bookedAt, startIso);
    if (lead == null) {
      // Fall back to fractional lead time floored if calendar parse failed partially.
      const frac = bookingLeadTimeDays(b.bookedAt, startIso);
      if (frac == null) continue;
      lead = Math.floor(frac);
    }
    if (lead < 0) lead = 0;

    const pts = bookingPoints(b);
    if (!byServiceDate.has(dateStr)) byServiceDate.set(dateStr, []);
    byServiceDate.get(dateStr)!.push({ leadDays: lead, points: pts });
  }

  const fractionSums = Array.from({ length: maxHorizon + 1 }, () => 0);
  const remainingSums = Array.from({ length: maxHorizon + 1 }, () => 0);
  let sampleDays = 0;
  let finalPointsSum = 0;

  for (const rows of byServiceDate.values()) {
    const finalPoints = rows.reduce((s, r) => s + r.points, 0);
    if (finalPoints <= 0) continue;
    sampleDays += 1;
    finalPointsSum += finalPoints;

    for (let h = 0; h <= maxHorizon; h++) {
      const bookedByH = rows
        .filter((r) => r.leadDays >= h)
        .reduce((s, r) => s + r.points, 0);
      fractionSums[h] += bookedByH / finalPoints;
      remainingSums[h] += Math.max(0, finalPoints - bookedByH);
    }
  }

  const fractionBookedByHorizon = fractionSums.map((s) => (sampleDays > 0 ? s / sampleDays : 0));
  const avgRemainingPointsByHorizon = remainingSums.map((s) => (sampleDays > 0 ? s / sampleDays : 0));

  return {
    fractionBookedByHorizon,
    avgRemainingPointsByHorizon,
    avgFinalPoints: sampleDays > 0 ? finalPointsSum / sampleDays : 0,
    sampleDays,
    maxHorizon,
  };
}

/**
 * Project expected final points for a future day given what's booked today and
 * how full historical days were at the same days-out horizon.
 *
 * Method:
 * - Prefer inverting the historical fill fraction: booked / fraction
 * - Floor with booked + average remaining points (helps sparse / empty days)
 * - Never project below currently booked; cap the scale-up multiplier
 */
export function projectPointsWithFillCurve(
  bookedPoints: number,
  daysUntil: number,
  curve: BookingFillCurve | null | undefined
): ProjectedFillResult {
  const booked = Math.max(0, Number(bookedPoints) || 0);
  const horizon = Math.max(0, Math.min(Math.floor(daysUntil), curve?.maxHorizon ?? BOOKING_FILL_MAX_HORIZON_DAYS));

  if (!curve || curve.sampleDays <= 0) {
    return {
      projectedPoints: booked,
      bookedPoints: booked,
      expectedAdditionalPoints: 0,
      fillFraction: null,
      daysUntil: horizon,
    };
  }

  const fillFraction = curve.fractionBookedByHorizon[horizon] ?? 0;
  const avgRemaining = curve.avgRemainingPointsByHorizon[horizon] ?? 0;

  let projected: number;
  if (booked > 0 && fillFraction >= MIN_FILL_FRACTION) {
    // Invert historical fill %: if days this far out were typically 40% full, scale up.
    const fromRatio = Math.min(booked / fillFraction, booked * MAX_FILL_MULTIPLIER);
    // If this day is behind typical booked volume, lift toward typical remaining fill.
    projected = Math.max(fromRatio, booked + avgRemaining * 0.25);
  } else {
    // Sparse / empty day: expect the historical average of points still to book.
    projected = booked + avgRemaining;
  }

  projected = Math.max(booked, projected);
  // Cap vs typical finals so sparse-history outliers don't invent huge days.
  if (curve.avgFinalPoints > 0) {
    projected = Math.min(projected, Math.max(booked, curve.avgFinalPoints * 1.5));
  }

  return {
    projectedPoints: projected,
    bookedPoints: booked,
    expectedAdditionalPoints: Math.max(0, projected - booked),
    fillFraction: fillFraction > 0 ? fillFraction : null,
    daysUntil: horizon,
  };
}

/** Flatten nested appointment-bookings analytics users into booking detail rows. */
export function flattenBookingAnalyticsDetails(
  users: { bookingsByDay?: { bookings?: BookingForFillCurve[] }[] }[] | null | undefined
): BookingForFillCurve[] {
  const out: BookingForFillCurve[] = [];
  if (!users?.length) return out;
  for (const u of users) {
    for (const day of u.bookingsByDay ?? []) {
      for (const b of day.bookings ?? []) {
        out.push(b);
      }
    }
  }
  return out;
}

/** Default lookback window for fetching bookings used to build the fill curve. */
export function bookingFillHistoryWindow(today: Dayjs = dayjs()): {
  bookedStart: Dayjs;
  bookedEnd: Dayjs;
  serviceStart: Dayjs;
  serviceEnd: Dayjs;
} {
  const serviceEnd = today.startOf('day').subtract(1, 'day');
  const serviceStart = serviceEnd.subtract(BOOKING_FILL_SERVICE_LOOKBACK_DAYS - 1, 'day');
  const bookedEnd = serviceEnd;
  const bookedStart = today.startOf('day').subtract(BOOKING_FILL_BOOKED_LOOKBACK_DAYS, 'day');
  return { bookedStart, bookedEnd, serviceStart, serviceEnd };
}
