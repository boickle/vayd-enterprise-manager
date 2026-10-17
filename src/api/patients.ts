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
  limit?: number;
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
      limit: 40,
    },
  });
  const raw = extractPatientListFromSearchResponse(data);
  return raw.filter((r) => r && typeof r === 'object').map((r) => r as PatientSearchRow);
}

async function fetchPatientsForClients(
  clients: ClientSearchRow[],
  petNameHint: string | null,
  opts?: PatientSearchFetchOpts,
  maxClients = 3
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
  maxClients = 3
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

export type PortalSnapshotPhoto = {
  id: number;
  url: string;
  isPrimary: boolean;
  created: string | null;
};

export type PortalSnapshot = {
  id: number;
  name: string;
  nickname: string | null;
  favoriteThing: string | null;
  superpower: string | null;
  nemesis: string | null;
  funFact: string | null;
  keyToMyHeart: string | null;
  socialMediaConsent: boolean;
  socialMediaConsentAt: string | null;
  portalProfileUpdatedAt: string | null;
  species: string | null;
  breed: string | null;
  sex: string | null;
  dob: string | null;
  isActive: boolean;
  hasImage: boolean;
  filledCount: number;
  provider: { id: number; name: string } | null;
  photos: PortalSnapshotPhoto[];
  loves: { count: number; mine: boolean };
};

/** Number of owner-answered "about me" questions (nickname + five prompts). */
export const PORTAL_SNAPSHOT_FACT_TOTAL = 6;

/** Staff browse of pets with portal answers or photos. Inactive pets are never included. */
export async function fetchPortalSnapshots(opts: {
  practiceId: number;
  providerId?: number | null;
  q?: string;
  fill?: 'any' | 'photos' | 'started' | 'mostly' | 'complete';
  consentOnly?: boolean;
  lovedOnly?: boolean;
  species?: string;
  sort?: SnapshotSort;
  page?: number;
  pageSize?: number;
}): Promise<SnapshotPage<PortalSnapshot>> {
  const { data } = await http.get('/patients/portal-snapshots', {
    params: {
      practiceId: opts.practiceId,
      ...(opts.providerId ? { providerId: opts.providerId } : {}),
      ...(opts.q?.trim() ? { q: opts.q.trim() } : {}),
      ...(opts.fill && opts.fill !== 'any' ? { fill: opts.fill } : {}),
      ...(opts.consentOnly ? { consentOnly: '1' } : {}),
      ...(opts.lovedOnly ? { lovedOnly: '1' } : {}),
      ...(opts.species ? { species: opts.species } : {}),
      ...(opts.sort === 'loves' ? { sort: 'loves' } : {}),
      page: opts.page ?? 1,
      ...(opts.pageSize ? { pageSize: opts.pageSize } : {}),
    },
  });
  return normalizeSnapshotPage<PortalSnapshot>(data);
}

export type SnapshotSort = 'recent' | 'loves';

export type SnapshotPage<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  speciesOptions: Array<{ name: string; count: number }>;
};

export function normalizeSnapshotPage<T extends { loves: { count: number; mine: boolean } }>(
  data: any,
): SnapshotPage<T> {
  const items: T[] = (Array.isArray(data?.items) ? data.items : []).map((row: any) => ({
    ...row,
    loves: {
      count: Number(row?.loves?.count) || 0,
      mine: row?.loves?.mine === true,
    },
  }));
  return {
    items,
    total: Number(data?.total) || items.length,
    page: Number(data?.page) || 1,
    pageSize: Number(data?.pageSize) || items.length || 30,
    pageCount: Math.max(1, Number(data?.pageCount) || 1),
    speciesOptions: Array.isArray(data?.speciesOptions)
      ? data.speciesOptions
          .filter((s: any) => s && s.name)
          .map((s: any) => ({ name: String(s.name), count: Number(s.count) || 0 }))
      : [],
  };
}

