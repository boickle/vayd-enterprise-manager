// src/api/patients.ts
import axios from 'axios';
import { http } from './http';
import { searchClientsStaff } from './clientsStaff';
import type { MedicalRecordBundle } from '../utils/patientChartFromMedicalRecord';
import {
  clientRowMatchesNameTokens,
  dedupePatientSearchRows,
  rankPatientSearchResults,
  scorePatientSearchRow,
  tokenizePatientOwnerSearchQuery,
} from '../utils/patientOwnerNameSearch';
import type { ClientSearchRow } from './clientsStaff';
// import type { PatientDto } from '../';

// ---------------------------
// Basic lookups / search
// ---------------------------

// Get patient by PIMS id
export async function getPatientByPimsId(pimsId: string) {
  return http.get(`/patients/pims/${pimsId}`);
}

// Search patients (name, provider, practice, activeOnly)
export async function searchPatients(params?: {
  name?: string;
  primaryProviderId?: string | number;
  practiceId?: string | number;
  activeOnly?: boolean;
  clientId?: string | number;
}) {
  return http.get('/patients/search', { params });
}

/** Unwrap common `/patients/search` response shapes. */
export function extractPatientListFromSearchResponse(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.items)) return d.items;
    if (Array.isArray(d.patients)) return d.patients;
    if (Array.isArray(d.rows)) return d.rows;
  }
  return [];
}

/** One row from patient search (flexible backend fields). */
export type PatientSearchRow = {
  id: string | number;
  firstName?: string;
  lastName?: string;
  name?: string;
  [key: string]: unknown;
};

type PatientSearchFetchOpts = {
  practiceId?: string | number;
  activeOnly?: boolean;
  clientId?: string | number;
};

async function fetchPatientsSearchByName(
  name: string,
  opts?: PatientSearchFetchOpts
): Promise<PatientSearchRow[]> {
  const trimmed = name.trim();
  if (!trimmed && opts?.clientId == null) return [];
  const activeOnly = opts?.activeOnly !== false;
  const { data } = await http.get('/patients/search', {
    params: {
      ...(trimmed ? { name: trimmed } : {}),
      ...(opts?.clientId != null ? { clientId: String(opts.clientId) } : {}),
      ...(opts?.practiceId != null ? { practiceId: opts.practiceId } : {}),
      activeOnly,
    },
  });
  const raw = extractPatientListFromSearchResponse(data);
  return raw.filter((r) => r && typeof r === 'object').map((r) => r as PatientSearchRow);
}

async function fetchPatientsForClients(
  clients: ClientSearchRow[],
  petNameHint: string | null,
  opts?: PatientSearchFetchOpts,
  maxClients = 8
): Promise<PatientSearchRow[]> {
  const slice = clients.slice(0, maxClients);
  if (slice.length === 0) return [];
  const batches = await Promise.all(
    slice.map((client) =>
      fetchPatientsSearchByName(petNameHint?.trim() ?? '', {
        ...opts,
        clientId: client.id,
      })
    )
  );
  return batches.flat();
}

async function fetchPatientsViaClientNameSearch(
  clientQuery: string,
  tokens: string[],
  petNameHint: string | null,
  opts?: PatientSearchFetchOpts,
  maxClients = 8
): Promise<PatientSearchRow[]> {
  const includeInactive = opts?.activeOnly === false;
  const clients = await searchClientsStaff(clientQuery, { includeInactive });
  if (clients.length === 0) return [];

  const matched =
    tokens.length >= 2 ? clients.filter((client) => clientRowMatchesNameTokens(client, tokens)) : clients;
  const scoped = matched.length > 0 ? matched : clients.slice(0, maxClients);
  return fetchPatientsForClients(scoped, petNameHint, opts, maxClients);
}

function mergeRankPatientRows(rows: PatientSearchRow[], query: string): PatientSearchRow[] {
  return rankPatientSearchResults(dedupePatientSearchRows(rows), query);
}

/**
 * GET /patients/search — staff patient lookup.
 * Supports pet + client combinations (e.g. "nala wilson") and client person names (e.g. "elise smith").
 */
export async function searchPatientsStaff(
  name: string,
  opts?: { practiceId?: string | number; activeOnly?: boolean }
): Promise<PatientSearchRow[]> {
  const trimmed = name.trim();
  if (!trimmed) return [];
  const tokens = tokenizePatientOwnerSearchQuery(trimmed);

  const primary = await fetchPatientsSearchByName(trimmed, opts);

  if (tokens.length < 2) {
    return mergeRankPatientRows(primary, trimmed);
  }

  const clientPart = tokens.slice(1).join(' ');
  const petToken = tokens[0]!;

  const [petOnly, clientPartPatients, clientPersonPets] = await Promise.all([
    fetchPatientsSearchByName(petToken, opts),
    clientPart.toLowerCase() !== trimmed.toLowerCase()
      ? fetchPatientsSearchByName(clientPart, opts)
      : Promise.resolve([] as PatientSearchRow[]),
    fetchPatientsViaClientNameSearch(trimmed, tokens, null, opts),
  ]);

  let merged = dedupePatientSearchRows([
    ...primary,
    ...petOnly,
    ...clientPartPatients,
    ...clientPersonPets,
  ]);

  const ranked = mergeRankPatientRows(merged, trimmed);
  const topScore = ranked[0] ? scorePatientSearchRow(ranked[0], trimmed) : 0;

  if (topScore < 70) {
    const petClientPets = await fetchPatientsViaClientNameSearch(clientPart, tokens, petToken, opts);
    merged = dedupePatientSearchRows([...merged, ...petClientPets]);
    return mergeRankPatientRows(merged, trimmed);
  }

  return ranked;
}

