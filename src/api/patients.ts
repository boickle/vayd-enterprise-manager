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
function filenameFromContentDisposition(header: string | undefined): string | null {
  if (!header) return null;
  const utf = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (utf?.[1]) {
    try {
      return decodeURIComponent(utf[1].trim().replace(/^["']|["']$/g, ''));
    } catch {
      // keep looking
    }
  }
  const quoted = /filename="([^"]+)"/i.exec(header);
  if (quoted?.[1]?.trim()) return quoted[1].trim();
  const plain = /filename=([^;]+)/i.exec(header);
  return plain?.[1]?.trim().replace(/^["']|["']$/g, '') || null;
}

export function downloadBlobUrl(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** PDFs, scans, Word, or plain text, up to 25 MB — matches the API's accepted types. */
export const CHART_DOCUMENT_UPLOAD_ACCEPT =
  '.pdf,.png,.jpg,.jpeg,.gif,.webp,.heic,.tif,.tiff,.txt,.doc,.docx';

export const CHART_DOCUMENT_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Attach a file to a patient's chart. Defaults to the "Previous Medical Records"
 * document type so outside records read the same as EVET-imported ones.
 */
export async function uploadPatientChartDocument(
  patientId: number,
  file: File,
  opts?: {
    name?: string;
    description?: string;
    documentType?: 'previousRecords' | 'other';
    serviceDate?: string;
  },
): Promise<Record<string, unknown>> {
  const form = new FormData();
  form.append('file', file);
  if (opts?.name?.trim()) form.append('name', opts.name.trim());
  if (opts?.description?.trim()) form.append('description', opts.description.trim());
  if (opts?.documentType) form.append('documentType', opts.documentType);
  if (opts?.serviceDate?.trim()) form.append('serviceDate', opts.serviceDate.trim());
  const { data } = await http.post<Record<string, unknown>>(
    `/patients/${encodeURIComponent(String(patientId))}/chart-documents`,
    form,
  );
  return data;
}

export async function removePatientChartDocumentFromChart(
  patientId: number,
  documentId: number,
  reason: string,
): Promise<Record<string, unknown>> {
  const { data } = await http.post<Record<string, unknown>>(
    `/patients/${encodeURIComponent(String(patientId))}/chart-documents/${encodeURIComponent(String(documentId))}/remove-from-chart`,
    { reason },
  );
  return data;
}

export async function fetchPatientChartDocumentFile(
  patientId: number,
  documentId: number,
  fallbackFilename = 'document.pdf',
): Promise<{ objectUrl: string; filename: string; blob: Blob }> {
  const res = await http.get<Blob>(
    `/patients/${encodeURIComponent(String(patientId))}/chart-documents/${encodeURIComponent(String(documentId))}/file`,
    { responseType: 'blob' },
  );
  const data = res.data;
  const headerType = String(res.headers?.['content-type'] || '');
  if (
    data instanceof Blob &&
    (data.type.includes('json') || headerType.includes('json'))
  ) {
    const text = await data.text();
    let message = 'Could not open that PDF.';
    try {
      const parsed = JSON.parse(text) as { message?: unknown };
      if (typeof parsed.message === 'string' && parsed.message.trim()) {
        message = parsed.message;
      }
    } catch {
      // keep default
    }
    throw new Error(message);
  }
  const blob =
    data instanceof Blob
      ? data.type
        ? data
        : new Blob([data], { type: 'application/pdf' })
      : new Blob([data], { type: 'application/pdf' });
  const fromHeader = filenameFromContentDisposition(
    String(res.headers?.['content-disposition'] || ''),
  );
  return {
    blob,
    objectUrl: URL.createObjectURL(blob),
    filename: fromHeader || fallbackFilename,
  };
}

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

/**
 * Fields accepted by the Scout patient write endpoints. Anything not listed here is
 * eVet-owned chart data and is not editable in Scout.
 */
export type ScoutPatientWrite = {
  practiceId?: number;
  name?: string | null;
  dob?: string | null;
  speciesId?: number | null;
  breedId?: number | null;
  species?: string | null;
  breed?: string | null;
  color?: string | null;
  sex?: string | null;
  neuterStatus?: string | null;
  weight?: number | null;
  alerts?: string | null;
  primaryProviderId?: number | null;
  isActive?: boolean;
  clientIds?: number[];
};

/**
 * PATCH /patients/:id — partial update from Scout.
 *
 * Saving marks the patient as Scout-edited, which stops the eVet import from overwriting
 * these values until eVet reports a change newer than this edit.
 */
export async function patchPatient(
  id: number | string,
  body: ScoutPatientWrite,
): Promise<unknown> {
  const { data } = await http.patch(`/patients/${encodeURIComponent(String(id))}`, body);
  return data;
}

/**
 * POST /patients/scout — create a pet that exists only in Scout.
 * The API assigns pimsType VAYD and a UUID pimsId so no eVet import can claim it.
 */
export async function createPatientScout(
  body: ScoutPatientWrite & { practiceId: number; name: string },
): Promise<unknown> {
  const { data } = await http.post('/patients/scout', body);
  return data;
}

/** POST /patients/:id/deactivate — soft deactivate, keeps medical history. */
export async function deactivatePatient(id: number | string): Promise<unknown> {
  const { data } = await http.post(`/patients/${encodeURIComponent(String(id))}/deactivate`);
  return data;
}

/** POST /patients/:id/reactivate — undo a deactivation. */
export async function reactivatePatient(id: number | string): Promise<unknown> {
  const { data } = await http.post(`/patients/${encodeURIComponent(String(id))}/reactivate`);
  return data;
}

// Hard delete (DELETE /patients?ids=) is intentionally not wrapped — it would drop medical
// history. Use deactivatePatient instead.

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
