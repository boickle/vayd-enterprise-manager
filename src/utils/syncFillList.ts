import type { BranchParItem } from '../api/branchInventory';
import { getInventoryBranchStock } from '../api/branchInventory';
import {
  createStockRequest,
  listPurchaseOrders,
  listStockRequests,
  resolveStockRequest,
  type InventoryStockRequest,
  type InventoryStockRequestKind,
} from '../api/inventoryOps';
import {
  orderQtyForDefault,
  shortBy,
  spareForTransfer,
} from './inventoryLocationTargets';

export type OtherOfficeRef = { branchId: number; name: string };

export type OtherOfficeStockLoc = {
  inventoryItemId: number;
  branchId: number;
  branchName?: string;
  branchLocationId: number;
  locationName?: string;
  quantityOnHand: number;
  parLevel: number | null;
};

export type PlannedRequest = {
  kind: InventoryStockRequestKind;
  branchId: number;
  branchLocationId: number;
  toBranchId?: number;
  toBranchLocationId?: number;
  inventoryItemId: number;
  quantity: number;
};

export type FillSource = {
  destBranchId: number;
  destLocationId: number;
  inventoryItemId: number;
  fromBranchId: number;
  fromBranchLocationId: number;
  fromBranchName: string;
  fromLocationName: string;
  quantity: number;
  overPar: boolean;
};

export type OrderNeedLine = {
  locationId: number;
  locationName: string;
  onHand: number;
  par: number | null;
  short: number;
  coveredFromMain: number;
};

export type OrderBreakdown = {
  inventoryItemId: number;
  branchLocationId: number;
  quantity: number;
  mainOnHand: number;
  mainOut: number;
  effectiveOnHand: number;
  reorderPoint: number | null;
  max: number | null;
  locationNeeds: OrderNeedLine[];
};

export type StockPlan = {
  requests: PlannedRequest[];
  fillSources: FillSource[];
  orderBreakdowns: OrderBreakdown[];
};

function requestKey(row: {
  inventoryItemId: number;
  branchLocationId: number;
  toBranchLocationId?: number | null;
}): string {
  return `${row.inventoryItemId}:${row.branchLocationId}:${row.toBranchLocationId ?? ''}`;
}

/**
 * 1. Non-default locations short of par → need to receive.
 * 2. Cover shorts in order: Main (down to 0), then other locations over par,
 *    then other offices over par, then other locations down to 0 if Main is empty.
 *    Prefer depleting Main over pulling another location below par.
 * 3. Each covered short becomes a transfer From → To (not a separate fill row).
 * 4. Uncovered shorts stay as fill (To only, From —).
 * 5. If default on-hand after planned gives is at or below min → order list back to max.
 */
