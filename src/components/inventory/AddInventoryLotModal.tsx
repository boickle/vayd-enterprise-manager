import { useEffect, useState } from 'react';
import {
  addInventoryLot,
  listInventoryBranchLocations,
  listPracticeBranches,
  type InventoryBranchLocation,
  type InventoryLotBalance,
  type PracticeBranch,
} from '../../api/branchInventory';

type Props = {
  open: boolean;
  practiceId: number;
  inventoryItemId: number;
  itemName?: string | null;
  defaultBranchId?: number | null;
  defaultLocationId?: number | null;
  /** Prefill QOH so the new lot shows up in pickers that hide zero balances. */
  defaultQuantity?: number;
  requireLotNumber?: boolean;
  onClose: () => void;
  onCreated: (lot: InventoryLotBalance) => void;
};

/**
 * Quick “add a bottle here” dialog for invoice / checkout lot pickers.
 * Prefills the current branch + location when the invoice already has them.
 */
export default function AddInventoryLotModal({
  open,
  practiceId,
  inventoryItemId,
  itemName,
  defaultBranchId,
  defaultLocationId,
  defaultQuantity = 1,
  requireLotNumber = false,
  onClose,
  onCreated,
}: Props) {
  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [locations, setLocations] = useState<InventoryBranchLocation[]>([]);
  const [branchId, setBranchId] = useState<number | ''>('');
  const [locationId, setLocationId] = useState<number | ''>('');
  const [lotNumber, setLotNumber] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [quantity, setQuantity] = useState(String(Math.max(0, defaultQuantity)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingBranches, setLoadingBranches] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLotNumber('');
    setExpirationDate('');
    setQuantity(String(Math.max(0, defaultQuantity)));
    setBranchId(defaultBranchId != null ? defaultBranchId : '');
    setLocationId(defaultLocationId != null ? defaultLocationId : '');
    setLoadingBranches(true);
    void listPracticeBranches(practiceId)
      .then((rows) => setBranches(rows.filter((b) => b.isActive !== false)))
      .catch(() => setBranches([]))
      .finally(() => setLoadingBranches(false));
  }, [open, practiceId, defaultBranchId, defaultLocationId, defaultQuantity]);

  useEffect(() => {
    if (!open || branchId === '') {
      setLocations([]);
      return;
    }
    let canceled = false;
    void listInventoryBranchLocations(practiceId, Number(branchId))
      .then((rows) => {
        if (canceled) return;
        setLocations(rows);
        if (defaultLocationId != null && rows.some((r) => r.id === defaultLocationId)) {
          setLocationId(defaultLocationId);
          return;
        }
        const def = rows.find((r) => r.isDefault) ?? rows[0];
        setLocationId(def?.id ?? '');
      })
      .catch(() => {
        if (!canceled) {
          setLocations([]);
          setLocationId('');
        }
      });
    return () => {
      canceled = true;
    };
  }, [open, practiceId, branchId, defaultLocationId]);

  if (!open) return null;

  async function submit() {
    if (branchId === '' || locationId === '') {
      setError('Branch and location are required');
      return;
    }
    if (requireLotNumber && !lotNumber.trim()) {
      setError('Lot number is required for this item');
      return;
    }
    if (!expirationDate.trim()) {
      setError('An expiration date is required');
      return;
    }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty < 0) {
      setError('Enter a valid quantity on hand');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await addInventoryLot(practiceId, {
        inventoryItemId,
        branchId: Number(branchId),
        branchLocationId: Number(locationId),
        lotNumber: lotNumber.trim(),
        expirationDate: expirationDate || null,
        quantityOnHand: qty,
      });
      onCreated(created);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not add lot');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add lot"
      className="stock-lot-add-modal"
      onClick={onClose}
    >
      <div className="stock-lot-add-modal__card" onClick={(e) => e.stopPropagation()}>
        <h3>Add lot</h3>
        {itemName ? <p className="stock-lot-add-modal__item">{itemName}</p> : null}
        <div className="stock-lot-add-modal__fields">
          <label className="settings-label">
            Branch
            <select
              className="settings-input"
              value={branchId}
              disabled={loadingBranches || saving}
              onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">{loadingBranches ? 'Loading…' : 'Select…'}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-label">
            Location
            <select
              className="settings-input"
              value={locationId}
              disabled={branchId === '' || saving}
              onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">Select…</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                  {loc.code ? ` (${loc.code})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-label">
            Lot number{requireLotNumber ? ' *' : ' (optional)'}
            <input
              className="settings-input"
              value={lotNumber}
              disabled={saving}
              onChange={(e) => setLotNumber(e.target.value)}
              required={requireLotNumber}
              autoFocus
            />
          </label>
          <label className="settings-label">
            Expiration *
            <input
              className="settings-input"
              type="date"
              value={expirationDate}
              disabled={saving}
              onChange={(e) => setExpirationDate(e.target.value)}
              required
            />
          </label>
          <label className="settings-label">
            Quantity on hand
            <input
              className="settings-input"
              inputMode="decimal"
              value={quantity}
              disabled={saving}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
        </div>
        {error ? <p className="stock-lot-add-modal__err">{error}</p> : null}
        <div className="stock-lot-add-modal__actions">
          <button type="button" className="btn secondary" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn" disabled={saving} onClick={() => void submit()}>
            {saving ? 'Saving…' : 'Add lot'}
          </button>
        </div>
      </div>
    </div>
  );
}
