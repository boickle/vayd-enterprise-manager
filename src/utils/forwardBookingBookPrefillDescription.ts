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

export type ForwardBookingDescriptionSource = {
  patientId: string;
  bookingNotes?: string | null;
  description?: string | null;
};

/**
 * Map each household forward-booking row to its own Description prefill.
 * Multi-pet books must not reuse the anchor pet's notes for siblings.
 */
export function resolveForwardBookingVisitDescriptionsByPatientId(
  entries: readonly ForwardBookingDescriptionSource[] | null | undefined
): Map<string, string> {
  const byPatient = new Map<string, string>();
  for (const entry of entries ?? []) {
    const patientId = String(entry.patientId ?? '').trim();
    if (!patientId) continue;
    const text = resolveForwardBookingBookDefaultDescription(entry);
    if (!text) continue;
    byPatient.set(patientId, text);
  }
  return byPatient;
}