export function planStockLists(
  branchId: number,
  defaultLocationId: number | null,
  items: BranchParItem[],
  otherLocs: OtherOfficeStockLoc[] = [],
  officeName = 'Office'
): StockPlan {
  const planned: PlannedRequest[] = [];
  const fillSources: FillSource[] = [];
  const orderBreakdowns: OrderBreakdown[] = [];
  const otherByItem = new Map<number, OtherOfficeStockLoc[]>();
  for (const loc of otherLocs) {
    const list = otherByItem.get(loc.inventoryItemId) ?? [];
    list.push(loc);
    otherByItem.set(loc.inventoryItemId, list);
  }

  for (const item of items) {
    const locs = item.locations ?? [];
    if (locs.length === 0) continue;
    const defaultLoc =
      (defaultLocationId != null
        ? locs.find((l) => l.branchLocationId === defaultLocationId)
        : null) ?? locs[0];

    const remaining = new Map<number, number>();
    const needLines = new Map<number, OrderNeedLine>();
    for (const loc of locs) {
      if (loc.branchLocationId === defaultLoc.branchLocationId) continue;
      const need = shortBy(loc.quantityOnHand, loc.parLevel);
      if (need != null) {
        remaining.set(loc.branchLocationId, need);
        needLines.set(loc.branchLocationId, {
          locationId: loc.branchLocationId,
          locationName: loc.name ?? 'Location',
          onHand: Number(loc.quantityOnHand) || 0,
          par: loc.parLevel,
          short: need,
          coveredFromMain: 0,
        });
      }
    }
    const pushOrder = (defaultOut: number) => {
      const effectiveOnHand = Number(defaultLoc.quantityOnHand) - defaultOut;
      const orderQty = orderQtyForDefault({
        effectiveOnHand,
        min: item.reorderPoint,
        max: defaultLoc.parLevel,
      });
      if (orderQty <= 0) return;
      planned.push({
        kind: 'order',
        branchId,
        branchLocationId: defaultLoc.branchLocationId,
        inventoryItemId: item.inventoryItemId,
        quantity: orderQty,
      });
      orderBreakdowns.push({
        inventoryItemId: item.inventoryItemId,
        branchLocationId: defaultLoc.branchLocationId,
        quantity: orderQty,
        mainOnHand: Number(defaultLoc.quantityOnHand) || 0,
        mainOut: defaultOut,
        effectiveOnHand,
        reorderPoint: item.reorderPoint,
        max: defaultLoc.parLevel,
        locationNeeds: [...needLines.values()].filter((n) => n.short > 0),
      });
    };
    if (remaining.size === 0) {
      pushOrder(0);
      continue;
    }

    const locName = (fromBranchId: number, fromLocId: number): { office: string; loc: string } => {
      if (fromBranchId === branchId) {
        const loc = locs.find((l) => l.branchLocationId === fromLocId);
        return { office: officeName, loc: loc?.name ?? 'Location' };
      }
      const other = (otherByItem.get(item.inventoryItemId) ?? []).find(
        (l) => l.branchId === fromBranchId && l.branchLocationId === fromLocId
      );
      return {
        office: other?.branchName ?? 'Office',
        loc: other?.locationName ?? 'Location',
      };
    };
    let defaultOut = 0;
    const addGive = (
      fromBranchId: number,
      fromLocId: number,
      destLocId: number,
      qty: number
    ) => {
      const names = locName(fromBranchId, fromLocId);
      fillSources.push({
        destBranchId: branchId,
        destLocationId: destLocId,
        inventoryItemId: item.inventoryItemId,
        fromBranchId,
        fromBranchLocationId: fromLocId,
        fromBranchName: names.office,
        fromLocationName: names.loc,
        quantity: qty,
        overPar: true,
      });
      if (
        fromBranchId === branchId &&
        fromLocId === defaultLoc.branchLocationId
      ) {
        defaultOut += qty;
        const line = needLines.get(destLocId);
        if (line) line.coveredFromMain += qty;
      }
      planned.push({
        kind: 'transfer',
        branchId: fromBranchId,
        branchLocationId: fromLocId,
        toBranchId: branchId,
        toBranchLocationId: destLocId,
        inventoryItemId: item.inventoryItemId,
        quantity: qty,
      });
    };

    const dests = () =>
      [...remaining.entries()]
        .filter(([, need]) => need > 0)
        .sort((a, b) => b[1] - a[1]);

    /** Remaining units each source can still give (starts at on-hand). */
    const available = new Map<string, number>();
    const availKey = (b: number, locId: number) => `${b}:${locId}`;
    available.set(
      availKey(branchId, defaultLoc.branchLocationId),
      Math.max(0, Number(defaultLoc.quantityOnHand) || 0)
    );
    for (const loc of locs) {
      if (loc.branchLocationId === defaultLoc.branchLocationId) continue;
      available.set(
        availKey(branchId, loc.branchLocationId),
        Math.max(0, Number(loc.quantityOnHand) || 0)
      );
    }
    for (const loc of otherByItem.get(item.inventoryItemId) ?? []) {
      available.set(
        availKey(loc.branchId, loc.branchLocationId),
        Math.max(0, Number(loc.quantityOnHand) || 0)
      );
    }

    const drainPools = (
      pools: { branchId: number; locId: number; cap: number }[]
    ) => {
      for (const pool of pools) {
        const key = availKey(pool.branchId, pool.locId);
        let left = Math.min(pool.cap, available.get(key) ?? 0);
        for (const [destId, need] of dests()) {
          if (left <= 0) break;
          if (pool.branchId === branchId && destId === pool.locId) continue;
          const take = Math.min(left, need);
          if (take <= 0) continue;
          left -= take;
          available.set(key, (available.get(key) ?? 0) - take);
          remaining.set(destId, need - take);
          addGive(pool.branchId, pool.locId, destId, take);
        }
      }
    };

    // 1) Prefer Main — give all on-hand (down to 0).
    drainPools([
      {
        branchId,
        locId: defaultLoc.branchLocationId,
        cap: spareForTransfer({
          isDefault: true,
          onHand: defaultLoc.quantityOnHand,
          parOrMax: defaultLoc.parLevel,
        }),
      },
    ]);

    // 2) Same-office locations only while over par.
    drainPools(
      locs
        .filter((loc) => loc.branchLocationId !== defaultLoc.branchLocationId)
        .map((loc) => ({
          branchId,
          locId: loc.branchLocationId,
          cap: spareForTransfer({
            isDefault: false,
            onHand: loc.quantityOnHand,
            parOrMax: loc.parLevel,
          }),
        }))
        .filter((p) => p.cap > 0)
        .sort((a, b) => b.cap - a.cap)
    );

    // 3) Other offices over par.
    drainPools(
      (otherByItem.get(item.inventoryItemId) ?? [])
        .map((loc) => ({
          branchId: loc.branchId,
          locId: loc.branchLocationId,
          cap: spareForTransfer({
            isDefault: false,
            onHand: loc.quantityOnHand,
            parOrMax: loc.parLevel,
          }),
        }))
        .filter((p) => p.cap > 0)
        .sort((a, b) => b.cap - a.cap)
    );

    // 4) Last resort: same-office non-default remaining on-hand (below par) if Main is empty.
    if (dests().length > 0) {
      drainPools(
        locs
          .filter((loc) => loc.branchLocationId !== defaultLoc.branchLocationId)
          .map((loc) => ({
            branchId,
            locId: loc.branchLocationId,
            cap: spareForTransfer({
              isDefault: false,
              onHand: available.get(availKey(branchId, loc.branchLocationId)) ?? 0,
              parOrMax: loc.parLevel,
              allowBelowPar: true,
            }),
          }))
          .filter((p) => p.cap > 0)
          .sort((a, b) => b.cap - a.cap)
      );
    }

    // Uncovered shorts — show on transfer list as To with no From yet.
    for (const [destId, need] of remaining) {
      if (need <= 0) continue;
      planned.push({
        kind: 'fill',
        branchId,
        branchLocationId: destId,
        inventoryItemId: item.inventoryItemId,
        quantity: need,
      });
    }

    pushOrder(defaultOut);
  }

  return { requests: planned, fillSources, orderBreakdowns };
}

