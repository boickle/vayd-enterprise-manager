import { http } from './http';

export type InventoryAbcClass = 'A' | 'B' | 'C';

export type CountLocationCol = {
  id: number;
  name: string;
  code?: string;
  isDefault?: boolean;
};

export type CountDueItem = {
  inventoryItemId: number;
  name: string;
  code: string | null;
  recommendedAbc: string | null;
  assignedAbc: string | null;
  effectiveAbc: InventoryAbcClass;
  lastCountedAt: string | null;
  neverCounted: boolean;
};

export type StaffCountLocation = {
  branchLocationId: number;
  name: string;
  isDefault?: boolean;
  actualQty: number | null;
  counted: boolean;
};

export type StaffCountLine = {
  id: number;
  inventoryItemId: number;
  name: string | null;
  code: string | null;
  effectiveAbc: string;
  submitted: boolean;
  actualTotal: number | null;
  locations: StaffCountLocation[];
};

export type StaffCountSession = {
  id: number;
  branchId: number;
  kind?: 'weekly' | 'full';
  status: 'open' | 'submitted';
  created: string;
  submittedAt: string | null;
  locations: CountLocationCol[];
  lines: StaffCountLine[];
  submittedCount?: number;
};

export type CountReportRow = {
  id: number;
  sessionId: number;
  submittedAt: string | null;
  branchId: number;
  branchName: string | null;
  inventoryItemId: number;
  name: string | null;
  code: string | null;
  effectiveAbc: string;
  expectedTotal: number | null;
  actualTotal: number | null;
  variance: number | null;
  offCount: boolean;
  locations: {
    branchLocationId: number;
    locationName: string | null;
    expectedQty: number | null;
    actualQty: number | null;
  }[];
};

export type ItemMovementRow = {
  id: number;
  created: string;
  movementType: string;
  quantity: number;
  note: string | null;
  branchId: number;
  branchName: string | null;
  fromLocationName: string | null;
  toLocationName: string | null;
  actorName: string | null;
};

export async function refreshInventoryAbc(practiceId: number): Promise<{ updated: number }> {
  const { data } = await http.post<{ updated: number }>(
    `/practice/${practiceId}/inventory-abc/refresh`
  );
  return data ?? { updated: 0 };
}

export async function startCountSession(
  practiceId: number,
  branchId: number,
  kind: 'weekly' | 'full' = 'weekly'
): Promise<StaffCountSession> {
  const { data } = await http.post<StaffCountSession>(
    `/practice/${practiceId}/branches/${branchId}/inventory-counts`,
    undefined,
    { params: { kind } }
  );
  return data;
}

export async function patchCountLine(
  practiceId: number,
  sessionId: number,
  lineId: number,
  locations: { branchLocationId: number; actualQty: number | null }[]
): Promise<StaffCountLine> {
  const { data } = await http.patch<StaffCountLine>(
    `/practice/${practiceId}/inventory-counts/${sessionId}/lines/${lineId}`,
    { locations }
  );
  return data;
}

export async function submitCountLine(
  practiceId: number,
  sessionId: number,
  lineId: number
): Promise<{ sessionStatus?: string; line: StaffCountLine }> {
  const { data } = await http.post<{ sessionStatus?: string; line: StaffCountLine }>(
    `/practice/${practiceId}/inventory-counts/${sessionId}/lines/${lineId}/submit`
  );
  return data;
}

export async function submitCountSession(
  practiceId: number,
  sessionId: number
): Promise<StaffCountSession> {
  const { data } = await http.post<StaffCountSession>(
    `/practice/${practiceId}/inventory-counts/${sessionId}/submit`
  );
  return data;
}

export async function listCountReport(
  practiceId: number,
  params?: {
    branchId?: number;
    fromDate?: string;
    toDate?: string;
    abc?: string;
    offOnly?: boolean;
    limit?: number;
    offset?: number;
  }
): Promise<{ total: number; rows: CountReportRow[] }> {
  const { data } = await http.get<{ total: number; rows: CountReportRow[] }>(
    `/practice/${practiceId}/inventory-counts/report`,
    {
      params: {
        ...params,
        offOnly: params?.offOnly ? '1' : undefined,
      },
    }
  );
  return { total: data?.total ?? 0, rows: Array.isArray(data?.rows) ? data.rows : [] };
}

export async function listItemMovementsOrg(
  practiceId: number,
  inventoryItemId: number,
  params?: { limit?: number; offset?: number }
): Promise<{ total: number; rows: ItemMovementRow[] }> {
  const { data } = await http.get<{ total: number; rows: ItemMovementRow[] }>(
    `/practice/${practiceId}/inventory-items/${inventoryItemId}/movements`,
    { params }
  );
  return { total: data?.total ?? 0, rows: Array.isArray(data?.rows) ? data.rows : [] };
}
