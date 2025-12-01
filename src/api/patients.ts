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
}) {
  return http.get('/patients/search', { params });
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