async function applyKind(
  practiceId: number,
  kind: InventoryStockRequestKind,
  planned: PlannedRequest[],
  open: InventoryStockRequest[],
  cancelIf: (row: InventoryStockRequest) => boolean
): Promise<void> {
  const wanted = planned.filter((p) => p.kind === kind);
  const wantedKeys = new Set(wanted.map((p) => requestKey(p)));
  const cancelIds = new Set<number>();

  // Collapse every open twin for a wanted key (any requester), keep lowest id.
  const byKey = new Map<string, InventoryStockRequest[]>();
  for (const row of open) {
    const key = requestKey(row);
    if (!wantedKeys.has(key)) continue;
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }
  for (const list of byKey.values()) {
    list.sort((a, b) => a.id - b.id);
    for (const extra of list.slice(1)) cancelIds.add(extra.id);
  }

  // Drop obsolete automatic rows for this office/scope.
  for (const row of open.filter(cancelIf)) {
    if (!wantedKeys.has(requestKey(row))) cancelIds.add(row.id);
  }

  if (cancelIds.size > 0) {
    await Promise.all(
      [...cancelIds].map((id) => resolveStockRequest(practiceId, id, 'cancelled'))
    );
  }

  for (const p of wanted) {
    await createStockRequest(practiceId, {
      kind: p.kind,
      branchId: p.branchId,
      branchLocationId: p.branchLocationId,
      inventoryItemId: p.inventoryItemId,
      quantity: p.quantity,
      toBranchId: p.toBranchId,
      toBranchLocationId: p.toBranchLocationId,
      automatic: true,
    });
  }
}