/** Staff: love / un-love a pet's snapshot. */
export async function togglePatientLove(
  patientId: number,
  loved?: boolean,
): Promise<{ count: number; mine: boolean }> {
  const { data } = await http.post(
    `/patients/${patientId}/love`,
    typeof loved === 'boolean' ? { loved } : {},
  );
  const loves = data?.loves ?? data ?? {};
  return { count: Number(loves.count) || 0, mine: loves.mine === true };
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

export type PatientChartDocumentRow = {
  id: number;
  name: string;
  description?: string | null;
  contentType: string;
  extension: string;
  hasFile?: boolean;
  removedAt?: string | null;
};

export async function fetchPatientChartDocuments(
  patientId: number,
): Promise<PatientChartDocumentRow[]> {
  const { data } = await http.get<PatientChartDocumentRow[]>(
    `/patients/${encodeURIComponent(String(patientId))}/chart-documents`,
  );
  return Array.isArray(data) ? data : [];
}

export async function renamePatientChartDocument(
  patientId: number,
  documentId: number,
  body: { name?: string; description?: string | null },
): Promise<PatientChartDocumentRow> {
  const { data } = await http.patch<PatientChartDocumentRow>(
    `/patients/${encodeURIComponent(String(patientId))}/chart-documents/${encodeURIComponent(String(documentId))}`,
    body,
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

const CHART_FILE_TYPES_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** Imported files are often stored as octet-stream, so trust the bytes over the label. */
async function sniffChartFileType(blob: Blob): Promise<string | null> {
  const b = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  return null;
}

export async function fetchPatientChartDocumentFile(
  patientId: number,
  documentId: number,
  fallbackFilename = 'document.pdf',
): Promise<{ objectUrl: string; filename: string; blob: Blob }> {
  const res = await http
    .get<Blob>(
      `/patients/${encodeURIComponent(String(patientId))}/chart-documents/${encodeURIComponent(String(documentId))}/file`,
      { responseType: 'blob' },
    )
    .catch(async (err: { response?: { data?: unknown } }) => {
      const body = err?.response?.data;
      if (body instanceof Blob) {
        const message = await body
          .text()
          .then((t) => (JSON.parse(t) as { message?: unknown }).message)
          .catch(() => null);
        if (typeof message === 'string' && message.trim()) throw new Error(message);
      }
      throw err;
    });
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
  const fromHeader = filenameFromContentDisposition(
    String(res.headers?.['content-disposition'] || ''),
  );
  const ext = (fromHeader || fallbackFilename).split('.').pop()?.toLowerCase() ?? '';
  const raw = data instanceof Blob ? data : new Blob([data]);
  const declared = raw.type && raw.type !== 'application/octet-stream' ? raw.type : '';
  const type =
    (await sniffChartFileType(raw)) ||
    declared ||
    CHART_FILE_TYPES_BY_EXT[ext] ||
    'application/pdf';
  const blob = raw.type === type ? raw : new Blob([raw], { type });
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

/** Vaccine doses removed from the record — for the chart's "Show removed" view only. */
export async function fetchRemovedVaccinationLogs(
  patientId: string | number
): Promise<Record<string, unknown>[]> {
  const { data } = await http.get<Record<string, unknown>[]>(
    `/patients/${encodeURIComponent(String(patientId))}/vaccination-logs`,
    { params: { includeRemoved: 1 } }
  );
  return (Array.isArray(data) ? data : []).filter((row) => row && row.removal);
}

// Get latest modified patient
export async function getLatestModifiedPatient() {
  return http.get('/patients/latest-modified');
}

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
  /** Required when isActive is false. */
  inactivationReason?: PatientInactivationReason;
  /** When setting isActive false after euthanasia — who performed it. */
  inactivatedByEmployeeId?: number | null;
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

export type PatientInactivationReason =
  | 'euthanized'
  | 'passed_away'
  | 'rehomed'
  | 'moved_or_changed_vets'
  | 'duplicate_record'
  | 'other';

export const INACTIVATION_REASON_OPTIONS: Array<{
  value: PatientInactivationReason;
  label: string;
}> = [
  { value: 'euthanized', label: 'Euthanized' },
  { value: 'passed_away', label: 'Passed away' },
  { value: 'rehomed', label: 'Rehomed' },
  { value: 'moved_or_changed_vets', label: 'Moved or changed vets' },
  { value: 'duplicate_record', label: 'Duplicate record' },
  { value: 'other', label: 'Other' },
];

/** POST /patients/:id/deactivate — soft deactivate, keeps medical history. Reason is required. */
export async function deactivatePatient(
  id: number | string,
  reason: PatientInactivationReason,
): Promise<unknown> {
  const { data } = await http.post(`/patients/${encodeURIComponent(String(id))}/deactivate`, {
    reason,
  });
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
// Pet Image Upload / Gallery
// ---------------------------

export const PATIENT_PHOTO_GALLERY_MAX = 12;

export type PatientGalleryImage = {
  id: number;
  url: string;
  isPrimary: boolean;
  sortOrder: number;
  created?: string | null;
};

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

export async function listPatientImages(
  patientId: string | number,
): Promise<PatientGalleryImage[]> {
  const { data } = await http.get<PatientGalleryImage[]>(
    `/patients/${encodeURIComponent(patientId)}/images`,
  );
  return Array.isArray(data) ? data : [];
}

export async function uploadPatientGalleryImage(
  patientId: string | number,
  file: File,
): Promise<{
  success: boolean;
  imageUrl: string;
  s3Key: string;
  image: PatientGalleryImage;
  images: PatientGalleryImage[];
}> {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await http.post(
    `/patients/${encodeURIComponent(patientId)}/images`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return data;
}

export async function setPatientImagePrimary(
  patientId: string | number,
  imageId: number,
): Promise<{ success: boolean; imageUrl: string; images: PatientGalleryImage[] }> {
  const { data } = await http.post(
    `/patients/${encodeURIComponent(patientId)}/images/${encodeURIComponent(imageId)}/primary`,
  );
  return data;
}

export async function deletePatientGalleryImage(
  patientId: string | number,
  imageId: number,
): Promise<{ success: boolean; imageUrl: string; images: PatientGalleryImage[] }> {
  const { data } = await http.delete(
    `/patients/${encodeURIComponent(patientId)}/images/${encodeURIComponent(imageId)}`,
  );
  return data;
}

/** Staff: email the client that a new pet photo was uploaded (active pets only). */
export async function notifyPatientPhotoUpload(
  patientId: string | number,
): Promise<{ sent: boolean; reason?: string; message?: string }> {
  const { data } = await http.post(
    `/patients/${encodeURIComponent(patientId)}/images/notify-upload`,
  );
  return data;
}

/** @deprecated Prefer gallery modal; kept for callers that only need the primary proxy URL. */
export async function getPetImageUrl(
  patientId: string | number
): Promise<{ imageUrl: string }> {
  const response = await http.get(`/patients/${patientId}/image`);
  return response.data;
}
