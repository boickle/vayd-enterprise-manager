/**
 * Single switch for the whole membership checkout stack (plans, catalog, card SDK, charge URL).
 * Vite requires the `VITE_` prefix for browser-exposed env (equivalent to backend `PAYMENT_PROVIDER=…`).
 *
 * - `square` (default): Square REST paths under `/payment-processing/…`, Square Web Payments SDK, nonces.
 * - `stripe`: Stripe REST paths under `/stripe/payment-processing/…`, Stripe.js, `pm_…`.
 */
export type FrontendPaymentProvider = 'square' | 'stripe';

function paymentProviderRaw(): string {
  return (import.meta.env.VITE_PAYMENT_PROVIDER ?? '').toString().trim().toLowerCase();
}

export function getFrontendPaymentProvider(): FrontendPaymentProvider {
  return paymentProviderRaw() === 'stripe' ? 'stripe' : 'square';
}

/** Base path for subscription catalog, formatted plans, and payment POST (no trailing slash). */
export function paymentProcessingApiBasePath(): string {
  return getFrontendPaymentProvider() === 'stripe' ? '/stripe/payment-processing' : '/payment-processing';
}

export function getStripePublishableKey(): string {
  return (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? '').toString().trim();
}
