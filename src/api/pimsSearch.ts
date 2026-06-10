/**
 * PIMS client + patient search (staff).
 *
 * Patient matches (including by owner/client name) come from `/patients/search`
 * — same path as the PIMS Patients list. Client name matches use `/clients/search`.
 *
 * Optional GET /pims/search may add extra hits when deployed; it never replaces
 * the patient/client search endpoints.
 */
import axios from 'axios';
import { http } from './http';
import { searchClientsStaff, type ClientSearchRow } from './clientsStaff';
import { searchPatientsStaff, type PatientSearchRow } from './patients';
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
  const rows = o.clients ?? o.items ?? o.results;
  return Array.isArray(rows) ? (rows as ClientSearchRow[]) : [];
}

function extractPatientListFromPimsSearch(data: unknown): unknown[] {
  if (!data || typeof data !== 'object') return [];
  const o = data as Record<string, unknown>;
  const rows = o.patients;
  return Array.isArray(rows) ? rows : [];
}

/** Practice-scoped unified search (optional extra hits when backend supports it). */
export async function searchPimsStaff(
  q: string,
  options?: { practiceId?: number; includeInactive?: boolean }
): Promise<PimsUnifiedSearchResult> {
  const trimmed = q.trim();
  if (!trimmed) return { clients: [], patients: [] };
  try {
    const { data } = await http.get('/pims/search', {
      params: {
        q: trimmed,
        ...(options?.practiceId != null ? { practiceId: options.practiceId } : {}),
        ...(options?.includeInactive ? { includeInactive: true } : {}),
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

/**
 * Combined client + patient search for staff pickers.
 * Always uses `/patients/search` (same as PIMS Patients) and `/clients/search`.
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

  const patientOpts = {
    ...(practiceId != null ? { practiceId } : {}),
    activeOnly,
  };

  const [clients, patientRows] = await Promise.all([
    searchClientsStaff(trimmed, { includeInactive: !activeOnly }),
    searchPatientsStaff(trimmed, patientOpts),
  ]);

  let mergedClients = clients.filter(clientRowIdValid);
  let mergedPatients = patientRows
    .map((row) => normalizePatientSearchRow(row))
    .filter(Boolean) as PimsPatientSearchHit[];

  if (practiceId != null) {
    try {
      const unified = await searchPimsStaff(trimmed, {
        practiceId,
        includeInactive: !activeOnly,
      });
      mergedClients = mergeClientRows(mergedClients, unified.clients);
      mergedPatients = mergePatientHits(mergedPatients, unified.patients);
    } catch {
      /* optional unified search */
    }
  }

  return { clients: mergedClients, patients: mergedPatients };
}
