import { http } from './http';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

export type PatientStatusRow = {
  id: number;
  code: string;
  name: string;
  marksInactive: boolean;
  sortOrder: number;
  isActive: boolean;
};

export type PatientStatusWrite = {
  name?: string;
  code?: string;
  marksInactive?: boolean;
  sortOrder?: number;
  isActive?: boolean;
};

function normalizeRow(row: Partial<PatientStatusRow> & { id: number }): PatientStatusRow {
  return {
    id: Number(row.id),
    code: String(row.code ?? ''),
    name: String(row.name ?? row.code ?? ''),
    marksInactive: row.marksInactive === true,
    sortOrder: Number(row.sortOrder) || 0,
    isActive: row.isActive !== false,
  };
}

export async function listPatientStatuses(opts?: {
  practiceId?: number;
  includeInactive?: boolean;
}): Promise<PatientStatusRow[]> {
  const practiceId = opts?.practiceId ?? PRACTICE_ID;
  const { data } = await http.get<PatientStatusRow[]>('/patient-statuses', {
    params: {
      practiceId,
      ...(opts?.includeInactive ? { includeInactive: '1' } : {}),
    },
  });
  return (Array.isArray(data) ? data : []).map(normalizeRow);
}

export async function createPatientStatus(
  body: PatientStatusWrite,
  practiceId = PRACTICE_ID,
): Promise<PatientStatusRow> {
  const { data } = await http.post<PatientStatusRow>('/patient-statuses', {
    practiceId,
    ...body,
  });
  return normalizeRow(data);
}

export async function patchPatientStatus(
  id: number,
  body: PatientStatusWrite,
  practiceId = PRACTICE_ID,
): Promise<PatientStatusRow> {
  const { data } = await http.patch<PatientStatusRow>(`/patient-statuses/${id}`, {
    practiceId,
    ...body,
  });
  return normalizeRow(data);
}
