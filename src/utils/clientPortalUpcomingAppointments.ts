import { isAppointmentCancelledOnPracticeCalendar } from '../api/appointments';
import type { ClientAppointment } from '../api/clientPortal';

type UpcomingCandidate = Pick<ClientAppointment, 'startIso' | 'confirmStatusName' | 'statusName'> &
  Record<string, unknown>;

/**
 * True when a client-portal appointment should appear under Upcoming Appointments:
 * start is now-or-later and the visit is not cancelled on the practice calendar.
 */
export function isClientPortalUpcomingAppointment(
  a: UpcomingCandidate,
  nowMs: number = Date.now()
): boolean {
  const startMs = Date.parse(a.startIso);
  if (!Number.isFinite(startMs) || startMs < nowMs) return false;
  return !isAppointmentCancelledOnPracticeCalendar(a);
}

export function filterClientPortalUpcomingAppointments<T extends UpcomingCandidate>(
  appts: readonly T[],
  nowMs: number = Date.now()
): T[] {
  return appts.filter((a) => isClientPortalUpcomingAppointment(a, nowMs));
}
