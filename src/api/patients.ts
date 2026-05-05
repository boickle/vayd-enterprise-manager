// src/api/patients.ts
import { http } from './http';
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

/** GET /patients/search — returns normalized rows for PIMS tables. */
export async function searchPatientsStaff(
  name: string,
  opts?: { practiceId?: string | number; activeOnly?: boolean }
): Promise<PatientSearchRow[]> {
  const trimmed = name.trim();
  if (!trimmed) return [];
  const activeOnly = opts?.activeOnly !== false;
  const { data } = await http.get('/patients/search', {
    params: {
      name: trimmed,
      ...(opts?.practiceId != null ? { practiceId: opts.practiceId } : {}),
      activeOnly,
    },
  });
  const raw = extractPatientListFromSearchResponse(data);
  return raw.filter((r) => r && typeof r === 'object').map((r) => r as PatientSearchRow);
}

/** GET /patients/:id — full patient for PIMS profile (may include nested client). */
export async function fetchPatientByIdStaff(patientId: string | number): Promise<unknown> {
  const { data } = await http.get(`/patients/${encodeURIComponent(String(patientId))}`);
  return data;
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
