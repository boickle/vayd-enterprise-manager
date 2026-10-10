/**
 * PIMS client + patient search (staff).
 *
 * Typeahead uses one parallel round: `/pims/search` (practice-scoped, limited),
 * `/clients/search`, and a single `/patients/search`. The multi-token patient
 * fan-out stays on the Patients list, not the navbar.
 */
import axios from 'axios';
import { http } from './http';
import { searchClientsStaff, type ClientSearchRow } from './clientsStaff';
import {
  extractPatientListFromSearchResponse,
  searchPatients,
  type PatientSearchRow,
} from './patients';
import {
  clientsForPatientSearchRow,
  patientPimsIdFromSearchRow,
  primaryClientLabelForPatientRow,
} from '../utils/pimsPatientSearchRow';

export type PimsPatientSearchHit = {
  id: number | string;
  name: string;
  clientId: number | string | null;
  clientLabel: string | null;
  patientPimsId: string;
  clientPimsId: string | null;
};

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function clientRowIdValid(c: ClientSearchRow): boolean {
  const id = c.id;
  return id != null && id !== 'undefined' && String(id).trim() !== '';
}

function patientDisplayName(row: PatientSearchRow): string {
  const r = row as Record<string, unknown>;
  const joined = [pickStr(row.firstName), pickStr(row.lastName)].filter(Boolean).join(' ').trim();
  return (pickStr(row.name) ?? pickStr(r.patientName) ?? joined) || 'Patient';
}

export function normalizePatientSearchRow(row: unknown): PimsPatientSearchHit | null {
  if (!row || typeof row !== 'object') return null;
  const o = row as PatientSearchRow;
  const idRaw = (o as Record<string, unknown>).id ?? (o as Record<string, unknown>).patientId;
  if (idRaw == null || (typeof idRaw !== 'string' && typeof idRaw !== 'number')) return null;
  const id = idRaw;
  const name = patientDisplayName(o);
  const owners = clientsForPatientSearchRow(o);
  const primary = owners[0];
  return {
    id,
    name,
    clientId: primary?.id ?? null,
    clientLabel: primaryClientLabelForPatientRow(o),
    patientPimsId: patientPimsIdFromSearchRow(o, id),
    clientPimsId: primary?.pimsId ?? null,
  };
}

/** PIMS id for eVet client deep link from a `/clients/search` row. */
export function clientPimsIdFromSearchRow(c: ClientSearchRow): string {
  const r = c as Record<string, unknown>;
  return pickStr(r.pimsId) ?? String(c.id);
}

export type PimsUnifiedSearchResult = {
  clients: ClientSearchRow[];
  patients: PimsPatientSearchHit[];
};

function extractClientListFromPimsSearch(data: unknown): ClientSearchRow[] {
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data)) return data as ClientSearchRow[];
  const o = data as Record<string, unknown>;
  if (Array.isArray(o.clients)) return o.clients as ClientSearchRow[];
  if (Array.isArray(o.items)) return o.items as ClientSearchRow[];
  const results = Array.isArray(o.results) ? o.results : [];
  return results.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const item = row as Record<string, unknown>;
    if (item.kind === 'client' && item.client && typeof item.client === 'object') {
      return [item.client as ClientSearchRow];
    }
    return [];
  });
}

function extractPatientListFromPimsSearch(data: unknown): unknown[] {
  if (!data || typeof data !== 'object') return [];
  const o = data as Record<string, unknown>;
  if (Array.isArray(o.patients)) return o.patients;
  const results = Array.isArray(o.results) ? o.results : [];
  return results.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const item = row as Record<string, unknown>;
    if (item.kind === 'patient' && item.patient && typeof item.patient === 'object') {
      return [item.patient];
    }
    return [];
  });
}

