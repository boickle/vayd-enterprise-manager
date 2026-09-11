import { http } from './http';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

export type OutsideHospital = {
  id: number;
  practiceId: number;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  createdByEmployeeId: number | null;
  created: string;
  updated: string;
};

export type OutsideHospitalFields = {
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
};

export type ImportOutsideHospitalsResult = {
  created: OutsideHospital[];
  skipped: { name: string; email: string | null; reason: string }[];
};

export async function listOutsideHospitals(opts?: {
  includeInactive?: boolean;
  q?: string;
}): Promise<OutsideHospital[]> {
  const { data } = await http.get<OutsideHospital[]>('/outside-hospitals', {
    params: {
      practiceId: PRACTICE_ID,
      ...(opts?.includeInactive ? { includeInactive: true } : {}),
      ...(opts?.q?.trim() ? { q: opts.q.trim() } : {}),
    },
  });
  return Array.isArray(data) ? data : [];
}

export async function createOutsideHospital(
  fields: OutsideHospitalFields,
): Promise<OutsideHospital> {
  const { data } = await http.post<OutsideHospital>('/outside-hospitals', {
    practiceId: PRACTICE_ID,
    ...fields,
  });
  return data;
}

export async function updateOutsideHospital(
  id: number,
  fields: Partial<OutsideHospitalFields> & { isActive?: boolean },
): Promise<OutsideHospital> {
  const { data } = await http.patch<OutsideHospital>(
    `/outside-hospitals/${encodeURIComponent(id)}`,
    { practiceId: PRACTICE_ID, ...fields },
  );
  return data;
}

export async function deleteOutsideHospital(id: number): Promise<void> {
  await http.delete(`/outside-hospitals/${encodeURIComponent(id)}`, {
    params: { practiceId: PRACTICE_ID },
  });
}

export async function importOutsideHospitals(
  rows: OutsideHospitalFields[],
): Promise<ImportOutsideHospitalsResult> {
  const { data } = await http.post<ImportOutsideHospitalsResult>(
    '/outside-hospitals/import',
    { practiceId: PRACTICE_ID, rows },
  );
  return {
    created: Array.isArray(data?.created) ? data.created : [],
    skipped: Array.isArray(data?.skipped) ? data.skipped : [],
  };
}
