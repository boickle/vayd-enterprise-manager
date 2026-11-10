/**
 * Outside production the server texts only the test number, even for "Send to actual client",
 * unless the client's number is on the server's NOTIFY_ALLOW_PHONES list (COM-A13).
 */
export const SMS_OUTSIDE_PRODUCTION_NOTE =
  "Outside production, texts go to the test number unless the client's number is on the server's allow list (NOTIFY_ALLOW_PHONES).";

/** True when the "Send to actual client" option is shown (non-production only). */
export function smsAllowsProductionOverride(): boolean {
  if (import.meta.env.VITE_IS_PROD === 'true') return false;
  return import.meta.env.MODE !== 'production';
}
