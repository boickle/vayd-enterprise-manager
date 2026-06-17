import { formatAddressFields, validateAddress, type ForwardGeocodeOpts } from '../api/geo';
import type { AddressFields } from '../components/AddressAutocomplete';

export const EMPTY_ADDRESS_FIELDS: AddressFields = {
  line1: '',
  city: '',
  state: '',
  zip: '',
  country: 'US',
};

export function addressFieldsFromFreeText(text: string): AddressFields {
  const line1 = text.trim();
  if (!line1) return { ...EMPTY_ADDRESS_FIELDS };
  return { ...EMPTY_ADDRESS_FIELDS, line1 };
}

export function parseCoordinate(v: unknown): number | undefined {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
}

export function addressFieldsFromClient(
  c: Partial<{
    address1?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    lat?: number | string | null;
    lon?: number | string | null;
  }>,
  formattedAddress?: string
): AddressFields {
  const lat = parseCoordinate(c.lat);
  const lon = parseCoordinate(c.lon);
  const line1 = c.address1?.trim() || formattedAddress?.trim() || '';
  return {
    line1,
    city: c.city?.trim() || '',
    state: c.state?.trim() || '',
    zip: c.zip?.trim() || '',
    country: 'US',
    ...(lat != null ? { lat } : {}),
    ...(lon != null ? { lon } : {}),
  };
}

export function addressFieldsFromRoutingCoords(
  address: string,
  lat?: number,
  lon?: number
): AddressFields {
  const base = addressFieldsFromFreeText(address);
  if (lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)) {
    return { ...base, lat, lon };
  }
  return base;
}

/** Forward-geocode for routing — street-level match required. */
export async function geocodeRoutingAddressText(
  address: string
): Promise<
  | { ok: true; address: string; lat: number; lon: number }
  | { ok: false; message: string }
> {
  const trimmed = address.trim();
  if (!trimmed) {
    return { ok: false, message: 'Enter a street address or pick a client with an address on file.' };
  }
  const chk = await validateAddress(trimmed, { minLevel: 'street' });
  if (!chk.ok) return { ok: false, message: chk.message };
  return {
    ok: true,
    address: chk.result.formattedAddress || trimmed,
    lat: chk.result.lat,
    lon: chk.result.lon,
  };
}

export function addressFieldsDisplayText(addr: AddressFields): string {
  return formatAddressFields(addr).trim();
}

/** True when a Places selection (or prior geocode) attached coordinates. */
export function addressFieldsVerified(addr: AddressFields): boolean {
  return (
    Boolean(addr.line1?.trim()) &&
    addr.lat != null &&
    addr.lon != null &&
    Number.isFinite(addr.lat) &&
    Number.isFinite(addr.lon)
  );
}

/**
 * Ensure alternate visit address can be routed — geocode when coords are missing.
 * Empty input is allowed (optional field).
 */
export async function resolveVerifiedAddressText(
  addr: AddressFields,
  opts?: ForwardGeocodeOpts & { minLevel?: 'street' | 'partial' | 'city' }
): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  const typed = addressFieldsDisplayText(addr);
  if (!typed) return { ok: true, text: '' };
  if (addressFieldsVerified(addr)) return { ok: true, text: typed };

  const chk = await validateAddress(typed, opts);
  if (!chk.ok) return { ok: false, message: chk.message };
  return { ok: true, text: chk.result.formattedAddress || typed };
}
