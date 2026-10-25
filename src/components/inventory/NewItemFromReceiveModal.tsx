import { useEffect, useState } from 'react';
import { createItemFromReceive } from '../../api/inventoryOps';
import './StockLotPicker.css';

const SELL_UNIT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '(not set)' },
  { value: 'bottle', label: 'Bottle' },
  { value: 'tablet', label: 'Tablet' },
  { value: 'capsule', label: 'Capsule' },
  { value: 'package', label: 'Package' },
  { value: 'ml', label: 'mL' },
  { value: 'gram', label: 'Gram' },
  { value: 'each', label: 'Each' },
  { value: 'other', label: 'Other' },
];

export type NewItemDefaults = {
  name: string;
  costPerUnit?: number | null;
  sellUnitType?: string | null;
  trackLots?: boolean;
};

type Props = {
  open: boolean;
  practiceId: number;
  defaults: NewItemDefaults;
  onClose: () => void;
  onCreated: (item: { id: number; name: string }) => void | Promise<void>;
};

/** Add a stock item while receiving. It goes to Cost Reviews when the shipment is finalized. */
export default function NewItemFromReceiveModal({
  open,
  practiceId,
  defaults,
  onClose,
  onCreated,
}: Props) {
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const [price, setPrice] = useState('');
  const [sellUnitType, setSellUnitType] = useState('');
  const [trackLots, setTrackLots] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(defaults.name);
    setCost(defaults.costPerUnit != null ? String(defaults.costPerUnit) : '');
    setPrice('');
    setSellUnitType(defaults.sellUnitType ?? '');
    setTrackLots(defaults.trackLots ?? true);
  }, [open, defaults]);

  if (!open) return null;

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required');
      return;
    }
    const costNum = cost.trim() === '' ? null : Number(cost);
    if (costNum != null && (!Number.isFinite(costNum) || costNum < 0)) {
      setError('Cost must be 0 or more');
      return;
    }
    const priceNum = price.trim() === '' ? null : Number(price);
    if (priceNum != null && (!Number.isFinite(priceNum) || priceNum < 0)) {
      setError('Price must be 0 or more');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await createItemFromReceive(practiceId, {
        name: trimmed,
        cost: costNum,
        price: priceNum,
        sellUnitType: sellUnitType || null,
        trackLots,
      });
      await onCreated({ id: created.id, name: created.name ?? trimmed });
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not add item');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add new item"
      className="stock-lot-add-modal"
      onClick={onClose}
    >
      <div className="stock-lot-add-modal__card" onClick={(e) => e.stopPropagation()}>
        <h3>Add new item</h3>
        <p className="stock-lot-add-modal__item">
          Goes on Cost Reviews when this shipment is finalized so the inventory manager can check
          its cost and price.
        </p>
        <div className="stock-lot-add-modal__fields">
          <label className="settings-label" style={{ gridColumn: '1 / -1' }}>
            Name *
            <input
              className="settings-input"
              value={name}
              disabled={saving}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Feliway Spray - 60 mL bottle"
              autoFocus
            />
          </label>
          <label className="settings-label">
            Cost per unit
            <input
              className="settings-input"
              inputMode="decimal"
              value={cost}
              disabled={saving}
              onChange={(e) => setCost(e.target.value)}
            />
          </label>
          <label className="settings-label">
            Sell price (optional)
            <input
              className="settings-input"
              inputMode="decimal"
              value={price}
              disabled={saving}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="Set later on Cost Reviews"
            />
          </label>
          <label className="settings-label">
            Sold by
            <select
              className="settings-input"
              value={sellUnitType}
              disabled={saving}
              onChange={(e) => setSellUnitType(e.target.value)}
            >
              {SELL_UNIT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label
            className="settings-label"
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <input
              type="checkbox"
              checked={trackLots}
              disabled={saving}
              onChange={(e) => setTrackLots(e.target.checked)}
            />
            Track lots and expiration
          </label>
        </div>
        {error ? <p className="stock-lot-add-modal__err">{error}</p> : null}
        <div className="stock-lot-add-modal__actions">
          <button type="button" className="btn secondary" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn" disabled={saving} onClick={() => void submit()}>
            {saving ? 'Saving…' : 'Add item'}
          </button>
        </div>
      </div>
    </div>
  );
}
