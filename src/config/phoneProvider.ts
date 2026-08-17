/**
 * Frontend telephony vendor — keep in sync with API `PHONE_PROVIDER`.
 * Vite requires the `VITE_` prefix.
 *
 * - `quo` (default): Quo / OpenPhone deep links and call-analytics tabs.
 * - `schultz`: tel/sms fallbacks (or VITE_SCHULTZ_* templates); hides Quo-only tabs.
 */
export type FrontendPhoneProvider = 'quo' | 'schultz';

function phoneProviderRaw(): string {
  return (import.meta.env.VITE_PHONE_PROVIDER ?? '').toString().trim().toLowerCase();
}

export function getFrontendPhoneProvider(): FrontendPhoneProvider {
  const raw = phoneProviderRaw();
  if (raw === 'schultz' || raw === 'shultz') return 'schultz';
  return 'quo';
}

export function phoneProviderDisplayName(
  provider: FrontendPhoneProvider = getFrontendPhoneProvider(),
): string {
  return provider === 'schultz' ? 'Schultz' : 'Quo';
}

export function isQuoPhoneProvider(): boolean {
  return getFrontendPhoneProvider() === 'quo';
}
