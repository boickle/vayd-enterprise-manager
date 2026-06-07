/** True when QA/dev may send SMS to real clients via `overrideNonProd`. */
export function smsAllowsProductionOverride(): boolean {
  if (import.meta.env.VITE_IS_PROD === 'true') return false;
  return import.meta.env.MODE !== 'production';
}
