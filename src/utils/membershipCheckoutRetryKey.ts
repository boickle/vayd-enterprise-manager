/**
 * PAY-A9: one idempotency key per membership checkout attempt.
 *
 * When Pay gets no answer from the server (the connection dropped, or the server says the
 * card processor never replied), the signup may already have gone through. Paying again
 * must send the same key so the server returns the first result instead of starting a
 * second subscription. Once the server has answered (success, decline, any refusal) the
 * next Pay is a new attempt with a new key, so a different card can be tried.
 */
export function newCheckoutKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `membership-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Whether the next Pay should reuse this attempt's key: the outcome is unknown. */
export function keepCheckoutKeyAfterError(err: unknown): boolean {
  const e = err as { response?: { status?: number }; request?: unknown; code?: string } | null;
  if (!e || typeof e !== 'object') return false;
  const status = e.response?.status;
  if (status == null) {
    // Axios network error / timeout: the request went out but no reply came back.
    return Boolean(e.request) || e.code === 'ERR_NETWORK' || e.code === 'ECONNABORTED';
  }
  // Gateway errors and "no reply from the card processor": the server may have charged.
  return status === 502 || status === 503 || status === 504;
}
