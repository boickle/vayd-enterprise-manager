import type { AddressFields } from '../components/AddressAutocomplete';
import { EMPTY_ADDRESS_FIELDS } from './verifiedAddress';

export type ClientVisitAddressKey = 'home' | 'extra' | 'other';

export type ClientVisitAddressOption = {
  key: Exclude<ClientVisitAddressKey, 'other'>;
  label: string;
  line: string;
  fields: AddressFields;
};

function pick(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
}

export function addressLinesFromParts(parts: {
  address1?: unknown;
  address2?: unknown;
  city?: unknown;
  state?: unknown;
  zip?: unknown;
}): string[] {
  const street = [pick(parts.address1), pick(parts.address2)].filter(Boolean);
  const locality = [
    [pick(parts.city), pick(parts.state)].filter(Boolean).join(', '),
    pick(parts.zip),
  ]
    .filter(Boolean)
    .join(' ');
  return [...street, locality].filter(Boolean) as string[];
}

export function formatAddressLine(parts: {
  address1?: unknown;
  address2?: unknown;
  city?: unknown;
  state?: unknown;
  zip?: unknown;
}): string {
  return addressLinesFromParts(parts).join(', ');
}

export function fieldsFromParts(parts: {
  address1?: unknown;
  address2?: unknown;
  city?: unknown;
  state?: unknown;
  zip?: unknown;
  lat?: unknown;
  lon?: unknown;
}): AddressFields {
  const lat = num(parts.lat);
  const lon = num(parts.lon);
  return {
    ...EMPTY_ADDRESS_FIELDS,
    line1: pick(parts.address1) ?? '',
    line2: pick(parts.address2) ?? undefined,
    city: pick(parts.city) ?? '',
    state: pick(parts.state) ?? '',
    zip: pick(parts.zip) ?? '',
    ...(lat != null ? { lat } : {}),
    ...(lon != null ? { lon } : {}),
  };
}

export function clientHasExtraAddress(c: Record<string, unknown> | null | undefined): boolean {
  return Boolean(pick(c?.extraAddress1));
}

export function homeAddressParts(c: Record<string, unknown>) {
  return {
    address1: c.address1 ?? c.address_1,
    address2: c.address2 ?? c.address_2,
    city: c.city,
    state: c.state,
    zip: c.zipcode ?? c.zip ?? c.zipCode,
    lat: c.lat,
    lon: c.lon,
  };
}

export function extraAddressParts(c: Record<string, unknown>) {
  return {
    address1: c.extraAddress1,
    address2: c.extraAddress2,
    city: c.extraCity,
    state: c.extraState,
    zip: c.extraZipcode,
    lat: c.extraLat,
    lon: c.extraLon,
  };
}

export function extraAddressLabel(c: Record<string, unknown>): string {
  return pick(c.extraAddressLabel) ?? 'Other address';
}

export function visitAddressOptions(c: Record<string, unknown> | null | undefined): ClientVisitAddressOption[] {
  if (!c) return [];
  const home = homeAddressParts(c);
  const options: ClientVisitAddressOption[] = [];
  const homeLine = formatAddressLine(home);
  if (homeLine) {
    options.push({
      key: 'home',
      label: 'Home (where we show up)',
      line: homeLine,
      fields: fieldsFromParts(home),
    });
  }
  if (clientHasExtraAddress(c)) {
    const extra = extraAddressParts(c);
    options.push({
      key: 'extra',
      label: extraAddressLabel(c),
      line: formatAddressLine(extra),
      fields: fieldsFromParts(extra),
    });
  }
  return options;
}

export function mailingSameAsService(c: Record<string, unknown> | null | undefined): boolean {
  if (!c) return true;
  if (c.mailingSameAsService === false) return false;
  return !pick(c.mailingAddress1);
}

export function mailingAddressFields(c: Record<string, unknown>): AddressFields {
  if (mailingSameAsService(c)) return fieldsFromParts(homeAddressParts(c));
  return fieldsFromParts({
    address1: c.mailingAddress1,
    address2: c.mailingAddress2,
    city: c.mailingCity,
    state: c.mailingState,
    zip: c.mailingZipcode,
  });
}
