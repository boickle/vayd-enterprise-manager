/**
 * Online auto-book calendar descriptions historically append the visit reason from
 * `needsTodayDetails` / top-level `visitDetails` as:
 *   "Online Booking - Client. Pet: <reason>"
 *
 * Euthanasia submits the narrative in `euthanasiaReason` instead, so auto-book
 * titles become "Online Booking - Client. Pet." with no reason. Mirror the
 * euthanasia narrative into the fields the auto-book path already reads.
 *
 * Keep `euthanasiaReason` as the canonical field for Scout detail / email.
 */

export function trimNonEmpty(value: unknown): string | undefined {
  if (value == null) return undefined;
  const s = String(value).trim();
  return s || undefined;
}

/** Copy euthanasia reason into needsTodayDetails when that field is empty. */
export function withEuthanasiaReasonMirroredToNeedsTodayDetails<
  T extends { euthanasiaReason?: string; needsTodayDetails?: string },
>(petData: T): T {
  const reason = trimNonEmpty(petData.euthanasiaReason);
  if (!reason) return petData;
  if (trimNonEmpty(petData.needsTodayDetails)) return petData;
  return { ...petData, needsTodayDetails: reason };
}

/**
 * Top-level online-booking payloads use `visitDetails` for regular visits.
 * Mirror euthanasiaReason there when visitDetails is empty so auto-book notes
 * still pick up the narrative on legacy single-pet euthanasia submits.
 */
export function withEuthanasiaReasonMirroredToVisitDetails(opts: {
  euthanasiaReason?: string | null;
  visitDetails?: string | null;
}): { visitDetails?: string } {
  const reason = trimNonEmpty(opts.euthanasiaReason);
  if (!reason) return {};
  if (trimNonEmpty(opts.visitDetails)) return {};
  return { visitDetails: reason };
}

/** Skip a secondary "visit details" line when it duplicates the euthanasia reason. */
export function isDuplicateEuthanasiaVisitDetails(
  visitDetails: string | null | undefined,
  euthanasiaReason: string | null | undefined,
): boolean {
  const details = trimNonEmpty(visitDetails);
  const reason = trimNonEmpty(euthanasiaReason);
  return Boolean(details && reason && details === reason);
}
