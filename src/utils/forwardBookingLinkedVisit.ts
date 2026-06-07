import type { ForwardBookingEntry } from '../api/forwardBooking';

/** Row has a calendar appointment linked (booked status or bookedAppointment* fields). */
export function forwardBookingHasLinkedVisit(entry: ForwardBookingEntry): boolean {
  if (entry.status === 'booked') return true;
  const id = entry.bookedAppointmentId;
  if (id != null && Number.isFinite(Number(id)) && Number(id) > 0) return true;
  if (entry.bookedAppointmentStart?.trim()) return true;
  return false;
}

export function forwardBookingLinkedAppointmentId(entry: ForwardBookingEntry): number | null {
  const id = entry.bookedAppointmentId;
  if (id != null && Number.isFinite(Number(id)) && Number(id) > 0) return Number(id);
  return null;
}

export function mergeForwardBookingLinkedVisit(
  entry: ForwardBookingEntry,
  linked: {
    bookedAppointmentId: number;
    bookedAppointmentStart: string;
    bookedAppointmentEnd?: string | null;
    status?: ForwardBookingEntry['status'];
  }
): ForwardBookingEntry {
  return {
    ...entry,
    status: linked.status ?? entry.status,
    bookedAppointmentId: linked.bookedAppointmentId,
    bookedAppointmentStart: linked.bookedAppointmentStart,
    bookedAppointmentEnd: linked.bookedAppointmentEnd ?? entry.bookedAppointmentEnd ?? null,
  };
}
