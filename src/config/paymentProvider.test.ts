/**
 * PAY-05-1 — the payment provider defaults to Stripe when VITE_PAYMENT_PROVIDER is unset.
 * Run: npx vitest run src/config/paymentProvider.test.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFrontendPaymentProvider, paymentProcessingApiBasePath } from './paymentProvider';

describe('PAY-05-1: payment provider default', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('PAY-05-1: VITE_PAYMENT_PROVIDER empty gives stripe and the Stripe API path', () => {
    vi.stubEnv('VITE_PAYMENT_PROVIDER', '');
    expect(getFrontendPaymentProvider()).toBe('stripe');
    expect(paymentProcessingApiBasePath()).toBe('/stripe/payment-processing');
  });

  it('PAY-05-1: VITE_PAYMENT_PROVIDER unset gives stripe', () => {
    vi.stubEnv('VITE_PAYMENT_PROVIDER', undefined as unknown as string);
    expect(getFrontendPaymentProvider()).toBe('stripe');
    expect(paymentProcessingApiBasePath()).toBe('/stripe/payment-processing');
  });

  it('PAY-05-1: exactly square still selects Square', () => {
    vi.stubEnv('VITE_PAYMENT_PROVIDER', 'square');
    expect(getFrontendPaymentProvider()).toBe('square');
    expect(paymentProcessingApiBasePath()).toBe('/payment-processing');
  });

  it('PAY-05-1: stripe selects Stripe', () => {
    vi.stubEnv('VITE_PAYMENT_PROVIDER', 'stripe');
    expect(getFrontendPaymentProvider()).toBe('stripe');
  });
});
