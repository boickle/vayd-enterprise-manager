import type { ForwardBookingEntry, ForwardBookingCreatedVia } from '../api/forwardBooking';
import { normalizeForwardBookingCreatedVia } from '../api/forwardBooking';

/** Chips shown on On Hold rows — subset of {@link ForwardBookingCreatedVia}. */
export type ForwardBookingSourceChip = Extract<
  ForwardBookingCreatedVia,
  'care_outreach' | 'schedule_loader' | 'end_visit' | 'appointment_request'
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
  if (!via || via === 'unknown' || via === 'manual') {
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
    case 'appointment_request':
      return 'Appointments';
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
    case 'appointment_request':
      return { background: '#fce7f3', color: '#9d174d' };
    default:
      return { background: '#eff6ff', color: '#1d4ed8' };
  }
}

/** URL / filter param — accepts legacy `forward_booking` alias. */
export function parseForwardBookingSourceChipFilter(
  raw: string | null
): ForwardBookingSourceChip | null {
  if (raw === 'forward_booking') return 'end_visit';
  if (raw === 'appointments') return 'appointment_request';
  if (
    raw === 'care_outreach' ||
    raw === 'schedule_loader' ||
    raw === 'end_visit' ||
    raw === 'appointment_request'
  ) {
    return raw;
  }
  return null;
}

/** Appointment-request holds are triaged under /schedule/appointments/on-hold. */
export function forwardBookingOnHoldBelongsInSchedulingTools(
  entry: Pick<ForwardBookingEntry, 'createdVia'>
): boolean {
  return forwardBookingEntrySourceChip(entry) !== 'appointment_request';
}

/** Care outreach and schedule loader rows are triaged on their own tabs, not Forward booking. */
export function forwardBookingEntryBelongsOnForwardBookingPage(
  entry: Pick<ForwardBookingEntry, 'createdVia'>
): boolean {
  const via = normalizeForwardBookingCreatedVia(entry.createdVia);
  return via !== 'care_outreach' && via !== 'schedule_loader';
}

export function forwardBookingSourceBookingNotesLabel(
  entry: Pick<ForwardBookingEntry, 'createdVia'>
): string {
  const chip = forwardBookingEntrySourceChip(entry);
  switch (chip) {
    case 'care_outreach':
      return 'Care outreach note';
    case 'schedule_loader':
      return 'Schedule loader note';
    case 'appointment_request':
      return 'Appointment note';
    default:
      return 'Forward booking note';
  }
}

/** Staff working note on the queue entry (Forward booking Notes / outreach notes on hold). */
export function forwardBookingListNoteText(
  entry: Pick<ForwardBookingEntry, 'note' | 'createdVia' | 'patientId'>,
  opts?: { reminderOutreachNotesByPatientId?: ReadonlyMap<number, string> },
): string {
  const staffNote = entry.note?.trim();
  if (staffNote) return staffNote;
  const chip = forwardBookingEntrySourceChip(entry);
  if (
    opts?.reminderOutreachNotesByPatientId &&
    entry.patientId != null &&
    (chip === 'care_outreach' || chip === 'schedule_loader')
  ) {
    return opts.reminderOutreachNotesByPatientId.get(entry.patientId)?.trim() ?? '';
  }
  return '';
}
