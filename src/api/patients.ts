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

// ---------------------------
// Medical Record
// ---------------------------

export type MedicalRecordPatient = {
  id: number;
  created?: string;
  updated?: string;
  externalCreated?: string;
  externalUpdated?: string;
  isActive?: boolean;
  pimsId?: string;
  pimsType?: string;
  isDeleted?: boolean;
  dob?: string;
  name: string;
  breed?: string;
  color?: string;
  weight?: string;
  species?: string;
  sex?: string;
  alerts?: string | null;
  imageUrl?: string;
};

export type MedicalRecordPractice = {
  id: number;
  name?: string;
  address1?: string;
  address2?: string | null;
  city?: string;
  state?: string;
  zipcode?: string;
  phone1?: string;
  phone2?: string;
  hoursOfOperation?: Record<string, { open: string; close: string } | null>;
  [key: string]: unknown;
};

export type MedicalRecordEntity = {
  id: number;
  pimsId?: string;
  pimsType?: string;
  [key: string]: unknown;
};

export type LabOrderOrder = {
  id: number;
  pimsId?: string;
  submittedDate?: string;
  orderStatusValue?: number;
  labOrderType?: string;
  externalId?: string | null;
  isCritical?: boolean;
  notes?: string;
  [key: string]: unknown;
};

export type LabOrderResult = {
  id: number;
  reportDate?: string;
  externalData?: string | null; // XML string for IDEXX etc.
  comments?: string | null;
  viewed?: boolean;
  viewedDate?: string;
  [key: string]: unknown;
};

export type LabOrderEntry = {
  order: LabOrderOrder;
  result?: LabOrderResult | null;
};

export type MedicalRecordMedication = {
  id: number;
  dateOfService?: string;
  name: string;
  isActive?: boolean;
  treatmentItem?: { quantity?: string; price?: string; serviceDate?: string; [key: string]: unknown };
  [key: string]: unknown;
};

export type MedicalRecordExam = {
  id: number;
  formName?: string;
  serviceDate?: string;
  employee?: { firstName?: string; lastName?: string; [key: string]: unknown };
  [key: string]: unknown;
};

export type MedicalRecordResponse = {
  patient: MedicalRecordPatient;
  practice: MedicalRecordPractice;
  medicalRecord: MedicalRecordEntity;
  labOrders: LabOrderEntry[];
  complaints: unknown[];
  diagnoses: unknown[];
  medications: MedicalRecordMedication[];
  imagingStudies: unknown[];
  dentalCharts: unknown[];
  anestheticMonitorForms: unknown[];
  exams: MedicalRecordExam[];
  histories: unknown[];
};

export async function fetchMedicalRecord(
  patientId: string | number
): Promise<MedicalRecordResponse> {
  const { data } = await http.get<MedicalRecordResponse>(
    `/patients/${patientId}/medical-record`
  );
  return data;
}
