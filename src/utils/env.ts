/**
 * True only when running a production build with VITE_IS_PROD=true (e.g. real production deploy).
 * In dev or staging builds, this is false so we can show non-prod banner and restrict features.
 */
export function isProduction(): boolean {
  return import.meta.env.PROD === true && import.meta.env.VITE_IS_PROD === 'true';
}

const DEFAULT_ZONE_SEARCH_BUFFER_MILES = 10;

export function getZoneSearchBufferMiles(): number {
  const raw = import.meta.env.VITE_ZONE_SEARCH_BUFFER_MILES;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_ZONE_SEARCH_BUFFER_MILES;
}

/**
 * True when the "Become a Member" / create-client flow should be available.
 * In production: always true. In lower envs: only when VITE_SHOW_CREATE_CLIENT=true.
 */
export function isCreateClientEnabled(): boolean {
  return isProduction() || import.meta.env.VITE_SHOW_CREATE_CLIENT === 'true';
}
