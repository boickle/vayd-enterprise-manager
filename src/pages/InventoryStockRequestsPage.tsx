import { Fragment, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import {
  getInventoryBranchStock,
  listBranchParLevels,
  listInventoryBranchLocations,
  listPracticeBranches,
  type InventoryBranchLocation,
  type InventoryStockLocationRow,
  type PracticeBranch,
} from '../api/branchInventory';
import {
  listPurchaseOrders,
  listStockRequests,
  listSuppliers,
  resolveStockRequest,
  type InventoryPurchaseOrder,
  type InventoryStockRequest,
  type InventoryStockRequestKind,
  type InventorySupplier,
} from '../api/inventoryOps';
import ParTransferModal, {
  type TransferModalSource,
} from '../components/inventory/ParTransferModal';
import PlaceOrderModal from '../components/inventory/PlaceOrderModal';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import {
  hitsDefaultMin,
  shortBy,
  surplusBy,
} from '../utils/inventoryLocationTargets';
import { syncStockListsFromPars, type FillSource, type OrderBreakdown } from '../utils/syncFillList';
import './Settings.css';

const BRANCH_STORAGE_PREFIX = 'vayd_inventory_branch:';

type LocSnap = {
  branchLocationId: number;
  name: string;
  quantityOnHand: number;
  parLevel: number | null;
  isDefault?: boolean;
};

function sourcesFor(sources: FillSource[], row: InventoryStockRequest): FillSource[] {
  return sources.filter(
    (s) =>
      s.overPar &&
      s.inventoryItemId === row.inventoryItemId &&
      s.destLocationId === row.branchLocationId &&
      s.destBranchId === row.branchId
  );
}

function placeLabel(office: string | null, loc: string | null): string {
  if (office && loc) return `${office} · ${loc}`;
  return loc ?? office ?? '—';
}

function stockKey(branchId: number, itemId: number): string {
  return `${branchId}:${itemId}`;
}

function transferIdentityKey(row: InventoryStockRequest): string {
  if (row.kind === 'fill') {
    return `fill:${row.inventoryItemId}:${row.branchId}:${row.branchLocationId}`;
  }
  return `xfer:${row.inventoryItemId}:${row.branchId}:${row.branchLocationId}:${row.toBranchId ?? ''}:${row.toBranchLocationId ?? ''}`;
}

function mergeTransferRows(
  transfers: InventoryStockRequest[],
  fills: InventoryStockRequest[]
): InventoryStockRequest[] {
  const coveredLoc = new Set(
    transfers.map(
      (row) =>
        `${row.inventoryItemId}:${row.toBranchId ?? row.branchId}:${row.toBranchLocationId ?? ''}`
    )
  );
  // Also treat transfers with a dest location as covering fills to that location in the same office.
  for (const row of transfers) {
    if (row.toBranchLocationId == null) continue;
    const destOffice = row.toBranchId ?? row.branchId;
    coveredLoc.add(`${row.inventoryItemId}:${destOffice}:${row.toBranchLocationId}`);
  }
  const needRows = fills.filter((row) => {
    if (coveredLoc.has(`${row.inventoryItemId}:${row.branchId}:${row.branchLocationId}`)) {
      return false;
    }
    return true;
  });
  const merged = [...transfers, ...needRows];
  const seen = new Set<string>();
  const deduped: InventoryStockRequest[] = [];
  for (const row of merged) {
    const key = transferIdentityKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function locFromRow(row: InventoryStockLocationRow): LocSnap {
  return {
    branchLocationId: row.branchLocationId,
    name: row.name,
    quantityOnHand: Number(row.quantityOnHand ?? 0),
    parLevel: row.parLevel ?? null,
    isDefault: row.isDefault === true || String(row.code ?? '').toLowerCase() === 'main',
  };
}

function TargetCell({
  loc,
  reorder,
}: {
  loc: LocSnap;
  reorder?: number | null;
}) {
  if (loc.isDefault) {
    return (
      <>
        <div>{loc.parLevel != null ? `Max ${loc.parLevel}` : 'Max —'}</div>
        <div className="settings-muted" style={{ fontSize: 12 }}>
          Re-order {reorder != null ? reorder : '—'}
        </div>
      </>
    );
  }
  return <>{loc.parLevel != null ? `Par ${loc.parLevel}` : '—'}</>;
}

function ParStatus({
  onHand,
  par,
  isDefault,
  min,
}: {
  onHand: number;
  par: number | null;
  isDefault?: boolean;
  min?: number | null;
}) {
  if (isDefault) {
    if (hitsDefaultMin(onHand, min ?? null)) {
      return <span className="par-short">at re-order — order</span>;
    }
    const belowMax = shortBy(onHand, par);
    if (belowMax != null) {
      return <span className="settings-muted">below max {belowMax}</span>;
    }
    const extra = surplusBy(onHand, par);
    if (extra != null) return <span className="par-surplus">Over {extra}</span>;
    if (par != null) return <span className="settings-muted">at max</span>;
    return <span className="settings-muted">can give {onHand}</span>;
  }
  const short = shortBy(onHand, par);
  const extra = surplusBy(onHand, par);
  if (short != null) return <span className="par-short">short {short}</span>;
  if (extra != null) return <span className="par-surplus">Over {extra}</span>;
  if (par != null) return <span className="settings-muted">at par</span>;
  return <span className="settings-muted">no par</span>;
}

function findLoc(snaps: LocSnap[] | undefined, locationId: number | null): LocSnap | null {
  if (!snaps || locationId == null) return null;
  return snaps.find((l) => l.branchLocationId === locationId) ?? null;
}

type Props = { kind: InventoryStockRequestKind };

export default function InventoryStockRequestsPage({ kind }: Props) {
  const { token } = useAuth() as { token: string | null };
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);
  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [branchId, setBranchId] = useState<number | ''>('');
  const [locations, setLocations] = useState<InventoryBranchLocation[]>([]);
  const [locationId, setLocationId] = useState<number | ''>('');
  const [rows, setRows] = useState<InventoryStockRequest[]>([]);
  const [fillSources, setFillSources] = useState<FillSource[]>([]);
  const [orderBreakdowns, setOrderBreakdowns] = useState<OrderBreakdown[]>([]);
  const [stockMap, setStockMap] = useState<Record<string, LocSnap[]>>({});
  const [defaultLocationId, setDefaultLocationId] = useState<number | null>(null);
  const [reorderByItemId, setReorderByItemId] = useState<Record<number, number | null>>({});
  const [openOtherId, setOpenOtherId] = useState<number | null>(null);
  const [otherRows, setOtherRows] = useState<
    { branchId: number; branchName: string; loc: LocSnap; reorder: number | null }[]
  >([]);
  const [otherBusy, setOtherBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [transferSource, setTransferSource] = useState<TransferModalSource | null>(null);
  const [suppliers, setSuppliers] = useState<InventorySupplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<InventoryPurchaseOrder[]>([]);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [openOrderId, setOpenOrderId] = useState<number | null>(null);

  const isFill = kind === 'fill';
  const isTransfer = kind === 'transfer';
  const isOrder = kind === 'order';
  const title = isTransfer || isFill ? 'Transfer list' : 'Order list';
  const officeName = branches.find((b) => b.id === branchId)?.name ?? 'Office';
  const orderedQtyByItemLoc = useMemo(() => {
    const map = new Map<string, number>();
    for (const po of purchaseOrders) {
      if (po.status !== 'open') continue;
      for (const line of po.lines ?? []) {
        const key = `${line.inventoryItemId}:${line.branchLocationId}`;
        map.set(key, (map.get(key) ?? 0) + Number(line.quantity));
      }
    }
    return map;
  }, [purchaseOrders]);

  useEffect(() => {
    void listPracticeBranches(practiceId)
      .then((list) => {
        const active = list.filter((b) => b.isActive !== false);
        setBranches(active);
        let initial: number | '' = '';
        try {
          const stored = localStorage.getItem(`${BRANCH_STORAGE_PREFIX}${practiceId}`);
          if (stored) {
            const n = Number(stored);
            if (Number.isFinite(n) && active.some((b) => b.id === n)) initial = n;
          }
        } catch {
          /* ignore */
        }
        if (initial === '') {
          initial = active.find((b) => b.isDefault)?.id ?? active[0]?.id ?? '';
        }
        setBranchId(initial);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Could not load offices');
      });
  }, [practiceId]);

  useEffect(() => {
    if (branchId === '') {
      setLocations([]);
      setLocationId('');
      return;
    }
    void listInventoryBranchLocations(practiceId, Number(branchId)).then((locs) => {
      const active = locs.filter((l) => l.isActive !== false);
      setLocations(active);
      setLocationId((prev) => (prev !== '' && active.some((l) => l.id === prev) ? prev : ''));
    });
  }, [practiceId, branchId]);

  async function loadStockMap(requests: InventoryStockRequest[]) {
    const pairs = new Map<string, { officeId: number; itemId: number }>();
    for (const row of requests) {
      pairs.set(stockKey(row.branchId, row.inventoryItemId), {
        officeId: row.branchId,
        itemId: row.inventoryItemId,
      });
      if (row.toBranchId != null) {
        pairs.set(stockKey(row.toBranchId, row.inventoryItemId), {
          officeId: row.toBranchId,
          itemId: row.inventoryItemId,
        });
      }
    }
    const entries = await Promise.all(
      [...pairs.values()].map(async ({ officeId, itemId }) => {
        try {
          const stock = await getInventoryBranchStock(practiceId, officeId, itemId);
          return [stockKey(officeId, itemId), (stock.locations ?? []).map(locFromRow)] as const;
        } catch {
          return [stockKey(officeId, itemId), []] as const;
        }
      })
    );
    setStockMap(Object.fromEntries(entries));
  }

  async function reload() {
    setBusy(true);
    setError(null);
    try {
      if (branchId !== '') {
        const pars = await listBranchParLevels(practiceId, Number(branchId));
        const defaultLocationId =
          pars.locations?.find((l) => l.isDefault)?.id ??
          locations.find((l) => l.isDefault)?.id ??
          pars.locations?.[0]?.id ??
          locations[0]?.id ??
          null;
        const plan = await syncStockListsFromPars(practiceId, Number(branchId), pars.items ?? [], {
          defaultLocationId,
          officeName,
          otherOffices: branches
            .filter((b) => b.id !== Number(branchId) && b.isActive !== false)
            .map((b) => ({ branchId: b.id, name: b.name })),
        });
        setFillSources(plan.fillSources);
        setOrderBreakdowns(plan.orderBreakdowns);
        setDefaultLocationId(defaultLocationId);
        const reorder: Record<number, number | null> = {};
        for (const item of pars.items ?? []) {
          reorder[item.inventoryItemId] = item.reorderPoint ?? null;
        }
        setReorderByItemId(reorder);
      }
      if (isTransfer || isFill) {
        const [transfers, fills] = await Promise.all([
          listStockRequests(practiceId, { kind: 'transfer', status: 'open' }),
          listStockRequests(practiceId, {
            kind: 'fill',
            status: 'open',
            branchId: branchId === '' ? undefined : Number(branchId),
          }),
        ]);
        const office = branchId === '' ? null : Number(branchId);
        const loc = locationId === '' ? null : Number(locationId);
        const transferRows =
          office == null
            ? transfers
            : transfers.filter((row) => row.branchId === office || row.toBranchId === office);
        const officeFills =
          office == null ? fills : fills.filter((row) => row.branchId === office);
        const merged = mergeTransferRows(transferRows, officeFills);
        const next =
          loc == null
            ? merged
            : merged.filter(
                (row) =>
                  row.branchLocationId === loc ||
                  row.toBranchLocationId === loc
              );
        setRows(next);
        void loadStockMap(next);
      } else {
        const data = await listStockRequests(practiceId, {
          kind,
          status: 'open',
          branchId: branchId === '' ? undefined : Number(branchId),
        });
        const seen = new Set<string>();
        const deduped: InventoryStockRequest[] = [];
        for (const row of data) {
          const key = `${row.inventoryItemId}:${row.branchLocationId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(row);
        }
        setRows(deduped);
        void loadStockMap(deduped);
      }
      if (isOrder) {
        const [pos, sups] = await Promise.all([
          listPurchaseOrders(practiceId, branchId === '' ? undefined : Number(branchId)),
          listSuppliers(practiceId),
        ]);
        setPurchaseOrders(pos);
        setSuppliers(sups.filter((s) => s.isActive !== false));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load list');
      setRows([]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when filters change
  }, [practiceId, kind, branchId, locationId, branches]);

  async function toggleOtherStock(row: InventoryStockRequest) {
    if (openOtherId === row.id) {
      setOpenOtherId(null);
      setOtherRows([]);
      return;
    }
    setOpenOtherId(row.id);
    setOtherBusy(true);
    const seen = new Set([row.branchId]);
    if (row.toBranchId != null) seen.add(row.toBranchId);
    const others = branches.filter((b) => b.isActive !== false && !seen.has(b.id));
    try {
      const extra = await Promise.all(
        others.map(async (b) => {
          try {
            const stock = await getInventoryBranchStock(practiceId, b.id, row.inventoryItemId);
            const reorder = stock.reorderPoint ?? null;
            return (stock.locations ?? []).map((loc) => ({
              branchId: b.id,
              branchName: b.name,
              loc: locFromRow(loc),
              reorder,
            }));
          } catch {
            return [];
          }
        })
      );
      setOtherRows(extra.flat());
    } finally {
      setOtherBusy(false);
    }
  }

  function openTransfer(row: InventoryStockRequest) {
    const destOnly = row.kind === 'fill';
    const fromOfficeId = destOnly ? row.branchId : row.branchId;
    const fromLocs = stockMap[stockKey(fromOfficeId, row.inventoryItemId)] ?? [];
    const fromLoc = findLoc(fromLocs, destOnly ? null : row.branchLocationId);
    const dest =
      destOnly
        ? {
            branchId: row.branchId,
            branchName: row.branchName ?? 'Office',
            locationId: row.branchLocationId,
            locationName: row.locationName ?? 'Location',
            quantity: row.quantity,
          }
        : row.toBranchId != null && row.toBranchLocationId != null
          ? {
              branchId: row.toBranchId,
              branchName: row.toBranchName ?? 'Office',
              locationId: row.toBranchLocationId,
              locationName: row.toLocationName ?? 'Location',
              quantity: row.quantity,
            }
          : undefined;
    setTransferSource({
      inventoryItemId: row.inventoryItemId,
      itemName: row.itemName ?? `Item #${row.inventoryItemId}`,
      fromBranchId: fromOfficeId,
      fromBranchName: row.branchName ?? officeName,
      fromLocations:
        fromLocs.length > 0
          ? fromLocs.map((l) => ({
              id: l.branchLocationId,
              name: l.name,
              quantityOnHand: l.quantityOnHand,
              parLevel: l.parLevel,
            }))
          : [
              {
                id: row.branchLocationId,
                name: row.locationName ?? 'Location',
                quantityOnHand: fromLoc?.quantityOnHand ?? row.quantity,
                parLevel: fromLoc?.parLevel ?? null,
              },
            ],
      defaultFromLocId: destOnly ? null : row.branchLocationId,
      requestId: row.id,
      dest,
    });
  }

  return (
    <div className="settings-section">
      <p className="settings-section-description">
        {isTransfer || isFill
          ? 'Prefer Main first (down to 0 — that may put the item on the order list back to max), then other locations over par, then other offices over par. Only pull another location below par if Main is empty. To is short of par; uncovered asks show From as —. Locations at or over par are not destinations.'
          : 'Buy at the default location when on-hand (after planned transfers out) is at or below the re-order point. Quantity brings default back to max. The list recalculates when stock or transfers change. Recording an order does not change on-hand — receive does that.'}
      </p>
      {toast && (
        <div className="settings-message settings-success-message" style={{ marginBottom: 12 }}>
          {toast}
        </div>
      )}
      {error && (
        <div className="settings-message settings-error-message" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16, alignItems: 'end' }}>
        <label className="settings-label">
          Office
          <select
            className="settings-input"
            style={{ minWidth: 240 }}
            value={branchId}
            onChange={(e) => {
              const v = e.target.value ? Number(e.target.value) : '';
              setBranchId(v);
              if (typeof v === 'number') {
                try {
                  localStorage.setItem(`${BRANCH_STORAGE_PREFIX}${practiceId}`, String(v));
                } catch {
                  /* ignore */
                }
              }
            }}
          >
            {isTransfer || isFill ? <option value="">All offices</option> : null}
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </label>
        {(isTransfer || isFill) && (
          <label className="settings-label">
            Location
            <select
              className="settings-input"
              style={{ minWidth: 180 }}
              value={locationId}
              onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {isOrder && branchId !== '' && rows.length > 0 ? (
          <button type="button" className="btn primary" onClick={() => setOrderModalOpen(true)}>
            Order
          </button>
        ) : null}
      </div>
      {busy && rows.length === 0 ? (
        <p className="settings-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="settings-muted">Nothing on the {title.toLowerCase()}.</p>
      ) : (
        <div className="settings-table-container">
          <table className="settings-table">
            <thead>
              <tr>
                <th>Item</th>
                {isTransfer || isFill ? (
                  <>
                    <th>From</th>
                    <th>To</th>
                  </>
                ) : (
                  <>
                    {branchId === '' ? <th>Office</th> : null}
                    <th>Location</th>
                  </>
                )}
                <th>Qty</th>
                {isOrder ? <th>On order</th> : null}
                {isTransfer || isFill || isOrder ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const destOnly = row.kind === 'fill';
                const sources = destOnly ? sourcesFor(fillSources, row) : [];
                const fromLocs =
                  isTransfer || isFill || isOrder
                    ? stockMap[stockKey(row.branchId, row.inventoryItemId)]
                    : undefined;
                const fromLoc =
                  isTransfer || isFill
                    ? findLoc(fromLocs, destOnly ? null : row.branchLocationId)
                    : null;
                const toOfficeId = destOnly ? row.branchId : row.toBranchId;
                const toLocId = destOnly ? row.branchLocationId : row.toBranchLocationId;
                const toLocs =
                  (isTransfer || isFill) && toOfficeId != null
                    ? stockMap[stockKey(toOfficeId, row.inventoryItemId)]
                    : undefined;
                const toLoc =
                  (isTransfer || isFill) && toLocId != null
                    ? findLoc(toLocs, toLocId)
                    : null;
                const otherOpen = openOtherId === row.id;
                const orderOpen = openOrderId === row.id;
                const breakdown = orderBreakdowns.find(
                  (b) =>
                    b.inventoryItemId === row.inventoryItemId &&
                    b.branchLocationId === row.branchLocationId
                );
                return (
                  <Fragment key={row.id}>
                    <tr>
                      <td>
                        <strong>{row.itemName ?? `Item #${row.inventoryItemId}`}</strong>
                        {row.itemCode ? (
                          <div className="settings-muted" style={{ fontSize: 12 }}>
                            {row.itemCode}
                          </div>
                        ) : null}
                      </td>
                      {isTransfer || isFill ? (
                        <>
                          <td>
                            {destOnly ? (
                              sources.length > 0 ? (
                                sources.map((s) => (
                                  <div key={`${s.fromBranchId}:${s.fromBranchLocationId}`}>
                                    {placeLabel(s.fromBranchName, s.fromLocationName)} · {s.quantity}
                                  </div>
                                ))
                              ) : (
                                <span className="settings-muted">—</span>
                              )
                            ) : (
                              <>
                                <div>{placeLabel(row.branchName, row.locationName)}</div>
                                {fromLoc ? (
                                  <div style={{ fontSize: 12, marginTop: 2 }}>
                                    {fromLoc.quantityOnHand} on hand
                                    {fromLoc.parLevel != null ? ` / ${fromLoc.parLevel}` : ''}
                                    {' · '}
                                    <ParStatus
                                      onHand={fromLoc.quantityOnHand}
                                      par={fromLoc.parLevel}
                                      isDefault={
                                        defaultLocationId != null &&
                                        fromLoc.branchLocationId === defaultLocationId
                                      }
                                      min={reorderByItemId[row.inventoryItemId] ?? null}
                                    />
                                  </div>
                                ) : null}
                              </>
                            )}
                          </td>
                          <td>
                            {destOnly
                              ? placeLabel(row.branchName, row.locationName)
                              : row.toLocationName || row.toBranchName
                                ? placeLabel(row.toBranchName, row.toLocationName)
                                : '—'}
                            {toLoc ? (
                              <div style={{ fontSize: 12, marginTop: 2 }}>
                                {toLoc.quantityOnHand} on hand
                                {toLoc.parLevel != null ? ` / ${toLoc.parLevel}` : ''}
                                {' · '}
                                <ParStatus onHand={toLoc.quantityOnHand} par={toLoc.parLevel} />
                              </div>
                            ) : null}
                          </td>
                        </>
                      ) : (
                        <>
                          {branchId === '' ? <td>{row.branchName ?? '—'}</td> : null}
                          <td>{row.locationName ?? '—'}</td>
                        </>
                      )}
                      <td>{row.quantity}</td>
                      {isOrder ? (
                        <td>
                          {orderedQtyByItemLoc.get(
                            `${row.inventoryItemId}:${row.branchLocationId}`
                          ) ? (
                            orderedQtyByItemLoc.get(
                              `${row.inventoryItemId}:${row.branchLocationId}`
                            )
                          ) : (
                            <span className="settings-muted">—</span>
                          )}
                        </td>
                      ) : null}
                      {isTransfer || isFill ? (
                        <td>
                          <div className="par-row-actions">
                            <button
                              type="button"
                              className="btn primary"
                              onClick={() => openTransfer(row)}
                            >
                              Transfer
                            </button>
                            <button
                              type="button"
                              className="btn secondary"
                              onClick={() => void toggleOtherStock(row)}
                            >
                              {otherOpen ? 'Hide' : 'Other stock'}
                            </button>
                          </div>
                        </td>
                      ) : null}
                      {isOrder ? (
                        <td>
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() =>
                              setOpenOrderId((prev) => (prev === row.id ? null : row.id))
                            }
                          >
                            {orderOpen ? 'Hide need' : 'Show need'}
                          </button>
                        </td>
                      ) : null}
                    </tr>
                    {isOrder && orderOpen ? (
                      <tr>
                        <td colSpan={branchId === '' ? 5 : 4}>
                          <div className="settings-muted" style={{ marginBottom: 8, fontSize: 13 }}>
                            Order qty brings Main back to max when on-hand (after planned transfers
                            out) is at or below the re-order point.
                          </div>
                          {breakdown ? (
                            <div style={{ display: 'grid', gap: 10 }}>
                              <div>
                                Main: {breakdown.mainOnHand} on hand
                                {breakdown.mainOut > 0
                                  ? ` − ${breakdown.mainOut} planned out = ${breakdown.effectiveOnHand} effective`
                                  : ` · effective ${breakdown.effectiveOnHand}`}
                                {' · '}
                                re-order {breakdown.reorderPoint ?? '—'}
                                {' · '}
                                max {breakdown.max ?? '—'}
                                {' → '}
                                order <strong>{breakdown.quantity}</strong>
                              </div>
                              {breakdown.locationNeeds.length > 0 ? (
                                <table className="settings-table">
                                  <thead>
                                    <tr>
                                      <th>Location needing stock</th>
                                      <th>On hand</th>
                                      <th>Par</th>
                                      <th>Short</th>
                                      <th>From Main</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {breakdown.locationNeeds.map((need) => (
                                      <tr key={need.locationId}>
                                        <td>{need.locationName}</td>
                                        <td>{need.onHand}</td>
                                        <td>{need.par != null ? need.par : '—'}</td>
                                        <td>
                                          <span className="par-short">{need.short}</span>
                                        </td>
                                        <td>{need.coveredFromMain}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              ) : (
                                <p className="settings-muted" style={{ margin: 0 }}>
                                  No other locations in this office are short of par — Main itself
                                  is at or below the re-order point.
                                </p>
                              )}
                            </div>
                          ) : (
                            <p className="settings-muted" style={{ margin: 0 }}>
                              Refresh the list to load the need breakdown for this item.
                            </p>
                          )}
                        </td>
                      </tr>
                    ) : null}
                    {(isTransfer || isFill) && otherOpen ? (
                      <tr>
                        <td colSpan={5}>
                          <div className="settings-muted" style={{ marginBottom: 8, fontSize: 13 }}>
                            Locations for this product — default locations use max / re-order;
                            others use par.
                          </div>
                          <table className="settings-table">
                            <thead>
                              <tr>
                                <th>Office</th>
                                <th>Location</th>
                                <th>On hand</th>
                                <th>Target</th>
                                <th>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(fromLocs ?? []).map((loc) => {
                                const isDef =
                                  loc.isDefault === true ||
                                  (defaultLocationId != null &&
                                    loc.branchLocationId === defaultLocationId);
                                return (
                                  <tr key={`from:${loc.branchLocationId}`}>
                                    <td>{row.branchName ?? 'Office'}</td>
                                    <td>{loc.name}</td>
                                    <td>{loc.quantityOnHand}</td>
                                    <td>
                                      <TargetCell
                                        loc={{ ...loc, isDefault: isDef }}
                                        reorder={reorderByItemId[row.inventoryItemId] ?? null}
                                      />
                                    </td>
                                    <td>
                                      <ParStatus
                                        onHand={loc.quantityOnHand}
                                        par={loc.parLevel}
                                        isDefault={isDef}
                                        min={reorderByItemId[row.inventoryItemId] ?? null}
                                      />
                                    </td>
                                  </tr>
                                );
                              })}
                              {row.toBranchId != null &&
                              row.toBranchId !== row.branchId
                                ? (toLocs ?? []).map((loc) => (
                                    <tr key={`to:${loc.branchLocationId}`}>
                                      <td>{row.toBranchName ?? 'Office'}</td>
                                      <td>{loc.name}</td>
                                      <td>{loc.quantityOnHand}</td>
                                      <td>
                                        <TargetCell loc={loc} reorder={null} />
                                      </td>
                                      <td>
                                        <ParStatus
                                          onHand={loc.quantityOnHand}
                                          par={loc.parLevel}
                                          isDefault={loc.isDefault}
                                        />
                                      </td>
                                    </tr>
                                  ))
                                : null}
                              {otherBusy ? (
                                <tr>
                                  <td colSpan={5} className="settings-muted">
                                    Checking other offices…
                                  </td>
                                </tr>
                              ) : (
                                otherRows.map((extra) => (
                                  <tr key={`${extra.branchId}:${extra.loc.branchLocationId}`}>
                                    <td>{extra.branchName}</td>
                                    <td>{extra.loc.name}</td>
                                    <td>{extra.loc.quantityOnHand}</td>
                                    <td>
                                      <TargetCell loc={extra.loc} reorder={extra.reorder} />
                                    </td>
                                    <td>
                                      <ParStatus
                                        onHand={extra.loc.quantityOnHand}
                                        par={extra.loc.parLevel}
                                        isDefault={extra.loc.isDefault}
                                        min={extra.reorder}
                                      />
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {isOrder ? (
        <div style={{ marginTop: 32 }}>
          <h3 style={{ marginBottom: 8 }}>Orders placed</h3>
          <p className="settings-muted" style={{ marginTop: 0 }}>
            These are purchase records only. Stock increases when the shipment is received.
          </p>
          {purchaseOrders.length === 0 ? (
            <p className="settings-muted">No orders recorded yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {purchaseOrders.map((po) => {
                const open = openOrderId === po.id;
                const when = po.orderedAt ? new Date(po.orderedAt).toLocaleString() : null;
                return (
                  <li
                    key={po.id}
                    style={{
                      padding: '10px 0',
                      borderBottom: '1px solid var(--border, #e5e7eb)',
                    }}
                  >
                    <button
                      type="button"
                      className="btn secondary"
                      style={{ width: '100%', textAlign: 'left' }}
                      onClick={() => setOpenOrderId(open ? null : po.id)}
                    >
                      <span style={{ display: 'block', fontWeight: 600 }}>
                        {po.supplierName ?? 'Distributor'}
                        {po.branchName ? ` · ${po.branchName}` : ''}
                      </span>
                      <span style={{ display: 'block', fontSize: 13, opacity: 0.8 }}>
                        {[
                          po.orderedByName ? `Ordered by ${po.orderedByName}` : null,
                          when,
                          `${po.lines.length} item${po.lines.length === 1 ? '' : 's'}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </button>
                    {open ? (
                      <ul style={{ listStyle: 'none', padding: '8px 0 0 8px', margin: 0 }}>
                        {po.lines.map((line) => (
                          <li key={line.id} style={{ fontSize: 14, padding: '4px 0' }}>
                            {line.itemName ?? `Item #${line.inventoryItemId}`} × {line.quantity}
                            {line.locationName ? ` · ${line.locationName}` : ''}
                            {line.itemCode ? (
                              <span className="settings-muted"> · {line.itemCode}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
      {isOrder && orderModalOpen && branchId !== '' ? (
        <PlaceOrderModal
          open
          practiceId={practiceId}
          branchId={Number(branchId)}
          officeName={officeName}
          suppliers={suppliers}
          lines={rows.map((row) => ({
            key: `${row.id}`,
            inventoryItemId: row.inventoryItemId,
            itemName: row.itemName ?? `Item #${row.inventoryItemId}`,
            itemCode: row.itemCode,
            branchLocationId: row.branchLocationId,
            locationName: row.locationName ?? 'Location',
            quantity: row.quantity,
          }))}
          onClose={() => setOrderModalOpen(false)}
          onPlaced={() => {
            setToast('Order recorded. Inventory is unchanged until receive.');
            window.setTimeout(() => setToast(null), 3500);
            void reload();
          }}
        />
      ) : null}
      <ParTransferModal
        open={transferSource != null}
        practiceId={practiceId}
        branches={branches}
        source={transferSource}
        onClose={() => setTransferSource(null)}
        onMoved={() => {
          const id = transferSource?.requestId;
          const finish = () => {
            void reload();
            setToast('Transfer complete');
            window.setTimeout(() => setToast(null), 2500);
          };
          if (id != null) {
            void resolveStockRequest(practiceId, id, 'done').finally(finish);
          } else {
            finish();
          }
        }}
      />
    </div>
  );
}
