/**
 * A payment that went through clears any earlier error (for example "Your card was declined." from
 * the card tried first) and shows the success note. Every checkout success path uses this, so a
 * stale decline never sits above "invoice marked paid" (Wave 8, bug 7).
 */
export function showPaymentSuccess(
  ui: { setError: (v: string | null) => void; setNote: (v: string | null) => void },
  note: string,
): void {
  ui.setError(null);
  ui.setNote(note);
}
