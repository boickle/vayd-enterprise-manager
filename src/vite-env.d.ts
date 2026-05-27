/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_MOCK_AUTH: string;
  readonly VITE_IS_PROD: string;
  readonly VITE_GA_MEASUREMENT_ID?: string;
  readonly VITE_GOOGLE_ADS_TAG_ID?: string;
  readonly VITE_ZONE_SEARCH_BUFFER_MILES?: string;
  /** In lower envs: set to 'true' to show "Become a Member" / create-client. In production, create-client is always enabled. */
  readonly VITE_SHOW_CREATE_CLIENT: string;
  readonly VITE_APPOINTMENT_FORM_DRAFTS_ENABLED?: string;
  /** Minutes of inactivity before idle_timeout abandon (default 15; 0 disables). */
  readonly VITE_APPOINTMENT_FORM_ABANDON_IDLE_MINUTES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
