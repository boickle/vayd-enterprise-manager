/**
 * Prefill for Book appointment → Description when booking from a forward-booking
 * (or care outreach / schedule loader / waitlist) routing intent.
 *
 * Prefer `bookingNotes` ("Forward booking note" / visit context) — that is the
 * staff-authored "what is needed" text shown on the queue and documented as
 * prefilled on follow-up book. Fall back to legacy `description` when present.
 */
export function resolveForwardBookingBookDefaultDescription(
  intent:
    | {
        bookingNotes?: string | null;
        description?: string | null;
      }
    | null
    | undefined
): string | undefined {
  if (!intent) return undefined;
  const fromNotes = intent.bookingNotes?.trim();
  if (fromNotes) return fromNotes;
  const fromDesc = intent.description?.trim();
  if (fromDesc) return fromDesc;
  return undefined;
}
