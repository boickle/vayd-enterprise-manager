// src/api/practicePublicConfig.ts
import { http } from './http';
import { getStripePublishableKey } from '../config/paymentProvider';

/** Non-secret values for the practice this host serves; available before sign-in. */
export type PracticePublicConfig = {
  practiceKey: string;
  isDefaultPractice: boolean;
  stripePublishableKey: string | null;
};

let configPromise: Promise<PracticePublicConfig> | null = null;

export function fetchPracticePublicConfig(): Promise<PracticePublicConfig> {
  configPromise ??= http
    .get<PracticePublicConfig>('/practice/public-config')
    .then(({ data }) => data)
    .catch((err) => {
      configPromise = null;
      throw err;
    });
  return configPromise;
}

/**
 * The Stripe publishable key for this host's practice. The build-time key
 * belongs to the default practice only; any other practice must have its own.
 */
export async function loadStripePublishableKey(): Promise<string> {
  try {
    const config = await fetchPracticePublicConfig();
    const own = config.stripePublishableKey?.trim();
    if (own) return own;
    return config.isDefaultPractice ? getStripePublishableKey() : '';
  } catch {
    return '';
  }
}
