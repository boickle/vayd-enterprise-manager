import { formatDoctorSelectZoneLabel } from './employee';
import { http } from './http';

export type ResolvedZone = {
  id: number;
  name: string;
};

export type ClientZoneLookupResult = {
  zoneId: number;
  /** Full line for UI, e.g. `Zone 3W (Lewiston)`. */
  displayLabel: string;
  /** Short code, e.g. `3W`. */
  shortLabel: string | null;
  usedNearestZone: boolean;
};

function formatClientZoneDisplayLabel(zoneName: string, usedNearestZone: boolean): string {
  const raw = zoneName.trim();
  const line = raw.toLowerCase().startsWith('zone ') ? raw : `Zone ${raw}`;
  return usedNearestZone ? `${line} (nearest)` : line;
}

/** Quick zone lookup for a street address — one lightweight GET (plus nearest-zone fallback). */
export async function lookupClientZoneForAddress(
  address: string
): Promise<ClientZoneLookupResult | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;

  const resolved = await resolveZoneForVeterinarianLookup(trimmed);
  if (!resolved) return null;

  return {
    zoneId: resolved.zone.id,
    displayLabel: formatClientZoneDisplayLabel(resolved.zone.name, resolved.usedNearestZone),
    shortLabel: formatDoctorSelectZoneLabel(resolved.zone.name),
    usedNearestZone: resolved.usedNearestZone,
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
