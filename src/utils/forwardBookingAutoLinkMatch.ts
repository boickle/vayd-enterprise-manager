import { DateTime } from 'luxon';
import type {
  ForwardBookingEntry,
  ForwardBookingFutureAppointment,
} from '../api/forwardBooking';
import {
  forwardBookingIntervalSpanDays,
  resolveForwardBookingIntervalFromEntry,
  resolveForwardBookingTargetDueDateIso,
} from './forwardBookingFromAppointment';
import { practiceTimeZoneOrDefault } from './practiceTimezone';

/** Practice-local day distance between an appointment start and the entry target due date. */
export function forwardBookingAppointmentDayDistanceFromTarget(
  appointmentStartIso: string,
  targetDueDateIso: string,
  practiceTz: string
): number | null {
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const targetDay = DateTime.fromISO(targetDueDateIso, { zone: 'utc' }).setZone(tz).startOf('day');
  const apptDay = DateTime.fromISO(appointmentStartIso, { zone: 'utc' }).setZone(tz).startOf('day');
  if (!targetDay.isValid || !apptDay.isValid) return null;
  return Math.abs(apptDay.diff(targetDay, 'days').days);
}

/**
 * How far from target due date an appointment may be and still auto-link to this row.
 * Wider than the routing search buffer so a hold placed slightly off the ideal slot still links.
 */
export function forwardBookingAutoLinkWindowDays(
  entry: Pick<
    ForwardBookingEntry,
    'intervalAmount' | 'intervalUnit' | 'monthsOut' | 'targetDueDate'
  >
): number | null {
  const interval = resolveForwardBookingIntervalFromEntry(entry);
  if (!interval) return null;
  const spanDays = forwardBookingIntervalSpanDays(interval.amount, interval.unit);
  if (spanDays <= 0) return null;
  const routingBuffer = Math.max(1, Math.round(spanDays / 5));
  const halfWindow = Math.max(Math.round(spanDays / 3), routingBuffer * 3);
  return Math.max(14, Math.min(90, halfWindow));
}

export type ForwardBookingAutoLinkScoredAppointment = {
  appointment: ForwardBookingFutureAppointment;
  dayDistance: number;
};

/** Future appointments for this row, scored by proximity to target due date (nearest first). */
export function scoreForwardBookingFutureAppointmentsByTarget(
  entry: ForwardBookingEntry,
  future: readonly ForwardBookingFutureAppointment[],
  practiceTz: string
): ForwardBookingAutoLinkScoredAppointment[] {
  const targetIso = resolveForwardBookingTargetDueDateIso(entry, practiceTz);
  if (!targetIso) return [];

  return future
    .map((appointment) => {
      const start = appointment.appointmentStart?.trim();
      if (!start) return null;
      const dayDistance = forwardBookingAppointmentDayDistanceFromTarget(
        start,
        targetIso,
        practiceTz
      );
      if (dayDistance == null) return null;
      return { appointment, dayDistance };
    })
    .filter((row): row is ForwardBookingAutoLinkScoredAppointment => row != null)
    .sort((a, b) => a.dayDistance - b.dayDistance);
}

/**
 * Pick one future appointment to link to this forward-booking row.
 * Ignores unrelated visits (e.g. annual wellness) that fall outside the target window.
 * Returns null when ambiguous or nothing is close enough to target.
 */
export function pickForwardBookingAutoLinkAppointmentId(
  entry: ForwardBookingEntry,
  future: readonly ForwardBookingFutureAppointment[],
  practiceTz: string
): number | null {
  if (future.length === 0) return null;

  const windowDays = forwardBookingAutoLinkWindowDays(entry);
  const targetIso = resolveForwardBookingTargetDueDateIso(entry, practiceTz);
  if (windowDays == null || !targetIso) return null;

  const nearTarget = scoreForwardBookingFutureAppointmentsByTarget(entry, future, practiceTz).filter(
    (row) => row.dayDistance <= windowDays
  );
  if (nearTarget.length === 0) return null;

  const best = nearTarget[0]!;
  const second = nearTarget[1];
  if (second && second.dayDistance - best.dayDistance < 3) {
    return null;
  }

  const id = best.appointment.id;
  return id != null && Number.isFinite(Number(id)) ? Number(id) : null;
}