/** Practice-scoped unified search (optional extra hits when backend supports it). */
export async function searchPimsStaff(
  q: string,
  options?: { practiceId?: number; includeInactive?: boolean; limit?: number }
): Promise<PimsUnifiedSearchResult> {
  const trimmed = q.trim();
  if (!trimmed) return { clients: [], patients: [] };
  try {
    const { data } = await http.get('/pims/search', {
      params: {
        q: trimmed,
        ...(options?.practiceId != null ? { practiceId: options.practiceId } : {}),
        ...(options?.includeInactive ? { includeInactive: true } : {}),
        limit: options?.limit ?? 20,
      },
    });
    const clients = extractClientListFromPimsSearch(data).filter(clientRowIdValid);
    const patients = extractPatientListFromPimsSearch(data)
      .map((row) => normalizePatientSearchRow(row))
      .filter(Boolean) as PimsPatientSearchHit[];
    return { clients, patients };
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.status === 404) {
      return { clients: [], patients: [] };
    }
    throw e;
  }
}

function mergeClientRows(base: ClientSearchRow[], extra: ClientSearchRow[]): ClientSearchRow[] {
  const byId = new Map<string, ClientSearchRow>();
  for (const row of base) {
    if (clientRowIdValid(row)) byId.set(String(row.id), row);
  }
  for (const row of extra) {
    if (!clientRowIdValid(row)) continue;
    const id = String(row.id);
    if (!byId.has(id)) byId.set(id, row);
  }
  return [...byId.values()];
}

function mergePatientHits(
  base: PimsPatientSearchHit[],
  extra: PimsPatientSearchHit[]
): PimsPatientSearchHit[] {
  const byId = new Map<string, PimsPatientSearchHit>();
  for (const row of base) byId.set(String(row.id), row);
  for (const row of extra) {
    const id = String(row.id);
    if (!byId.has(id)) byId.set(id, row);
  }
  return [...byId.values()];
}

function clientRowMatchesTokens(row: ClientSearchRow, tokens: string[]): boolean {
  if (tokens.length < 2) return true;
  const first = String(row.firstName ?? '').toLowerCase();
  const last = String(row.lastName ?? '').toLowerCase();
  const full = `${first} ${last}`.trim();
  const a = tokens[0]!.toLowerCase();
  const b = tokens[tokens.length - 1]!.toLowerCase();
  return (
    (first.startsWith(a) && last.startsWith(b)) ||
    (first.startsWith(b) && last.startsWith(a)) ||
    full.startsWith(`${a} ${b}`) ||
    `${last} ${first}`.startsWith(`${a} ${b}`) ||
    full.includes(`${a} ${b}`)
  );
}

function patientHitMatchesTokens(hit: PimsPatientSearchHit, tokens: string[]): boolean {
  if (tokens.length < 2) return true;
  const a = tokens[0]!.toLowerCase();
  const b = tokens[tokens.length - 1]!.toLowerCase();
  const name = hit.name.toLowerCase();
  const owner = (hit.clientLabel ?? '').toLowerCase();
  const ownerParts = owner.split(/\s+/).filter(Boolean);
  const ownerLast = ownerParts[ownerParts.length - 1] ?? '';
  const ownerFirst = ownerParts[0] ?? '';
  if (name.startsWith(`${a} ${b}`) || name.includes(`${a} ${b}`)) return true;
  if (owner.startsWith(`${a} ${b}`) || owner.includes(`${a} ${b}`)) return true;
  if (name.startsWith(a) && (ownerLast.startsWith(b) || ownerFirst.startsWith(b) || owner.includes(b))) {
    return true;
  }
  if (ownerFirst.startsWith(a) && ownerLast.startsWith(b)) return true;
  return false;
}

async function fetchPatientsByName(
  name: string,
  practiceId: number | undefined,
  activeOnly: boolean
): Promise<PimsPatientSearchHit[]> {
  const rows = await searchPatients({
    name,
    ...(practiceId != null ? { practiceId } : {}),
    activeOnly,
  })
    .then((res) => extractPatientListFromSearchResponse(res.data) as PatientSearchRow[])
    .catch(() => [] as PatientSearchRow[]);
  return rows.map((row) => normalizePatientSearchRow(row)).filter(Boolean) as PimsPatientSearchHit[];
}

