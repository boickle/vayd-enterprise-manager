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
  surplusBy,
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

export type StockPlan = {
  requests: PlannedRequest[];
  fillSources: FillSource[];
};

function requestKey(row: {
  inventoryItemId: number;
  branchLocationId: number;
  toBranchLocationId?: number | null;
}): string {
  return `${row.inventoryItemId}:${row.branchLocationId}:${row.toBranchLocationId ?? ''}`;
}

/**
 * 1. Non-default locations short of par → fill list.
 * 2. Cover those shorts from over-target locations first (this office, then others)
 *    → transfer list for the giving location. Default surplus is on-hand above max.
 * 3. Leftover need decrements the default location.
 * 4. If default on-hand is then at or below min → order list, qty back to max.
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
    for (const loc of locs) {
      if (loc.branchLocationId === defaultLoc.branchLocationId) continue;
      const need = shortBy(loc.quantityOnHand, loc.parLevel);
      if (need != null) {
        remaining.set(loc.branchLocationId, need);
        planned.push({
          kind: 'fill',
          branchId,
          branchLocationId: loc.branchLocationId,
          inventoryItemId: item.inventoryItemId,
          quantity: need,
        });
      }
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
      qty: number,
      overPar: boolean
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
        overPar,
      });
      if (
        fromBranchId === branchId &&
        fromLocId === defaultLoc.branchLocationId
      ) {
        defaultOut += qty;
      }
      if (overPar) {
        planned.push({
          kind: 'transfer',
          branchId: fromBranchId,
          branchLocationId: fromLocId,
          toBranchId: branchId,
          toBranchLocationId: destLocId,
          inventoryItemId: item.inventoryItemId,
          quantity: qty,
        });
      }
    };

    const pools = locs
      .map((loc) => ({
        branchId,
        locId: loc.branchLocationId,
        extra: surplusBy(loc.quantityOnHand, loc.parLevel) ?? 0,
      }))
      .filter((p) => p.extra > 0)
      .sort((a, b) => b.extra - a.extra);

    const dests = () =>
      [...remaining.entries()]
        .filter(([, need]) => need > 0)
        .sort((a, b) => b[1] - a[1]);

    for (const pool of pools) {
      for (const [destId, need] of dests()) {
        if (pool.extra <= 0) break;
        if (destId === pool.locId) continue;
        const take = Math.min(pool.extra, need);
        if (take <= 0) continue;
        pool.extra -= take;
        remaining.set(destId, need - take);
        addGive(pool.branchId, pool.locId, destId, take, true);
      }
    }

    const otherPools = (otherByItem.get(item.inventoryItemId) ?? [])
      .map((loc) => ({
        branchId: loc.branchId,
        locId: loc.branchLocationId,
        extra: surplusBy(loc.quantityOnHand, loc.parLevel) ?? 0,
      }))
      .filter((p) => p.extra > 0)
      .sort((a, b) => b.extra - a.extra);

    for (const pool of otherPools) {
      for (const [destId, need] of dests()) {
        if (pool.extra <= 0) break;
        const take = Math.min(pool.extra, need);
        if (take <= 0) continue;
        pool.extra -= take;
        remaining.set(destId, need - take);
        addGive(pool.branchId, pool.locId, destId, take, true);
      }
    }

    for (const [destId, need] of remaining) {
      if (need <= 0) continue;
      addGive(branchId, defaultLoc.branchLocationId, destId, need, false);
    }
    const orderQty = orderQtyForDefault({
      effectiveOnHand: Number(defaultLoc.quantityOnHand) - defaultOut,
      min: item.reorderPoint,
      max: defaultLoc.parLevel,
    });
    if (orderQty > 0) {
      planned.push({
        kind: 'order',
        branchId,
        branchLocationId: defaultLoc.branchLocationId,
        inventoryItemId: item.inventoryItemId,
        quantity: orderQty,
      });
    }
  }

  return { requests: planned, fillSources };
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
  await Promise.all([
    ...wanted.map((p) =>
      createStockRequest(practiceId, {
        kind: p.kind,
        branchId: p.branchId,
        branchLocationId: p.branchLocationId,
        inventoryItemId: p.inventoryItemId,
        quantity: p.quantity,
        toBranchId: p.toBranchId,
        toBranchLocationId: p.toBranchLocationId,
        automatic: true,
      })
    ),
    ...open
      .filter((row) => cancelIf(row) && !wantedKeys.has(requestKey(row)))
      .map((row) => resolveStockRequest(practiceId, row.id, 'cancelled')),
  ]);
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
  const maybeNeedsOutside = items.some((item) => {
    const extra = item.locations.reduce(
      (sum, loc) => sum + (surplusBy(loc.quantityOnHand, loc.parLevel) ?? 0),
      0
    );
    return fillNeed(item) > extra;
  });
  if (others.length > 0 && maybeNeedsOutside) {
    const leftoverItems = items.filter((item) => {
      const extra = item.locations.reduce(
        (sum, loc) => sum + (surplusBy(loc.quantityOnHand, loc.parLevel) ?? 0),
        0
      );
      return fillNeed(item) > extra;
    });
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
