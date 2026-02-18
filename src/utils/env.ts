/**
 * True only when running a production build with VITE_IS_PROD=true (e.g. real production deploy).
 * In dev or staging builds, this is false so we can show non-prod banner and restrict features.
 */
export function isProduction(): boolean {
  return import.meta.env.PROD === true && import.meta.env.VITE_IS_PROD === 'true';
}