export async function syncStockListsFromPars(
  practiceId: number,
  branchId: number,
  items: BranchParItem[],
  opts?: {
    defaultLocationId?: number | null;
    otherOffices?: OtherOfficeRef[];
    officeName?: string;
  }
): Promise<StockPlan> {
  const defaultLocationId = opts?.defaultLocationId ?? null;
  const officeName = opts?.officeName ?? 'Office';
  let otherLocs: OtherOfficeStockLoc[] = [];
  const others = (opts?.otherOffices ?? []).filter((o) => o.branchId !== branchId);
  const fillNeed = (item: BranchParItem) =>
    item.locations.reduce((sum, loc) => {
      if (defaultLocationId != null && loc.branchLocationId === defaultLocationId) return sum;
      return sum + (shortBy(loc.quantityOnHand, loc.parLevel) ?? 0);
    }, 0);
  const officeSpare = (item: BranchParItem) =>
    item.locations.reduce(
      (sum, loc) =>
        sum +
        spareForTransfer({
          isDefault: defaultLocationId != null && loc.branchLocationId === defaultLocationId,
          onHand: loc.quantityOnHand,
          parOrMax: loc.parLevel,
        }),
      0
    );
  const maybeNeedsOutside = items.some((item) => fillNeed(item) > officeSpare(item));
  if (others.length > 0 && maybeNeedsOutside) {
    const leftoverItems = items.filter((item) => fillNeed(item) > officeSpare(item));
    const rows = await Promise.all(
      leftoverItems.flatMap((item) =>
        others.map(async (office) => {
          try {
            const stock = await getInventoryBranchStock(
              practiceId,
              office.branchId,
              item.inventoryItemId
            );
            return (stock.locations ?? []).map((loc) => ({
              inventoryItemId: item.inventoryItemId,
              branchId: office.branchId,
              branchName: office.name,
              branchLocationId: loc.branchLocationId,
              locationName: loc.name,
              quantityOnHand: Number(loc.quantityOnHand ?? 0),
              parLevel: loc.parLevel ?? null,
            }));
          } catch {
            return [];
          }
        })
      )
    );
    otherLocs = rows.flat();
  }

  const plan = planStockLists(branchId, defaultLocationId, items, otherLocs, officeName);
  const itemIds = new Set(items.map((i) => i.inventoryItemId));
  const [fills, orders, transfers, purchaseOrders] = await Promise.all([
    listStockRequests(practiceId, { kind: 'fill', status: 'open', branchId }),
    listStockRequests(practiceId, { kind: 'order', status: 'open', branchId }),
    listStockRequests(practiceId, { kind: 'transfer', status: 'open' }),
    listPurchaseOrders(practiceId, branchId),
  ]);
  const alreadyOrdered = new Set<string>();
  for (const po of purchaseOrders) {
    if (po.status !== 'open' || po.branchId !== branchId) continue;
    for (const line of po.lines ?? []) {
      alreadyOrdered.add(`${line.inventoryItemId}:${line.branchLocationId}`);
    }
  }
  plan.requests = plan.requests.filter(
    (p) =>
      p.kind !== 'order' ||
      !alreadyOrdered.has(`${p.inventoryItemId}:${p.branchLocationId}`)
  );

  await applyKind(practiceId, 'fill', plan.requests, fills, (row) => row.branchId === branchId);
  await applyKind(
    practiceId,
    'order',
    plan.requests,
    orders,
    (row) => row.branchId === branchId && itemIds.has(row.inventoryItemId)
  );
  await applyKind(
    practiceId,
    'transfer',
    plan.requests,
    transfers,
    (row) =>
      row.requestedByName === 'Par levels' &&
      (row.toBranchId === branchId || (row.toBranchId == null && row.branchId === branchId))
  );
  return plan;
}

/** @deprecated use syncStockListsFromPars */
export async function syncFillListFromPars(
  practiceId: number,
  branchId: number,
  items: BranchParItem[],
  opts?: {
    defaultLocationId?: number | null;
    otherOffices?: OtherOfficeRef[];
  }
): Promise<void> {
  await syncStockListsFromPars(practiceId, branchId, items, opts);
}
