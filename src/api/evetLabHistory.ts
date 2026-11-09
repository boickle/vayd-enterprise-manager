import { http } from './http';

/** One value on an imported eVet in-house lab result. Names come from the owner's eVet export. */
export type EvetLabHistoryValue = {
  elementPimsId: string | null;
  /** The element's name, or "Unnamed eVet field <id>" when it was not in the export. */
  name: string;
  units: string | null;
  value: string | null;
  comments: string | null;
  mapped: boolean;
};

export type EvetLabHistoryResult = {
  id: number;
  date: string | null;
  formPimsId: string | null;
  /** The form's name, or "eVet lab form <id>" when it was not in the export. */
  formName: string;
  summary: string | null;
  values: EvetLabHistoryValue[];
};

/** Staff only, read only: imported eVet in-house lab history for a pet. */
export async function listEvetLabHistory(patientId: number): Promise<EvetLabHistoryResult[]> {
  const { data } = await http.get<EvetLabHistoryResult[]>(`/patients/${patientId}/evet-lab-history`);
  return data;
}
