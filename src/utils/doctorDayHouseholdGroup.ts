import type { DoctorDayAppt } from '../api/appointments';

const str = (o: unknown, k: string) =>
  typeof (o as Record<string, unknown>)?.[k] === 'string'
    ? ((o as Record<string, unknown>)[k] as string)
    : undefined;

/** ~111 m — absorbs minor geocode differences between pets at the same address. */
const HOUSEHOLD_GEO_GROUP_DECIMALS = 3;

function normalizeAddressString(s?: string | null): string | null {
  if (!s) return null;
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/[,\s]+$/g, '').trim() || null;
}

function roundedGeoGroupKey(lat: number, lon: number): string {
  const m = Math.pow(10, HOUSEHOLD_GEO_GROUP_DECIMALS);
  return `${Math.round(lat * m) / m}_${Math.round(lon * m) / m}`;
}

/**
 * Same client at same location = one stop; different clients at same address = separate stops.
 * Alternate stops group by normalized alternate address so multi-pet visits stay one household
 * even when geocoding varies per appointment.
 */
export function householdGroupKey(
  a: DoctorDayAppt,
  lat: number,
  lon: number,
  addrKey: string | null,
  idPart: string,
  hasGeo: boolean
): string {
  const clientId = (a as any)?.clientPimsId ?? (a as any)?.clientId;
  const clientPart = clientId != null ? String(clientId) : (str(a, 'clientName') ?? '').trim();
  if (hasGeo) {
    const alt = normalizeAddressString((a as any)?.alternateAddressText);
    if (alt && (a as any)?.isAlternateStop) return `alt:${alt}_${clientPart}`;
    return `${roundedGeoGroupKey(lat, lon)}_${clientPart}`;
  }
  if (addrKey) return `addr:${addrKey}_${clientPart}`;
  return `noloc:${idPart}`;
}
