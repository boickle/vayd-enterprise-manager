// src/api/routing.ts
import { http } from './http';

export type Depot = { lat: number; lon: number };

export type EtaHouseholdInput = {
  key?: string;
  lat: number;
  lon: number;
  startIso?: string | null;
  endIso?: string | null;
};

export type EtaRequest = {
  doctorId: string;
  date: string; // 'YYYY-MM-DD'
  households: EtaHouseholdInput[];
  startDepot?: Depot; // optional start depot
  endDepot?: Depot; // optional end depot  ← (fix comment)
  useTraffic?: boolean;
};

// ---- server response shape (now includes back-to-depot + etaByKey) ----
export type EtaResponse = {
  etaIso: string[];
  keys?: (string | undefined)[];
  driveSeconds?: number[]; // [toFirst, ...between, back]
  backToDepotSec?: number | null;
  backToDepotIso?: string | null;
  etaByKey?: Record<string, string>; // optional (server-built)
  workStartIso?: string;
};

export type EtaResult = {
  etaIso: string[];
  keys?: (string | undefined)[];
  etaByKey: Record<string, string>;
  driveSeconds?: number[];
  backToDepotSec?: number | null;
  backToDepotIso?: string | null;
  workStartIso?: string;
};

export async function fetchEtas(payload: EtaRequest): Promise<EtaResult> {
  const res = await http.post('/routing/eta', { body: JSON.stringify(payload) });
  const data = (res && (res.data ?? res)) as EtaResponse;

  const etaIso = Array.isArray(data?.etaIso) ? data.etaIso : [];
  const keys = Array.isArray(data?.keys) ? data.keys : undefined;

  // Prefer server-provided etaByKey; otherwise build it from the payload order
  const etaByKey: Record<string, string> = data?.etaByKey ?? {};
  if (Object.keys(etaByKey).length === 0) {
    payload.households.forEach((h, idx) => {
      const iso = etaIso[idx];
      const k = h.key ?? keys?.[idx];
      if (k && iso) etaByKey[k] = iso;
    });
  }

  return {
    etaIso,
    keys,
    etaByKey,
    driveSeconds: data?.driveSeconds,
    backToDepotSec: data?.backToDepotSec ?? null,
    backToDepotIso: data?.backToDepotIso ?? null,
    workStartIso: data?.workStartIso,
  };
}
