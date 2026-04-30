/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  /** `square` (default) or `stripe` — controls payment SDK and payment-processing API paths. */
  readonly VITE_PAYMENT_PROVIDER?: string;
  /** Stripe publishable key (pk_test_… / pk_live_…). Required when VITE_PAYMENT_PROVIDER=stripe. */
  readonly VITE_STRIPE_PUBLISHABLE_KEY?: string;
  readonly VITE_MOCK_AUTH: string;
  readonly VITE_IS_PROD: string;
  readonly VITE_GA_MEASUREMENT_ID?: string;
  readonly VITE_GOOGLE_ADS_TAG_ID?: string;
  /** In lower envs: set to 'true' to show "Become a Member" / create-client. In production, create-client is always enabled. */
  readonly VITE_SHOW_CREATE_CLIENT: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