async function fetchPatientsForClientIds(
  clientIds: Array<string | number>,
  practiceId: number | undefined,
  activeOnly: boolean,
  petNameHint?: string
): Promise<PimsPatientSearchHit[]> {
  const batches = await Promise.all(
    clientIds.map((clientId) =>
      searchPatients({
        ...(petNameHint?.trim() ? { name: petNameHint.trim() } : {}),
        ...(practiceId != null ? { practiceId } : {}),
        activeOnly,
        clientId,
        limit: 20,
      })
        .then((res) => extractPatientListFromSearchResponse(res.data) as PatientSearchRow[])
        .catch(() => [] as PatientSearchRow[])
    )
  );
  return batches
    .flat()
    .map((row) => normalizePatientSearchRow(row))
    .filter(Boolean) as PimsPatientSearchHit[];
}

/**
 * Combined client + patient search for staff pickers and the navbar.
 * One parallel round: the practice `/pims/search` plus the two name endpoints.
 * Does not run the multi-token patient fan-out — that path can fire a dozen
 * unbounded `/patients/search` calls and made typeahead feel stalled.
 */
export async function searchPimsClientsAndPatients(
  q: string,
  options?: { practiceId?: number; activeOnly?: boolean }
): Promise<PimsUnifiedSearchResult> {
  const trimmed = q.trim();
  if (!trimmed) {
    return { clients: [], patients: [] };
  }
  const practiceId = options?.practiceId;
  const activeOnly = options?.activeOnly !== false;
  const tokens = trimmed.split(/\s+/).filter(Boolean);

  const [clientHits, patientHits, unified] = await Promise.all([
    searchClientsStaff(trimmed, { includeInactive: !activeOnly }).catch(() => [] as ClientSearchRow[]),
    fetchPatientsByName(trimmed, practiceId, activeOnly),
    practiceId != null
      ? searchPimsStaff(trimmed, {
          practiceId,
          includeInactive: !activeOnly,
          limit: 24,
        }).catch(() => ({ clients: [], patients: [] } as PimsUnifiedSearchResult))
      : Promise.resolve({ clients: [], patients: [] } as PimsUnifiedSearchResult),
  ]);

  let mergedClients = mergeClientRows(
    clientHits.filter(clientRowIdValid),
    unified.clients
  );
  if (tokens.length >= 2) {
    const tight = mergedClients.filter((row) => clientRowMatchesTokens(row, tokens));
    if (tight.length > 0) {
      mergedClients = tight;
    } else if (mergedClients.length === 0) {
      const firstTokenHits = await searchClientsStaff(tokens[0]!, {
        includeInactive: !activeOnly,
      }).catch(() => [] as ClientSearchRow[]);
      mergedClients = firstTokenHits.filter(
        (row) => clientRowIdValid(row) && clientRowMatchesTokens(row, tokens)
      );
    }
  }

  let mergedPatients = mergePatientHits(patientHits, unified.patients);
  if (tokens.length >= 2 && mergedPatients.some((hit) => patientHitMatchesTokens(hit, tokens))) {
    mergedPatients = mergedPatients.filter((hit) => patientHitMatchesTokens(hit, tokens));
  }

  if (mergedClients.length > 0 && (tokens.length >= 2 || mergedPatients.length === 0)) {
    const householdPets = await fetchPatientsForClientIds(
      mergedClients.slice(0, 3).map((row) => row.id),
      practiceId,
      activeOnly,
      tokens.length >= 2 ? undefined : tokens[0]
    );
    mergedPatients = mergePatientHits(mergedPatients, householdPets);
    if (tokens.length >= 2) {
      const tightPets = mergedPatients.filter((hit) => patientHitMatchesTokens(hit, tokens));
      if (tightPets.length > 0) mergedPatients = tightPets;
    }
  }

  return { clients: mergedClients, patients: mergedPatients };
}
