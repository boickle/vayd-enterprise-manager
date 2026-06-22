/**
 * Client confirm page lives on the same host as Scout / portal — not a separate subdomain.
 *
 * SMS links: `{origin}/confirm/{token}`
 *   local:  http://localhost:5173/confirm/abc123
 *   prod:   https://portal.vetatyourdoor.com/confirm/abc123
 *
 * Backend env `SLOT_OFFER_CONFIRM_BASE_URL` should be `{origin}/confirm` (no token).
 * The API appends `/{token}` when building SMS links.
 */
export function slotOfferConfirmPath(token: string): string {
  const t = token.trim();
  return `/confirm/${encodeURIComponent(t)}`;
}

export function slotOfferConfirmUrl(token: string, origin = typeof window !== 'undefined' ? window.location.origin : ''): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}${slotOfferConfirmPath(token)}`;
}
