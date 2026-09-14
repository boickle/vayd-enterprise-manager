import type { ForwardBookingEntry } from '../../api/forwardBooking';
import {
  patchForwardBookingDisposition,
  type ForwardBookingDispositionMode,
} from '../../api/forwardBookingDisposition';
import { updateEncounter } from '../../api/visitWorkflow';
import {
  buildRoutingForwardBookingIntentFromEntries,
  buildRoutingForwardBookingIntentFromEntry,
  writeRoutingForwardBookingIntent,
} from '../../utils/routingForwardBookingIntent';
import { readForwardBookingLocalLink } from '../../utils/forwardBookingLocalLinks';
import type { ForwardBookingDecisionTarget } from './saveForwardBookingDecision';

/** Where Routing sends the doctor back to after the follow-up is on the calendar. */
export const FOLLOW_UP_BOOK_RETURN_KEY = 'vayd:follow-up-book-return-v1';

/**
 * Hands a just-created forward-booking row to the Routing workspace so the
 * follow-up can be booked while the client is still there.
 *
 * Routing owns slot search for a reason: this is a house-call practice, so a valid
 * time depends on which zone is served which day and how far the doctor has to
 * drive. Letting checkout invent a date would put unroutable visits on the
 * calendar, so we prefill Routing and let it answer that question.
 *
 * The queue row is created first, which is what makes abandoning safe: if nobody
 * finishes booking, the follow-up is still on the forward booking list for
 * scheduling staff to call about, exactly as if "Forward book" had been chosen.
 */
export function startFollowUpBooking(entries: ForwardBookingEntry[], returnTo: string): boolean {
  const [anchor, ...rest] = entries;
  if (!anchor) return false;
  // More than one pet only when the household shares a follow-up interval, in which
  // case Routing books them as one visit and completes every row.
  const intent = rest.length
    ? buildRoutingForwardBookingIntentFromEntries(anchor, entries)
    : buildRoutingForwardBookingIntentFromEntry(anchor);
  if (!intent) return false;
  writeRoutingForwardBookingIntent({ ...intent, workspaceActive: true });
  try {
    sessionStorage.setItem(
      FOLLOW_UP_BOOK_RETURN_KEY,
      JSON.stringify({ entryIds: entries.map((e) => Number(e.id)), returnTo })
    );
  } catch {
    /* quota — the queue rows still stand on their own */
  }
  return true;
}

/**
 * Promotes "Forward book" to "Booked at appointment" once the handoff above
 * actually produced a visit.
 *
 * Without this, a follow-up booked on the spot still reads as "add to the forward
 * booking list" on the chart, which understates what happened at the visit and
 * makes it impossible to tell from the record whether booking at the visit works.
 * Returns true when the disposition was changed.
 */
export async function reconcileBookedFollowUp(
  target: ForwardBookingDecisionTarget,
  entryId: number | null | undefined,
  opts: {
    practiceId: number;
    /** Only "Forward book" can be promoted — anything else is already the final word. */
    currentMode: ForwardBookingDispositionMode | null | undefined;
  }
): Promise<boolean> {
  if (entryId == null || opts.currentMode !== 'forward_book_fields') return false;
  if (!readForwardBookingLocalLink(entryId)) return false;

  const disposition = { mode: 'booked_at_appointment' as const };
  await patchForwardBookingDisposition(target.appointmentId, disposition, {
    practiceId: opts.practiceId,
  });
  if (target.soapEncounterId) {
    await updateEncounter(target.soapEncounterId, {
      forwardBookingDisposition: disposition as unknown as Record<string, unknown>,
    });
  }
  return true;
}
