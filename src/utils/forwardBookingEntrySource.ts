import type { ForwardBookingEntry } from '../api/forwardBooking';
import { CARE_OUTREACH_BOOKING_NOTES_PREFIX } from './careOutreachForwardBooking';

export const SCHEDULE_LOADER_BOOKING_NOTES_PREFIX = 'Schedule loader follow-up';

export type ForwardBookingSourceChip = 'care_outreach' | 'schedule_loader' | 'forward_booking';

export function isCareOutreachForwardBookingEntry(
  entry: Pick<ForwardBookingEntry, 'bookingNotes'>
): boolean {
  return (entry.bookingNotes?.trim() ?? '').startsWith(CARE_OUTREACH_BOOKING_NOTES_PREFIX);
}

export function isScheduleLoaderForwardBookingEntry(
  entry: Pick<ForwardBookingEntry, 'bookingNotes' | 'sourceAppointmentId'>
): boolean {
  const notes = entry.bookingNotes?.trim() ?? '';
  if (notes.toLowerCase().startsWith(SCHEDULE_LOADER_BOOKING_NOTES_PREFIX.toLowerCase())) {
    return true;
  }
  const sid = entry.sourceAppointmentId;
  if (sid != null && sid > 0) return false;
  return !isCareOutreachForwardBookingEntry(entry);
}

export function forwardBookingEntrySourceChip(
  entry: Pick<ForwardBookingEntry, 'bookingNotes' | 'sourceAppointmentId'>
): ForwardBookingSourceChip {
  if (isCareOutreachForwardBookingEntry(entry)) return 'care_outreach';
  const sid = entry.sourceAppointmentId;
  if (sid != null && sid > 0) return 'forward_booking';
  return 'schedule_loader';
}

export function forwardBookingSourceChipLabel(chip: ForwardBookingSourceChip): string {
  switch (chip) {
    case 'care_outreach':
      return 'Care Outreach';
    case 'schedule_loader':
      return 'Schedule loader';
    default:
      return 'Forward Booking';
  }
}

export function forwardBookingSourceChipColors(chip: ForwardBookingSourceChip): {
  background: string;
  color: string;
} {
  switch (chip) {
    case 'care_outreach':
      return { background: '#f5f3ff', color: '#6d28d9' };
    case 'schedule_loader':
      return { background: '#ecfdf5', color: '#047857' };
    default:
      return { background: '#eff6ff', color: '#1d4ed8' };
  }
}
