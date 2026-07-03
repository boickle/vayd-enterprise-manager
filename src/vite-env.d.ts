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
  readonly VITE_ZONE_SEARCH_BUFFER_MILES?: string;
  /** Extra minutes for the first new patient in a visit (default 15). */
  readonly VITE_ROUTING_FIRST_NEW_PATIENT_DURATION_BUFFER_MINUTES?: string;
  /** Extra minutes for each additional new patient beyond the first (default 10). */
  readonly VITE_ROUTING_ADDITIONAL_NEW_PATIENT_DURATION_BUFFER_MINUTES?: string;
  /** @deprecated Use VITE_ROUTING_FIRST_NEW_PATIENT_DURATION_BUFFER_MINUTES */
  readonly VITE_ROUTING_NEW_PATIENT_DURATION_BUFFER_MINUTES?: string;
  /** Extra routing/self-schedule minutes for households with 3+ pets (default 20). */
  readonly VITE_ROUTING_HOUSEHOLD_DURATION_BUFFER_MINUTES?: string;
  /** Pet count above which the household duration buffer applies (default 2 → 3+ pets). */
  readonly VITE_ROUTING_HOUSEHOLD_PET_COUNT_THRESHOLD?: string;
  /** In lower envs: set to 'true' to show "Become a Member" / create-client. In production, create-client is always enabled. */
  readonly VITE_SHOW_CREATE_CLIENT: string;
  readonly VITE_APPOINTMENT_FORM_DRAFTS_ENABLED?: string;
  /** Minutes of inactivity before idle_timeout abandon (default 15; 0 disables). */
  readonly VITE_APPOINTMENT_FORM_ABANDON_IDLE_MINUTES?: string;
  /** Set to 'true' to show the AI visit scribe panel on the SOAP encounter page (docs/ai-scribe.md). Pilot rollout flag. */
  readonly VITE_ENABLE_SCRIBE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
