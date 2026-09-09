/**
 * Last-paid-click attribution for Google Ads / GA4.
 * Click IDs persist 90 days so a later organic/direct submit still carries the ad click.
 */

export const MARKETING_ATTRIBUTION_STORAGE_KEY = 'vayd_marketing_attribution';
export const MARKETING_ATTRIBUTION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export type MarketingAttribution = {
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  gaClientId?: string;
  gaSessionId?: string;
  capturedAt?: number;
};

function cleanToken(value: unknown, max = 256): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return undefined;
  if (/[\s<>'"]/.test(trimmed)) return undefined;
  return trimmed;
}

function cleanUtm(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 256) return undefined;
  return trimmed;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return null;
}

/** `_ga` cookie: GA1.1.XXXXXXXXXX.YYYYYYYYYY → XXXXXXXXXX.YYYYYYYYYY */
export function parseGaClientIdFromCookie(cookieValue: string | null): string | undefined {
  if (!cookieValue) return undefined;
  const parts = cookieValue.split('.');
  if (parts.length < 4) return undefined;
  const clientId = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  return /^\d+\.\d+$/.test(clientId) ? clientId : undefined;
}

/**
 * GA4 session cookie `_ga_XXXX`: GS2.1.sSESSION$o1$g1$t... → SESSION
 */
export function parseGaSessionIdFromCookie(cookieValue: string | null): string | undefined {
  if (!cookieValue) return undefined;
  const match = cookieValue.match(/s(\d+)/);
  return match?.[1];
}

function readGaClientId(): string | undefined {
  return parseGaClientIdFromCookie(readCookie('_ga'));
}

function readGaSessionId(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const measurementId = (import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined)?.trim();
  if (measurementId?.startsWith('G-')) {
    const fromNamed = parseGaSessionIdFromCookie(readCookie(`_ga_${measurementId.slice(2)}`));
    if (fromNamed) return fromNamed;
  }
  for (const part of document.cookie.split(';')) {
    const name = part.trim().split('=')[0];
    if (name && name.startsWith('_ga_') && name !== '_ga') {
      const value = readCookie(name);
      const sessionId = parseGaSessionIdFromCookie(value);
      if (sessionId) return sessionId;
    }
  }
  return undefined;
}

function isFresh(stored: MarketingAttribution | null): stored is MarketingAttribution {
  if (!stored?.capturedAt || !Number.isFinite(stored.capturedAt)) return false;
  return Date.now() - stored.capturedAt < MARKETING_ATTRIBUTION_TTL_MS;
}

export function parseAttributionFromSearch(search: string): Partial<MarketingAttribution> {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  const out: Partial<MarketingAttribution> = {};
  const gclid = cleanToken(params.get('gclid'));
  const gbraid = cleanToken(params.get('gbraid'));
  const wbraid = cleanToken(params.get('wbraid'));
  const utmSource = cleanUtm(params.get('utm_source'));
  const utmMedium = cleanUtm(params.get('utm_medium'));
  const utmCampaign = cleanUtm(params.get('utm_campaign'));
  const utmTerm = cleanUtm(params.get('utm_term'));
  const utmContent = cleanUtm(params.get('utm_content'));
  if (gclid) out.gclid = gclid;
  if (gbraid) out.gbraid = gbraid;
  if (wbraid) out.wbraid = wbraid;
  if (utmSource) out.utmSource = utmSource;
  if (utmMedium) out.utmMedium = utmMedium;
  if (utmCampaign) out.utmCampaign = utmCampaign;
  if (utmTerm) out.utmTerm = utmTerm;
  if (utmContent) out.utmContent = utmContent;
  return out;
}

export function mergeMarketingAttribution(
  stored: MarketingAttribution | null,
  fromUrl: Partial<MarketingAttribution>,
): MarketingAttribution {
  const base: MarketingAttribution = isFresh(stored) ? { ...stored } : {};
  const hasUtm = Boolean(
    fromUrl.utmSource ||
      fromUrl.utmMedium ||
      fromUrl.utmCampaign ||
      fromUrl.utmTerm ||
      fromUrl.utmContent,
  );
  const next: MarketingAttribution = { ...base };
  if (fromUrl.gclid) next.gclid = fromUrl.gclid;
  if (fromUrl.gbraid) next.gbraid = fromUrl.gbraid;
  if (fromUrl.wbraid) next.wbraid = fromUrl.wbraid;
  if (hasUtm) {
    next.utmSource = fromUrl.utmSource;
    next.utmMedium = fromUrl.utmMedium;
    next.utmCampaign = fromUrl.utmCampaign;
    next.utmTerm = fromUrl.utmTerm;
    next.utmContent = fromUrl.utmContent;
  }
  return next;
}

function readStored(): MarketingAttribution | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(MARKETING_ATTRIBUTION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MarketingAttribution;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeStored(value: MarketingAttribution): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MARKETING_ATTRIBUTION_STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* private mode / quota */
  }
}

export function captureMarketingAttribution(
  search: string = typeof window !== 'undefined' ? window.location.search : '',
): MarketingAttribution {
  const merged = mergeMarketingAttribution(readStored(), parseAttributionFromSearch(search));
  const next: MarketingAttribution = {
    ...merged,
    capturedAt: Date.now(),
  };
  const gaClientId = readGaClientId();
  const gaSessionId = readGaSessionId();
  if (gaClientId) next.gaClientId = gaClientId;
  if (gaSessionId) next.gaSessionId = gaSessionId;
  writeStored(next);
  return next;
}

/** Payload for POST /public/appointments/form — no PII. */
export function getMarketingAttributionForSubmit(): MarketingAttribution | undefined {
  const captured = captureMarketingAttribution();
  const out: MarketingAttribution = {};
  if (captured.gclid) out.gclid = captured.gclid;
  if (captured.gbraid) out.gbraid = captured.gbraid;
  if (captured.wbraid) out.wbraid = captured.wbraid;
  if (captured.utmSource) out.utmSource = captured.utmSource;
  if (captured.utmMedium) out.utmMedium = captured.utmMedium;
  if (captured.utmCampaign) out.utmCampaign = captured.utmCampaign;
  if (captured.utmTerm) out.utmTerm = captured.utmTerm;
  if (captured.utmContent) out.utmContent = captured.utmContent;
  if (captured.gaClientId) out.gaClientId = captured.gaClientId;
  if (captured.gaSessionId) out.gaSessionId = captured.gaSessionId;
  return Object.keys(out).length > 0 ? out : undefined;
}
