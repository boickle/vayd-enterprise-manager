import { useEffect, useMemo, useState } from 'react';
import {
  getInventoryBranchStock,
  listInventoryBranchLocations,
  type InventoryBranchLocation,
  type PracticeBranch,
} from '../../api/branchInventory';
import { createStockRequest, transferBatch } from '../../api/inventoryOps';
import { appConfirm } from '../../utils/appDialog';

export type TransferModalLoc = {
  id: number;
  name: string;
  quantityOnHand: number;
  parLevel: number | null;
};

export type TransferModalSource = {
  inventoryItemId: number;
  itemName: string;
  fromBranchId: number;
  fromBranchName: string;
  fromLocations: TransferModalLoc[];
  defaultFromLocId: number | null;
  dest?: {
    branchId: number;
    branchName: string;
    locationId: number;
    locationName: string;
    quantity?: number;
  };
  requestId?: number;
};

function surplusQty(onHand: number, par: number | null): number | null {
  if (par == null || !Number.isFinite(Number(par))) return null;
  const n = Number(onHand) - Number(par);
  return n > 0 ? n : null;
}

function shortQty(onHand: number, par: number | null): number | null {
  if (par == null || !Number.isFinite(Number(par))) return null;
  const n = Number(par) - Number(onHand);
  return n > 0 ? n : null;
}

type Props = {
  open: boolean;
  practiceId: number;
  branches: PracticeBranch[];
  source: TransferModalSource | null;
  onClose: () => void;
  onMoved: () => void;
  onQueued?: () => void;
};

