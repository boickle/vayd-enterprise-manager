import { http } from './http';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

export type ClientStatusRow = {
  id: number;
  code: string;
  name: string;
  discount: number;
  discountType: number;
  lowerPriceToCost: boolean;
  isActive: boolean;
};

export type ClientStatusWrite = {
  name?: string;
  discount?: number;
  discountType?: number;
  lowerPriceToCost?: boolean;
  isActive?: boolean;
};

function normalizeRow(row: Partial<ClientStatusRow> & { id: number }): ClientStatusRow {
  return {
    id: Number(row.id),
    code: String(row.code ?? ''),
    name: String(row.name ?? row.code ?? ''),
    discount: Number(row.discount) || 0,
    discountType: Number(row.discountType) || 0,
    lowerPriceToCost: row.lowerPriceToCost === true,
    isActive: row.isActive !== false,
  };
}

export async function listClientStatuses(opts?: {
  practiceId?: number;
  includeInactive?: boolean;
}): Promise<ClientStatusRow[]> {
  const practiceId = opts?.practiceId ?? PRACTICE_ID;
  const { data } = await http.get<ClientStatusRow[]>('/client-statuses', {
    params: {
      practiceId,
      ...(opts?.includeInactive ? { includeInactive: '1' } : {}),
    },
  });
  return (Array.isArray(data) ? data : []).map(normalizeRow);
}

export async function patchClientStatus(
  id: number,
  body: ClientStatusWrite,
  practiceId = PRACTICE_ID,
): Promise<ClientStatusRow> {
  const { data } = await http.patch<ClientStatusRow>(`/client-statuses/${id}`, {
    practiceId,
    ...body,
  });
  return normalizeRow(data);
}
