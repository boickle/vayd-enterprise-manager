// src/api/geo.ts
import { http } from './http';

export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const { data } = await http.get('/geo/reverse', { params: { lat, lon } });
  return data?.address ?? data?.formattedAddress ?? `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

// ------------------------------
// Forward geocode (NEW)
// ------------------------------
export type GeocodeSource = 'osm' | 'google';
export type MatchLevel = 'street' | 'partial' | 'city';

export type ForwardGeocodeOpts = {
  country?: string; // e.g. 'US'
  adminArea?: string; // e.g. 'ME'
  bounds?: {
    // optional search bias
    sw: [number, number]; // [lat, lon]
    ne: [number, number]; // [lat, lon]
  };
};

export type ForwardGeocodeResult = {
  lat: number;
  lon: number;
  source: GeocodeSource;
  matchLevel: MatchLevel;
  address: string; // short/pretty when available
  formattedAddress: string; // same as address (controller aligns both)
  raw?: any; // provider payload (optional)
};

function boundsToParam(b?: ForwardGeocodeOpts['bounds']): string | undefined {
  if (!b) return undefined;
  const { sw, ne } = b;
  if (!sw || !ne) return undefined;
  return `${sw[0]},${sw[1]}|${ne[0]},${ne[1]}`;
}

/** Call /geo/forward to resolve an address into lat/lon. */
export async function forwardGeocode(
  q: string,
  opts?: ForwardGeocodeOpts
): Promise<ForwardGeocodeResult> {
  const params: Record<string, string> = { q };
  if (opts?.country) params.country = opts.country;
  if (opts?.adminArea) params.adminArea = opts.adminArea;
  const bounds = boundsToParam(opts?.bounds);
  if (bounds) params.bounds = bounds;

  const { data } = await http.get('/geo/forward', { params });
  return {
    lat: Number(data?.lat),
    lon: Number(data?.lon),
    source: data?.source as GeocodeSource,
    matchLevel: data?.matchLevel as MatchLevel,
    address: data?.address ?? data?.formattedAddress ?? q,
    formattedAddress: data?.formattedAddress ?? data?.address ?? q,
    raw: data?.raw,
  };
}

/**
 * Validate an address with forward geocoding.
 * By default we require a 'street' level match to allow routing.
 */
export async function validateAddress(
  address: string,
  opts?: ForwardGeocodeOpts & { minLevel?: MatchLevel } // default 'street'
): Promise<
  | { ok: true; result: ForwardGeocodeResult }
  | { ok: false; reason: 'not_found' | 'too_vague' | 'error'; message: string }
> {
  const minLevel: MatchLevel = opts?.minLevel ?? 'street';
  try {
    const res = await forwardGeocode(address, opts);
    const levelRank: Record<MatchLevel, number> = { street: 3, partial: 2, city: 1 };
    const ok = levelRank[res.matchLevel] >= levelRank[minLevel];

    if (!ok) {
      return {
        ok: false,
        reason: 'too_vague',
        message:
          res.matchLevel === 'city'
            ? 'Address is too general (matched only a city). Please include street and number.'
            : 'Address is incomplete (matched only a street/route). Please include a street number.',
      };
    }
    return { ok: true, result: res };
  } catch (e: any) {
    // 404 from controller -> not_found
    const status = e?.response?.status;
    if (status === 404) {
      return { ok: false, reason: 'not_found', message: 'Address not found.' };
    }
    return {
      ok: false,
      reason: 'error',
      message: e?.response?.data?.message || e?.message || 'Failed to validate address.',
    };
  }
}

// ------------------------------
// Places autocomplete
// ------------------------------
export type GeoAutocompleteSuggestion = {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
};

export type GeoStructuredAddress = {
  address1: string;
  address2: string | null;
  city: string;
  state: string;
  zipcode: string;
  country: string;
};

export type GeoPlaceDetails = {
  placeId: string;
  formattedAddress: string;
  lat: number;
  lon: number;
  address: GeoStructuredAddress;
};

export type GeoAutocompleteOpts = {
  country?: string;
  adminArea?: string;
  bounds?: ForwardGeocodeOpts['bounds'];
};

function autocompleteParams(
  q: string,
  sessionToken: string,
  opts?: GeoAutocompleteOpts
): Record<string, string> {
  const params: Record<string, string> = { q, sessionToken };
  if (opts?.country) params.country = opts.country;
  if (opts?.adminArea) params.adminArea = opts.adminArea;
  const bounds = boundsToParam(opts?.bounds);
  if (bounds) params.bounds = bounds;
  return params;
}

export async function publicGeoAutocomplete(
  q: string,
  sessionToken: string,
  opts?: GeoAutocompleteOpts
): Promise<GeoAutocompleteSuggestion[]> {
  const { data } = await http.get('/public/geo/autocomplete', {
    params: autocompleteParams(q, sessionToken, opts),
  });
  return Array.isArray(data?.suggestions) ? data.suggestions : [];
}

export async function publicGeoPlaceDetails(
  placeId: string,
  sessionToken: string
): Promise<GeoPlaceDetails> {
  const { data } = await http.get(`/public/geo/place/${encodeURIComponent(placeId)}`, {
    params: { sessionToken },
  });
  return data as GeoPlaceDetails;
}

export async function geoAutocomplete(
  q: string,
  sessionToken: string,
  opts?: GeoAutocompleteOpts
): Promise<GeoAutocompleteSuggestion[]> {
  const { data } = await http.get('/geo/autocomplete', {
    params: autocompleteParams(q, sessionToken, opts),
  });
  return Array.isArray(data?.suggestions) ? data.suggestions : [];
}

export async function geoPlaceDetails(
  placeId: string,
  sessionToken: string
): Promise<GeoPlaceDetails> {
  const { data } = await http.get(`/geo/place/${encodeURIComponent(placeId)}`, {
    params: { sessionToken },
  });
  return data as GeoPlaceDetails;
}

export function placeDetailsToAddressFields(details: GeoPlaceDetails) {
  const { address: a } = details;
  return {
    line1: a.address1 || '',
    line2: a.address2 || undefined,
    city: a.city || '',
    state: a.state || '',
    zip: a.zipcode || '',
    country: a.country || 'US',
    lat: details.lat,
    lon: details.lon,
  };
}

export function formatAddressFields(addr: {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  zip?: string;
}): string {
  const line = [addr.line1, addr.line2].filter(Boolean).join(', ');
  const locality = [addr.city, addr.state, addr.zip].filter(Boolean).join(', ');
  return [line, locality].filter(Boolean).join(', ');
}