/** GET /patients/:id — full patient for PIMS profile (may include nested client). */
export async function fetchPatientByIdStaff(patientId: string | number): Promise<unknown> {
  const { data } = await http.get(`/patients/${encodeURIComponent(String(patientId))}`);
  return data;
}

/** GET /patients/pims/:pimsId — patient by eVet/PIMS id (use when calendar rows only have patientPimsId). */
export async function fetchPatientByPimsIdStaff(pimsId: string | number): Promise<unknown> {
  const { data } = await http.get(`/patients/pims/${encodeURIComponent(String(pimsId))}`);
  return data;
}

function pickPatientLookupStr(v: unknown): string {
  if (v == null) return '';
  const s = String(v).trim();
  return s && s !== '0' ? s : '';
}

/** Resolve PIMS + internal ids from appointment / client patient rows. */
export function patientLookupIdsFromRow(p: {
  id?: number | string;
  pimsId?: string | number | null;
  [key: string]: unknown;
}): { pimsId: string; internalId: string } {
  const row = p as Record<string, unknown>;
  const pimsId =
    pickPatientLookupStr(p.pimsId) ||
    pickPatientLookupStr(row.patientPimsId) ||
    pickPatientLookupStr(row.pims_id);
  const internalId =
    pickPatientLookupStr(p.id) ||
    pickPatientLookupStr(row.patientId) ||
    pickPatientLookupStr(row.dbId);
  return { pimsId, internalId };
}

/** Load patient chart row using PIMS id first, then internal id, then PIMS fallback on `id`. */
export async function fetchPatientProfileForRow(p: {
  id?: number | string;
  pimsId?: string | number | null;
  [key: string]: unknown;
}): Promise<unknown | null> {
  const { pimsId, internalId } = patientLookupIdsFromRow(p);

  if (pimsId) {
    try {
      return await fetchPatientByPimsIdStaff(pimsId);
    } catch {
      /* try internal id below */
    }
  }
  if (internalId) {
    try {
      return await fetchPatientByIdStaff(internalId);
    } catch {
      /* id may be an eVet PIMS id without a separate pimsId field */
    }
    try {
      return await fetchPatientByPimsIdStaff(internalId);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * GET /patients/:id/medical-record — chart bundle (labs, exams, complaints, …).
 * Returns null when the backend responds 404 (no medical record row for this patient).
 */
export async function fetchPatientMedicalRecordStaff(
  patientId: string | number
): Promise<MedicalRecordBundle | null> {
  try {
    const { data } = await http.get<MedicalRecordBundle>(
      `/patients/${encodeURIComponent(String(patientId))}/medical-record`
    );
    return data ?? null;
  } catch (e: unknown) {
    if (axios.isAxiosError(e) && e.response?.status === 404) return null;
    throw e;
  }
}

// Get latest modified patient
export async function getLatestModifiedPatient() {
  return http.get('/patients/latest-modified');
}

// ---------------------------
// Create / Upsert / Save
// ---------------------------

// // Upsert one or many patients
// export async function upsertPatients(patients: PatientDto | PatientDto[]) {
//   return http.post('/patients/upsert', patients);
// }

// // Save (insert/update) one or many patients
// export async function savePatients(patients: PatientDto | PatientDto[]) {
//   return http.post('/patients', patients);
// }

/** PATCH /patients/:id — partial update (e.g. weight). */
export async function patchPatient(id: number | string, body: Record<string, unknown>): Promise<unknown> {
  const { data } = await http.patch(`/patients/${encodeURIComponent(String(id))}`, body);
  return data;
}

// ---------------------------
// Delete
// ---------------------------

// Delete by CSV list of ids
export async function deletePatients(ids: string[]) {
  return http.delete('/patients', { params: { ids: ids.join(',') } });
}

// ---------------------------
// Analytics
// ---------------------------

// Get zone percentages for a provider
export async function getZonePercentagesForProvider(
  providerId: string | number,
  options?: {
    practiceId?: string | number;
    includeUnzoned?: boolean;
    activeOnly?: boolean;
  }
) {
  return http.get(`/patients/provider/${providerId}/zone-percentages`, {
    params: options,
  });
}

// ---------------------------
// Pet Image Upload
// ---------------------------

// Upload a pet image
export async function uploadPetImage(
  patientId: string | number,
  file: File
): Promise<{ success: boolean; imageUrl: string; s3Key: string }> {
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await http.post(`/patients/${patientId}/image`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  
  return response.data;
}

// Get pet image URL (signed URL, valid for 1 hour)
export async function getPetImageUrl(
  patientId: string | number
): Promise<{ imageUrl: string }> {
  const response = await http.get(`/patients/${patientId}/image`);
  return response.data;
}
