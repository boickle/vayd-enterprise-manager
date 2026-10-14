import { http } from './http';

export type ClientRecordUpload = {
  id: number;
  formPetId: string;
  petName: string;
  patientId: number | null;
  clientId: number | null;
  originalFilename: string;
  contentType: string;
  byteSize: number;
  created: string;
  url: string;
};

export async function uploadAppointmentRequestRecord(input: {
  uploadToken: string;
  file: File;
  formPetId: string;
  petName: string;
  patientId?: number;
}): Promise<ClientRecordUpload> {
  const body = new FormData();
  body.append('file', input.file);
  body.append('uploadToken', input.uploadToken);
  body.append('formPetId', input.formPetId);
  body.append('petName', input.petName);
  if (input.patientId != null && Number.isFinite(input.patientId)) {
    body.append('patientId', String(input.patientId));
  }
  const { data } = await http.post<ClientRecordUpload>(
    '/public/appointments/record-uploads',
    body,
  );
  return data;
}

export async function fetchSubmissionRecordUploads(
  submissionId: number,
): Promise<ClientRecordUpload[]> {
  const { data } = await http.get<{ items: ClientRecordUpload[] }>(
    `/appointments/request-submissions/${encodeURIComponent(String(submissionId))}/record-uploads`,
  );
  return data.items ?? [];
}

export async function fetchPatientRecordUploads(
  patientId: number,
): Promise<ClientRecordUpload[]> {
  const { data } = await http.get<{ items: ClientRecordUpload[] }>(
    `/patients/${encodeURIComponent(String(patientId))}/record-uploads`,
  );
  return data.items ?? [];
}

export async function linkRecordUploadToPatient(
  submissionId: number,
  uploadId: number,
  patientId: number,
): Promise<ClientRecordUpload> {
  const { data } = await http.post<ClientRecordUpload>(
    `/appointments/request-submissions/${encodeURIComponent(String(submissionId))}/record-uploads/${encodeURIComponent(String(uploadId))}/patient`,
    { patientId },
  );
  return data;
}
