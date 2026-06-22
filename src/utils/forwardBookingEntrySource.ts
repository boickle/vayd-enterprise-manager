import type { ForwardBookingEntry, ForwardBookingCreatedVia } from '../api/forwardBooking';
import { normalizeForwardBookingCreatedVia } from '../api/forwardBooking';

/** Chips shown on On Hold rows — subset of {@link ForwardBookingCreatedVia}. */
export type ForwardBookingSourceChip = Extract<
  ForwardBookingCreatedVia,
  'care_outreach' | 'schedule_loader' | 'end_visit'
>;

export function isForwardBookingCareOutreachEntry(
  entry: Pick<ForwardBookingEntry, 'createdVia'>
): boolean {
  return normalizeForwardBookingCreatedVia(entry.createdVia) === 'care_outreach';
}

/** Source chip from API `createdVia`; hidden for `unknown`, `manual`, and unset legacy rows. */
export function forwardBookingEntrySourceChip(
  entry: Pick<ForwardBookingEntry, 'createdVia'>
): ForwardBookingSourceChip | null {
  const via = normalizeForwardBookingCreatedVia(entry.createdVia);
  if (!via || via === 'unknown' || via === 'manual' || via === 'appointment_request') {
    return null;
  }
  return via;
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

/** URL / filter param — accepts legacy `forward_booking` alias. */
export function parseForwardBookingSourceChipFilter(
  raw: string | null
): ForwardBookingSourceChip | null {
  if (raw === 'forward_booking') return 'end_visit';
  if (raw === 'care_outreach' || raw === 'schedule_loader' || raw === 'end_visit') {
    return raw;
  }
  return null;
}
