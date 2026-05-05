/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
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
