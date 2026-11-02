/**
 * Last-paid-click attribution for Google Ads / GA4.
 * Click IDs persist 90 days so a later organic/direct submit still carries the ad click.
 *
 * Ad clicks land on the Wix site, which forwards them to the portal through Google's
 * cross-domain linker (`_gl`) and first-party cookies (`_gcl_aw`, `_gcl_gb`), not as
 * a plain `?gclid=` on the portal URL.
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
  if (!measurementId?.startsWith('G-')) return undefined;
  // Only this property. The Wix linker also copies `_ga_<other property>` onto the portal.
  return parseGaSessionIdFromCookie(readCookie(`_ga_${measurementId.slice(2)}`));
}

/** Conversion-linker cookie: `GCL.<unix seconds>.<click id>`. */
export function parseClickIdFromGclValue(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^GCL\.\d+\.(.+)$/.exec(value.trim());
  if (!match?.[1]) return undefined;
  let clickId = match[1];
  try {
    clickId = decodeURIComponent(clickId);
  } catch {
    /* keep raw */
  }
  return cleanToken(clickId, 256);
}

/** Google linker segments are base64, with `.` used as padding. */
export function decodeGlSegment(segment: string): string | undefined {
  const normalized = segment
    .trim()
    .replace(/\.+$/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  if (!normalized || !/^[A-Za-z0-9+/]+$/.test(normalized)) return undefined;
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  try {
    return atob(normalized + pad);
  } catch {
    return undefined;
  }
}

/**
 * Click ids Google's site linker puts on the portal URL.
 * `_gcl_aw` is the gclid, `_gcl_gb` is the gbraid, `_ga` is the client id.
 */
export function parseAttributionFromGl(search: string): Partial<MarketingAttribution> {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  const gl = new URLSearchParams(raw).get('_gl');
  if (!gl) return {};
  const parts = gl.split('*');
  const out: Partial<MarketingAttribution> = {};
  for (let i = 2; i + 1 < parts.length; i += 2) {
    const decoded = decodeGlSegment(parts[i + 1]);
    if (!decoded) continue;
    if (parts[i] === '_gcl_aw') {
      const gclid = parseClickIdFromGclValue(decoded);
      if (gclid) out.gclid = gclid;
    } else if (parts[i] === '_gcl_gb') {
      const gbraid = parseClickIdFromGclValue(decoded);
      if (gbraid) out.gbraid = gbraid;
    } else if (parts[i] === '_ga' && /^\d+\.\d+$/.test(decoded)) {
      const gaClientId = cleanToken(decoded, 64);
      if (gaClientId) out.gaClientId = gaClientId;
    }
  }
  return out;
}

function readClickIdsFromAdsCookies(): Partial<MarketingAttribution> {
  const out: Partial<MarketingAttribution> = {};
  const gclid = parseClickIdFromGclValue(readCookie('_gcl_aw'));
  const gbraid = parseClickIdFromGclValue(readCookie('_gcl_gb'));
  if (gclid) out.gclid = gclid;
  if (gbraid) out.gbraid = gbraid;
  return out;
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
  const fromGl = parseAttributionFromGl(search);
  const fromUrl = parseAttributionFromSearch(search);
  // Explicit `?gclid=` wins, then the linker param, then the ads cookie.
  const merged = mergeMarketingAttribution(readStored(), {
    ...readClickIdsFromAdsCookies(),
    ...fromGl,
    ...fromUrl,
  });
  const next: MarketingAttribution = {
    ...merged,
    capturedAt: Date.now(),
  };
  const gaClientId = readGaClientId() ?? fromGl.gaClientId;
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
