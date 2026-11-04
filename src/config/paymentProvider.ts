/**
 * Single switch for the whole membership checkout stack (plans, catalog, card SDK, charge URL).
 * Vite requires the `VITE_` prefix for browser-exposed env (equivalent to backend `PAYMENT_PROVIDER=…`).
 *
 * - `stripe` (default, including when unset or empty): Stripe REST paths under `/stripe/payment-processing/…`,
 *   Stripe.js, `pm_…`.
 * - `square`: only when VITE_PAYMENT_PROVIDER is exactly `square`. Square is no longer the default: the API
 *   refuses new Square signups, so a build without the variable must not fall back to it.
 */
export type FrontendPaymentProvider = 'square' | 'stripe';

function paymentProviderRaw(): string {
  return (import.meta.env.VITE_PAYMENT_PROVIDER ?? '').toString().trim().toLowerCase();
}

export function getFrontendPaymentProvider(): FrontendPaymentProvider {
  return paymentProviderRaw() === 'square' ? 'square' : 'stripe';
}

/** Base path for subscription catalog, formatted plans, and payment POST (no trailing slash). */
export function paymentProcessingApiBasePath(): string {
  return getFrontendPaymentProvider() === 'stripe' ? '/stripe/payment-processing' : '/payment-processing';
}

export function getStripePublishableKey(): string {
  return (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? '').toString().trim();
}
