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
  id?: number;
  branchLocationId: number;
  name: string;
  isDefault?: boolean;
  inventoryLotBalanceId?: number | null;
  lotNumber?: string | null;
  expirationDate?: string | null;
  actualQty: number | null;
  /** Gross weight in the line's weight unit, when the bottles were weighed. */
  actualWeight?: number | null;
  bottleCount?: number | null;
  counted: boolean;
  countedByName?: string | null;
  countedAt?: string | null;
};

export type StaffCountLine = {
  id: number;
  inventoryItemId: number;
  name: string | null;
  code: string | null;
  measure?: 'volume' | 'weight' | 'both';
  weightUnit?: 'g' | 'oz';
  aliases?: string[];
  requireExpirationOnLots?: boolean;
  requireLotNumber?: boolean;
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
  /** Lines a sheet submit couldn't post; they stay open with the reason. */
  errors?: Array<{ lineId: number; itemName: string | null; message: string }>;
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
  /** Cost per unit when the count posted (today's cost for older counts). */
  unitCost?: number | null;
  /** variance × unitCost: negative is a loss. */
  varianceCost?: number | null;
  /** Over the practice's alert threshold; a task went to the inventory manager. */
  flagged?: boolean;
  managerTaskId?: number | null;
  reviewedAt?: string | null;
  reviewedByName?: string | null;
  /** The flagged count's task was finished from the task list. */
  taskDone?: boolean;
  /** Everyone who entered a location count on this item. */
  countedBy?: string[];
  offCount: boolean;
  locations: {
    branchLocationId: number;
    locationName: string | null;
    inventoryLotBalanceId?: number | null;
    lotNumber?: string | null;
    expirationDate?: string | null;
    expectedQty: number | null;
    actualQty: number | null;
    countedByName?: string | null;
    countedAt?: string | null;
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

export type InventoryAbcExplanation = {
  lookbackDays: number;
  drawsFrom: { id: number; name: string } | null;
  stockItemCount?: number;
  calculatedAt?: string | null;
  /** Dollars used: units × unit cost. */
  usage?: number;
  unitsUsed?: number;
  unitCost?: number | null;
  rank?: number | null;
  itemsWithUsage?: number;
  aMinUsage?: number | null;
  bMinUsage?: number | null;
};

export async function getInventoryAbcExplanation(
  practiceId: number,
  itemId: number
): Promise<InventoryAbcExplanation> {
  const { data } = await http.get<InventoryAbcExplanation>(
    `/practice/${practiceId}/inventory-items/${itemId}/abc-explanation`
  );
  return data;
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

/** The open sheet without starting or topping one up; null when none is open (view-as is read-only). */
export async function getOpenCountSession(
  practiceId: number,
  branchId: number,
  kind: 'weekly' | 'full' = 'weekly'
): Promise<StaffCountSession | null> {
  const { data } = await http.get<StaffCountSession | null | ''>(
    `/practice/${practiceId}/branches/${branchId}/inventory-counts/open`,
    { params: { kind } }
  );
  return data || null;
}

export async function patchCountLine(
  practiceId: number,
  sessionId: number,
  lineId: number,
  locations: {
    id?: number;
    branchLocationId: number;
    inventoryLotBalanceId?: number | null;
    lotNumber?: string | null;
    expirationDate?: string | null;
    actualQty: number | null;
    actualWeight?: number | null;
    bottleCount?: number | null;
  }[]
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
    flaggedOnly?: boolean;
    needsReview?: boolean;
    limit?: number;
    offset?: number;
  }
): Promise<{ total: number; rows: CountReportRow[]; controlledOnly?: boolean }> {
  const { data } = await http.get<{ total: number; rows: CountReportRow[]; controlledOnly?: boolean }>(
    `/practice/${practiceId}/inventory-counts/report`,
    {
      params: {
        ...params,
        offOnly: params?.offOnly ? '1' : undefined,
        flaggedOnly: params?.flaggedOnly ? '1' : undefined,
        needsReview: params?.needsReview ? '1' : undefined,
      },
    }
  );
  return { total: data?.total ?? 0, rows: Array.isArray(data?.rows) ? data.rows : [] };
}

export type InventoryAttention = {
  flaggedCounts: number;
  costReviews: number;
  shrink: { alert: boolean; shrinkPct: number | null; accuracyPct: number | null };
};

export async function getInventoryAttention(practiceId: number): Promise<InventoryAttention> {
  const { data } = await http.get<InventoryAttention>(
    `/practice/${practiceId}/inventory-counts/attention`
  );
  return data;
}

export async function markCountReviewed(
  practiceId: number,
  lineId: number
): Promise<{ id: number; reviewedAt: string; reviewedByName: string | null }> {
  const { data } = await http.post(
    `/practice/${practiceId}/inventory-counts/lines/${lineId}/review`
  );
  return data;
}

/** Offices whose count results the signed-in person can see. */
export async function getCountReviewOffices(practiceId: number): Promise<number[] | 'all'> {
  const { data } = await http.get<{ offices: number[] | 'all' }>(
    `/practice/${practiceId}/inventory-counts/review-offices`
  );
  return data?.offices ?? [];
}

export type CountAlertSettings = {
  enabled: boolean;
  aUnits: number;
  aUsd: number;
  bUnits: number;
  bUsd: number;
  cUnits: number;
  cUsd: number;
  shrinkTaskEnabled: boolean;
  shrinkPctLimit: number;
  accuracyPctLimit: number;
};

export async function getCountAlertSettings(practiceId: number): Promise<CountAlertSettings> {
  const { data } = await http.get<CountAlertSettings>(
    `/practice/${practiceId}/inventory-counts/alert-settings`
  );
  return data;
}

export async function patchCountAlertSettings(
  practiceId: number,
  patch: Partial<CountAlertSettings>
): Promise<CountAlertSettings> {
  const { data } = await http.patch<CountAlertSettings>(
    `/practice/${practiceId}/inventory-counts/alert-settings`,
    patch
  );
  return data;
}

export type ShrinkItemRow = {
  inventoryItemId: number;
  name: string;
  abc: string;
  counted: number;
  timesOff: number;
  netUnits: number;
  netUsd: number;
};

export type ShrinkSummary = {
  /** True when the report covers controlled drugs only (the Controlled Substances Director). */
  controlledOnly?: boolean;
  fromDate: string;
  toDate: string;
  branchId: number | null;
  thresholds: Record<'A' | 'B' | 'C', { units: number; usd: number }>;
  counts: {
    itemsCounted: number;
    firstCounts: number;
    exact: number;
    withinTolerance: number;
    flagged: number;
    accuracyPct: number | null;
    exactPct: number | null;
    lossUsd: number;
    gainUsd: number;
    netUsd: number;
  };
  completion: { due: number; done: number; pct: number | null };
  waste: { usd: number; events: number };
  inventoryValueUsd: number;
  shrinkUsd: number;
  shrinkPct: number | null;
  byClass: {
    abc: string;
    counted: number;
    withinTolerance: number;
    accuracyPct: number | null;
    netUsd: number;
  }[];
  byLocation: {
    branchLocationId: number;
    locationName: string;
    branchName: string;
    netUnits: number;
    netUsd: number;
    cells: number;
  }[];
  topLosses: ShrinkItemRow[];
  repeatOffenders: ShrinkItemRow[];
};

export async function getShrinkSummary(
  practiceId: number,
  params: { fromDate: string; toDate: string; branchId?: number }
): Promise<ShrinkSummary> {
  const { data } = await http.get<ShrinkSummary>(
    `/practice/${practiceId}/inventory-counts/shrink-summary`,
    { params }
  );
  return data;
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
