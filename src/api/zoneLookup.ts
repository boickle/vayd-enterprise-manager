import { formatDoctorSelectZoneLabel } from './employee';
import { http } from './http';

export type ResolvedZone = {
  id: number;
  name: string;
};

export const OUT_OF_SERVICE_AREA_DISPLAY_LABEL = 'OOSA — Out of service area';
export const OUT_OF_SERVICE_AREA_SHORT_LABEL = 'OOSA';

export type ClientZoneLookupResult = {
  zoneId: number | null;
  /** Full line for UI, e.g. `Zone 3W (Lewiston)` or {@link OUT_OF_SERVICE_AREA_DISPLAY_LABEL}. */
  displayLabel: string;
  /** Short code, e.g. `3W` or `OOSA`. */
  shortLabel: string | null;
  /** True when address is outside service polygons (legacy name — prefer {@link isOutOfServiceArea}). */
  usedNearestZone: boolean;
  isOutOfServiceArea: boolean;
};

export function clientZoneLookupIsOutOfServiceArea(
  result: ClientZoneLookupResult | null | undefined
): boolean {
  return result?.isOutOfServiceArea === true;
}

function formatClientZoneDisplayLabel(zoneName: string): string {
  const raw = zoneName.trim();
  return raw.toLowerCase().startsWith('zone ') ? raw : `Zone ${raw}`;
}

function outOfServiceAreaLookupResult(): ClientZoneLookupResult {
  return {
    zoneId: null,
    displayLabel: OUT_OF_SERVICE_AREA_DISPLAY_LABEL,
    shortLabel: OUT_OF_SERVICE_AREA_SHORT_LABEL,
    usedNearestZone: true,
    isOutOfServiceArea: true,
  };
}

/** In-polygon zone only — no nearest-zone fallback. */
export async function resolveInPolygonZoneForAddress(
  address: string
): Promise<ResolvedZone | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;
  return findZoneByAddress(trimmed);
}

/** Quick zone lookup for a street address — in-polygon only; OOSA when outside service area. */
export async function lookupClientZoneForAddress(
  address: string
): Promise<ClientZoneLookupResult | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;

  const inPolygon = await resolveInPolygonZoneForAddress(trimmed);
  if (!inPolygon) return outOfServiceAreaLookupResult();

  return {
    zoneId: inPolygon.id,
    displayLabel: formatClientZoneDisplayLabel(inPolygon.name),
    shortLabel: formatDoctorSelectZoneLabel(inPolygon.name),
    usedNearestZone: false,
    isOutOfServiceArea: false,
  };
}

/** Miles to search for the nearest zone when the address is outside all polygons. */
export const NEAREST_ZONE_LOOKUP_BUFFER_MILES = 500;

/**
 * Resolve a zone for an address via `GET /public/appointments/find-zone-by-address`.
 * With `bufferMiles`, returns the nearest zone within that distance when outside polygons.
 */
export async function findZoneByAddress(
  address: string,
  opts?: { bufferMiles?: number }
): Promise<ResolvedZone | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;

  const params: Record<string, string | number> = { address: trimmed };
  if (opts?.bufferMiles != null && Number.isFinite(opts.bufferMiles) && opts.bufferMiles > 0) {
    params.buffer = opts.bufferMiles;
  }

  try {
    const { data } = await http.get<unknown>('/public/appointments/find-zone-by-address', {
      params,
    });
    const row = data as { id?: unknown; name?: unknown };
    const id = Number(row?.id);
    if (!Number.isFinite(id) || id <= 0) return null;
    const name = row?.name != null ? String(row.name).trim() : '';
    return { id, name };
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    if (status === 404) return null;
    throw e;
  }
}

/**
 * In-polygon zone first; for out-of-area addresses, nearest zone within
 * {@link NEAREST_ZONE_LOOKUP_BUFFER_MILES}.
 *
 * Prefer {@link resolveInPolygonZoneForAddress} / {@link lookupClientZoneForAddress} for routing UI.
 */
export async function resolveZoneForVeterinarianLookup(
  address: string
): Promise<{ zone: ResolvedZone; usedNearestZone: boolean } | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;

  const inPolygon = await findZoneByAddress(trimmed);
  if (inPolygon) return { zone: inPolygon, usedNearestZone: false };

  const nearest = await findZoneByAddress(trimmed, {
    bufferMiles: NEAREST_ZONE_LOOKUP_BUFFER_MILES,
  });
  if (!nearest) return null;

  return { zone: nearest, usedNearestZone: true };
}