export default function ParTransferModal({
  open,
  practiceId,
  branches,
  source,
  onClose,
  onMoved,
  onQueued,
}: Props) {
  const [fromBranchId, setFromBranchId] = useState<number | ''>('');
  const [fromLocId, setFromLocId] = useState<number | ''>('');
  const [toBranchId, setToBranchId] = useState<number | ''>('');
  const [toLocId, setToLocId] = useState<number | ''>('');
  const [toLocations, setToLocations] = useState<InventoryBranchLocation[]>([]);
  const [fromLocations, setFromLocations] = useState<TransferModalLoc[]>([]);
  const [qty, setQty] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeBranches = useMemo(
    () => branches.filter((b) => b.isActive !== false),
    [branches]
  );
  const fillMode = source?.dest != null;

  useEffect(() => {
    if (!open || !source) return;
    setError(null);
    setFromBranchId(source.fromBranchId);
    setFromLocations(source.fromLocations);
    const destId = source.dest?.locationId;
    const startLoc =
      source.defaultFromLocId != null &&
      source.fromLocations.some((l) => l.id === source.defaultFromLocId)
        ? source.defaultFromLocId
        : (source.fromLocations.find((l) => l.id !== destId && l.quantityOnHand > 0)?.id ??
          source.fromLocations.find((l) => l.id !== destId)?.id ??
          '');
    setFromLocId(startLoc === '' ? '' : startLoc);
    if (source.dest) {
      setToBranchId(source.dest.branchId);
      setToLocId(source.dest.locationId);
      const start = source.fromLocations.find((l) => l.id === startLoc);
      const need = source.dest.quantity;
      const available = start?.quantityOnHand ?? 0;
      const extra = start ? surplusQty(start.quantityOnHand, start.parLevel) : null;
      const suggested =
        need != null && need > 0
          ? Math.min(need, available > 0 ? available : need)
          : (extra ?? (available > 0 ? available : 1));
      setQty(String(suggested || 1));
      return;
    }
    const otherOffice = activeBranches.find((b) => b.id !== source.fromBranchId);
    setToBranchId(otherOffice?.id ?? source.fromBranchId);
    const start = source.fromLocations.find((l) => l.id === startLoc);
    const extra = start ? surplusQty(start.quantityOnHand, start.parLevel) : null;
    setQty(String(extra ?? (start && start.quantityOnHand > 0 ? start.quantityOnHand : 1)));
  }, [open, source, activeBranches]);

  useEffect(() => {
    if (!open || !source || fromBranchId === '') return;
    const destId = source.dest?.locationId;
    void getInventoryBranchStock(practiceId, Number(fromBranchId), source.inventoryItemId)
      .then((stock) => {
        const locs = (stock.locations ?? [])
          .map((loc) => ({
            id: loc.branchLocationId,
            name: loc.name,
            quantityOnHand: Number(loc.quantityOnHand ?? 0),
            parLevel: loc.parLevel ?? null,
          }))
          .filter((loc) => loc.id !== destId);
        if (locs.length) {
          setFromLocations(locs);
          setFromLocId((prev) =>
            prev !== '' && locs.some((l) => l.id === prev)
              ? prev
              : (locs.find((l) => l.quantityOnHand > 0)?.id ?? locs[0]?.id ?? '')
          );
        } else if (Number(fromBranchId) !== source.fromBranchId) {
          setFromLocations([]);
          setFromLocId('');
        }
      })
      .catch(() => {
        /* keep passed-in locations */
      });
  }, [open, source, practiceId, fromBranchId]);

  useEffect(() => {
    if (!open || fillMode || toBranchId === '') {
      if (fillMode && source?.dest) {
        setToLocId(source.dest.locationId);
      }
      return;
    }
    void listInventoryBranchLocations(practiceId, Number(toBranchId)).then((locs) => {
      const active = locs.filter((l) => l.isActive !== false);
      setToLocations(active);
      setToLocId((prev) => {
        const sameOffice = source != null && Number(toBranchId) === source.fromBranchId;
        const choices = sameOffice ? active.filter((l) => l.id !== fromLocId) : active;
        if (prev !== '' && choices.some((l) => l.id === prev)) return prev;
        return choices[0]?.id ?? '';
      });
    });
  }, [open, fillMode, practiceId, toBranchId, fromLocId, source]);

  if (!open || !source) return null;
  const item = source;

  const fromLoc = fromLocations.find((l) => l.id === fromLocId);
  const onHand = fromLoc?.quantityOnHand ?? 0;
  const fromOfficeName =
    activeBranches.find((b) => b.id === fromBranchId)?.name ?? item.fromBranchName;
  const toOfficeName = fillMode
    ? item.dest?.branchName ?? 'destination office'
    : (activeBranches.find((b) => b.id === toBranchId)?.name ?? 'destination office');
  const toLocName = fillMode
    ? item.dest?.locationName ?? 'location'
    : (toLocations.find((l) => l.id === toLocId)?.name ?? 'location');
  const destBranchId = fillMode ? item.dest!.branchId : toBranchId;
  const destLocId = fillMode ? item.dest!.locationId : toLocId;
  const crossOffice =
    fromBranchId !== '' && destBranchId !== '' && fromBranchId !== destBranchId;

  async function moveNow() {
    if (fromBranchId === '' || fromLocId === '' || destBranchId === '' || destLocId === '') {
      setError('Choose from and to locations');
      return;
    }
    if (fromLocId === destLocId) {
      setError('From and to locations must differ');
      return;
    }
    const quantity = Number(qty);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError('Quantity must be positive');
      return;
    }
    if (quantity > onHand) {
      setError(`Only ${onHand} on hand at the source`);
      return;
    }
    const sourceShort = fromLoc ? shortQty(fromLoc.quantityOnHand, fromLoc.parLevel) : null;
    const officeShort = fromLocations.some((l) => shortQty(l.quantityOnHand, l.parLevel) != null);
    if (crossOffice && (sourceShort != null || officeShort)) {
      const ok = await appConfirm({
        title: 'Source office is under par',
        message: `${fromOfficeName} is short on ${item.itemName}. Transfer anyway?`,
        confirmLabel: 'Transfer anyway',
        cancelLabel: 'Cancel',
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      const note = crossOffice
        ? `Par transfer: ${fromOfficeName} → ${toOfficeName} (${toLocName})`
        : `Par transfer: ${fromLoc?.name ?? 'location'} → ${toLocName}`;
      await transferBatch(practiceId, Number(fromBranchId), {
        fromBranchLocationId: Number(fromLocId),
        toBranchLocationId: Number(destLocId),
        lines: [{ inventoryItemId: item.inventoryItemId, quantity }],
        note,
      });
      onMoved();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Transfer failed');
    } finally {
      setBusy(false);
    }
  }

  async function addToList() {
    if (fromLocId === '' || fromBranchId === '') {
      setError('Choose a source location');
      return;
    }
    const quantity = Number(qty);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError('Quantity must be positive');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createStockRequest(practiceId, {
        kind: 'transfer',
        branchId: Number(fromBranchId),
        branchLocationId: Number(fromLocId),
        toBranchId: item.dest?.branchId,
        toBranchLocationId: item.dest?.locationId,
        inventoryItemId: item.inventoryItemId,
        quantity,
      });
      onQueued?.();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not add to transfer list');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-modal-overlay" onClick={onClose} role="presentation">
      <div
        className="settings-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="par-transfer-title"
      >
        <div className="settings-modal-header">
          <h3 id="par-transfer-title">
            {fillMode
              ? `Transfer to ${source.dest?.locationName ?? 'location'}`
              : `Transfer ${source.itemName}`}
          </h3>
          <button type="button" className="settings-modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="settings-modal-body">
          <p className="settings-muted" style={{ marginTop: 0 }}>
            {fillMode
              ? `Fill ${source.itemName} at ${source.dest?.branchName ?? ''} (${source.dest?.locationName}). Pick a location to pull from.`
              : `Move from ${source.fromBranchName} to another location or office.`}
          </p>
          {error && (
            <div className="settings-message settings-error-message" style={{ marginBottom: 10 }}>
              {error}
            </div>
          )}
          {fillMode ? (
            <label className="settings-label">
              From office
              <select
                className="settings-input"
                value={fromBranchId}
                onChange={(e) => setFromBranchId(e.target.value ? Number(e.target.value) : '')}
              >
                {activeBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.id === source.dest?.branchId ? ' (this office)' : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="settings-label" style={{ marginTop: fillMode ? 10 : 0 }}>
            From location
            <select
              className="settings-input"
              value={fromLocId}
              onChange={(e) => {
                const next = e.target.value ? Number(e.target.value) : '';
                setFromLocId(next);
                const loc = fromLocations.find((l) => l.id === next);
                if (loc) {
                  const extra = surplusQty(loc.quantityOnHand, loc.parLevel);
                  const need = source.dest?.quantity;
                  const suggested =
                    need != null && need > 0
                      ? Math.min(need, loc.quantityOnHand > 0 ? loc.quantityOnHand : need)
                      : (extra ?? (loc.quantityOnHand > 0 ? loc.quantityOnHand : 1));
                  setQty(String(suggested || 1));
                }
              }}
            >
              {fromLocations.length === 0 ? (
                <option value="">No locations</option>
              ) : (
                fromLocations.map((l) => {
                  const extra = surplusQty(l.quantityOnHand, l.parLevel);
                  const short = shortQty(l.quantityOnHand, l.parLevel);
                  return (
                    <option key={l.id} value={l.id}>
                      {l.name} — {l.quantityOnHand} on hand
                      {extra != null ? ` (Over ${extra})` : ''}
                      {short != null ? ` (short ${short})` : ''}
                    </option>
                  );
                })
              )}
            </select>
          </label>
          {fillMode ? (
            <p className="settings-muted" style={{ marginTop: 10 }}>
              To {toOfficeName} · {toLocName}
              {source.dest?.quantity != null ? ` · short ${source.dest.quantity}` : ''}
            </p>
          ) : (
            <>
              <label className="settings-label" style={{ marginTop: 10 }}>
                To office
                <select
                  className="settings-input"
                  value={toBranchId}
                  onChange={(e) => setToBranchId(e.target.value ? Number(e.target.value) : '')}
                >
                  {activeBranches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.id === source.fromBranchId ? ' (this office)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settings-label" style={{ marginTop: 10 }}>
                To location
                <select
                  className="settings-input"
                  value={toLocId}
                  onChange={(e) => setToLocId(e.target.value ? Number(e.target.value) : '')}
                >
                  {toLocations.map((l) => (
                    <option key={l.id} value={l.id} disabled={l.id === fromLocId}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label className="settings-label" style={{ marginTop: 10 }}>
            Quantity
            <input
              className="settings-input"
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </label>
          {crossOffice && fromLoc && shortQty(fromLoc.quantityOnHand, fromLoc.parLevel) != null ? (
            <p className="par-transfer-hint par-transfer-hint--partial" style={{ marginTop: 12 }}>
              {fromOfficeName} is under par at {fromLoc.name}. Transferring will leave them shorter.
            </p>
          ) : null}
          <div className="settings-modal-actions">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void moveNow()}>
              {busy ? 'Moving…' : fillMode ? 'Transfer' : 'Move now'}
            </button>
            {!fillMode ? (
              <button type="button" className="btn secondary" disabled={busy} onClick={() => void addToList()}>
                Add to transfer list
              </button>
            ) : null}
            <button type="button" className="btn secondary" disabled={busy} onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
