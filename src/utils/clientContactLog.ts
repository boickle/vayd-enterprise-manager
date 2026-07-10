import type { ForwardBookingEntry } from '../api/forwardBooking';
import type { ForwardBookingCreatedVia } from '../api/forwardBooking';
import type { HoldListItem, HoldSource } from '../api/holds';
import { normalizeForwardBookingCreatedVia } from '../api/forwardBooking';
import { forwardBookingEntrySourceChip } from './forwardBookingEntrySource';
import { readReminderOutreachNotes } from './reminderWorkingNotes';

export type ContactLogWriteTarget =
  | 'reminder_outreach'
  | 'forward_booking_note'
  | 'appointment_request_notes';

export type ContactLogParts = {
  /** Auto-generated visit context (bookingNotes, service summary). Read-only in Phase 1. */
  contextNote: string | null;
  /** Staff contact history — editable canonical field varies by source. */
  contactLog: string | null;
};

function normalizeParagraph(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Merge unique non-empty note blocks (paragraph-level dedupe). */
export function mergeContactLogTexts(
  ...parts: Array<string | null | undefined>
): string | null {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const trimmed = part?.trim();
    if (!trimmed) continue;
    for (const block of trimmed.split(/\n{2,}/)) {
      const paragraph = block.trim();
      if (!paragraph) continue;
      const key = normalizeParagraph(paragraph);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(paragraph);
    }
  }
  return out.length > 0 ? out.join('\n\n') : null;
}

export function forwardBookingContactLogWriteTarget(
  createdVia: ForwardBookingCreatedVia | string | null | undefined,
): ContactLogWriteTarget {
  const chip = forwardBookingEntrySourceChip({
    createdVia: createdVia as ForwardBookingEntry['createdVia'],
  });
  if (chip === 'care_outreach' || chip === 'schedule_loader') {
    return 'reminder_outreach';
  }
  return 'forward_booking_note';
}

export function holdContactLogWriteTarget(hold: HoldListItem): ContactLogWriteTarget | null {
  if (hold.appointmentRequestSubmissionId != null) {
    return 'appointment_request_notes';
  }
  if (hold.forwardBooking) {
    return forwardBookingContactLogWriteTarget(hold.forwardBooking.createdVia);
  }
  if (hold.source === 'care_outreach' || hold.source === 'schedule_loader') {
    return 'reminder_outreach';
  }
  if (hold.source === 'appointment_request') {
    return 'appointment_request_notes';
  }
  if (hold.source === 'end_visit' || hold.source === 'manual') {
    return 'forward_booking_note';
  }
  return null;
}

export function buildForwardBookingContactLogParts(args: {
  note?: string | null;
  bookingNotes?: string | null;
  reminderOutreachNotes?: string | null;
}): ContactLogParts {
  return {
    contextNote: args.bookingNotes?.trim() || null,
    contactLog: mergeContactLogTexts(args.reminderOutreachNotes, args.note),
  };
}

export function buildHoldContactLogParts(args: {
  hold: HoldListItem;
  reminderOutreachNotes?: string | null;
  submissionNotes?: string | null;
}): ContactLogParts {
  const { hold, reminderOutreachNotes, submissionNotes } = args;
  const fb = hold.forwardBooking;
  const contextNote = fb?.bookingNotes?.trim() || null;
  const contactLog = mergeContactLogTexts(
    reminderOutreachNotes,
    fb?.note,
    submissionNotes,
    hold.source === 'appointment_request' ? null : hold.instructions,
  );
  return { contextNote, contactLog };
}

export function reminderOutreachNotesForPatient(
  reminders: readonly { patient?: { id?: number } | null; outreachNotes?: string | null; notes?: string | null }[],
  patientId: number | null | undefined,
): string | null {
  if (patientId == null) return null;
  const texts = reminders
    .filter((r) => r.patient?.id === patientId)
    .map(readReminderOutreachNotes)
    .filter(Boolean);
  return mergeContactLogTexts(...texts);
}

export function holdSourceUsesReminderOutreach(source: HoldSource): boolean {
  return source === 'care_outreach' || source === 'schedule_loader';
}

export function createdViaUsesReminderOutreach(
  createdVia: ForwardBookingCreatedVia | string | null | undefined,
): boolean {
  const via = normalizeForwardBookingCreatedVia(createdVia);
  return via === 'care_outreach' || via === 'schedule_loader';
}
