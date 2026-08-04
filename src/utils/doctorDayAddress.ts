/**
 * Format street addresses for My Day / My Week / practice-day PDF rows.
 * Includes address line 2 (apartment / unit) when present on the row or nested client.
 */
import type { DoctorDayAppt } from '../api/appointments';

function pickTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t || undefined;
}

function pickFromRecord(
  obj: Record<string, unknown> | null | undefined,
  keys: readonly string[]
): string | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    const v = pickTrimmedString(obj[key]);
    if (v) return v;
  }
  return undefined;
}

function nestedClient(
  appt: DoctorDayAppt | Record<string, unknown>
): Record<string, unknown> | null {
  const client = (appt as { client?: unknown }).client;
  if (!client || typeof client !== 'object') return null;
  return client as Record<string, unknown>;
}

/** Prefer top-level doctor-day fields, then nested client (range enrichment). */
export function pickDoctorDayAddressPart(
  appt: DoctorDayAppt | Record<string, unknown> | null | undefined,
  keys: readonly string[]
): string | undefined {
  if (!appt || typeof appt !== 'object') return undefined;
  const row = appt as Record<string, unknown>;
  return pickFromRecord(row, keys) ?? pickFromRecord(nestedClient(row), keys);
}

export function formatDoctorDayApptAddress(
  a: DoctorDayAppt | Record<string, unknown> | null | undefined
): string {
  if (!a || typeof a !== 'object') return 'Address not available';

  const address1 = pickDoctorDayAddressPart(a, ['address1', 'address_1']);
  const address2 = pickDoctorDayAddressPart(a, ['address2', 'address_2']);
  const city = pickDoctorDayAddressPart(a, ['city']);
  const state = pickDoctorDayAddressPart(a, ['state']);
  const zip = pickDoctorDayAddressPart(a, ['zip', 'zipcode', 'zipCode']);

  const line = [address1, address2, [city, state].filter(Boolean).join(', '), zip]
    .filter(Boolean)
    .join(', ')
    .replace(/\s+,/g, ',');
  if (line) return line;

  const freeForm =
    pickDoctorDayAddressPart(a, ['address', 'addressStr', 'fullAddress']) ??
    pickFromRecord(nestedClient(a as Record<string, unknown>), [
      'address',
      'addressStr',
      'fullAddress',
    ]);
  if (freeForm) return freeForm;

  const lat = (a as { lat?: unknown }).lat;
  const lon = (a as { lon?: unknown }).lon;
  if (typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon)) {
    return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  }

  return 'Address not available';
}
