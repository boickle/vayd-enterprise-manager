import { http } from './http';
import { currentPracticeId } from '../utils/practiceIdFromToken';

const PRACTICE_ID = currentPracticeId();

export type ClientStatusRow = {
  id: number;
  code: string;
  name: string;
  discount: number;
  labDiscount: number | null;
  procedureDiscount: number | null;
  inventoryDiscount: number | null;
  inventoryDiscountMode: 'percent' | 'cost_plus';
  discountType: number;
  lowerPriceToCost: boolean;
  isStaff: boolean;
  isActive: boolean;
};

export type ClientStatusWrite = {
  name?: string;
  discount?: number;
  labDiscount?: number | null;
  procedureDiscount?: number | null;
  inventoryDiscount?: number | null;
  inventoryDiscountMode?: 'percent' | 'cost_plus';
  /** 0 = none, 1 = percent off (the usual employee / VIP cut). */
  discountType?: number;
  lowerPriceToCost?: boolean;
  isStaff?: boolean;
  isActive?: boolean;
};

function normalizeRow(row: Partial<ClientStatusRow> & { id: number }): ClientStatusRow {
  return {
    id: Number(row.id),
    code: String(row.code ?? ''),
    name: String(row.name ?? row.code ?? ''),
    discount: Number(row.discount) || 0,
    labDiscount:
      row.labDiscount == null || row.labDiscount === ('' as unknown as number)
        ? null
        : Number(row.labDiscount),
    procedureDiscount:
      row.procedureDiscount == null ||
      row.procedureDiscount === ('' as unknown as number)
        ? null
        : Number(row.procedureDiscount),
    inventoryDiscount:
      row.inventoryDiscount == null ||
      row.inventoryDiscount === ('' as unknown as number)
        ? null
        : Number(row.inventoryDiscount),
    inventoryDiscountMode:
      row.inventoryDiscountMode === 'cost_plus' ? 'cost_plus' : 'percent',
    discountType: Number(row.discountType) || 0,
    lowerPriceToCost: row.lowerPriceToCost === true,
    isStaff: row.isStaff === true,
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
