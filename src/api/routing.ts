// src/api/routing.ts
import { http } from './http';

// Reuse the same Depot shape you use elsewhere
export type Depot = { lat: number; lon: number };

// Matches what the controller/service expect
export type EtaHouseholdInput = {
  key?: string; // recommended (stable) identifier you use in the UI
  lat: number;
  lon: number;
  startIso?: string | null; // scheduled start (optional)
  endIso?: string | null; // scheduled end used as "finish" for next leg
};

export type EtaRequest = {
  doctorId: string; // PIMS/doctor id
  date: string; // 'YYYY-MM-DD' in doctor's TZ
  households: EtaHouseholdInput[];
  startDepot?: Depot; // optional start depot
  useTraffic?: boolean; // defaults server-side if omitted
};

// What the backend returns
export type EtaResponse = {
  etaIso: string[]; // same order as households[] sent
  keys?: (string | undefined)[]; // optional echo from server
};

// Convenience return type from fetchEtas
export type EtaResult = EtaResponse & {
  /** Map of ETA by household key (only set when a key is present). */
  etaByKey: Record<string, string>;
};

/**
 * Post to /routing/eta using the required { body: JSON.stringify(payload) } shape.
 * Returns both the raw arrays and a convenient etaByKey map.
 */
export async function fetchEtas(payload: EtaRequest): Promise<EtaResult> {
  const res = await http.post('/routing/eta', { body: JSON.stringify(payload) });

  // Some http helpers put data on res.data; others return JSON directly.
  const data = (res && (res.data ?? res)) as EtaResponse | undefined;

  const etaIso = Array.isArray(data?.etaIso) ? data!.etaIso : [];
  const keys = Array.isArray(data?.keys) ? data!.keys : undefined;

  const etaByKey: Record<string, string> = {};
  payload.households.forEach((h, idx) => {
    const iso = etaIso[idx];
    const k = h.key ?? keys?.[idx];
    if (k && iso) etaByKey[k] = iso;
  });

  return { etaIso, keys, etaByKey };
}

/* -------------------------------
   Optional helpers for the UI
-------------------------------- */

/** Same keying method you use in the UI for household cards. */
export function keyFor(lat: number, lon: number, decimals = 6): string {
  const m = Math.pow(10, decimals);
  const rl = Math.round(lat * m) / m;
  const ro = Math.round(lon * m) / m;
  return `${rl},${ro}`;
}

/**
 * Merge ETAs into your DoctorDayAppt list by matching the household key.
 * This assumes your app builds keys with keyFor(lat, lon, 6) for each address.
 *
 * Example:
 *   const { etaByKey } = await fetchEtas(payload);
 *   const withEtas = mergeEtasIntoAppointments(appointments, etaByKey);
 */
export function mergeEtasIntoAppointments<
  T extends { lat: number; lon: number; expectedArrivalIso?: string },
>(appointments: T[], etaByKey: Record<string, string>, decimals = 6): T[] {
  return appointments.map((a) => {
    const k = keyFor(a.lat, a.lon, decimals);
    const eta = etaByKey[k];
    return eta ? { ...a, expectedArrivalIso: eta } : a;
  });
}
