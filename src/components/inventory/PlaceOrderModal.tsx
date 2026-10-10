import { useMemo, useState } from 'react';
import { createPurchaseOrder, type InventorySupplier } from '../../api/inventoryOps';

export type PlaceOrderLine = {
  key: string;
  inventoryItemId: number;
  itemName: string;
  itemCode: string | null;
  branchLocationId: number;
  locationName: string;
  quantity: number;
};

type Props = {
  open: boolean;
  practiceId: number;
  branchId: number;
  officeName: string;
  suppliers: InventorySupplier[];
  lines: PlaceOrderLine[];
  onClose: () => void;
  onPlaced: () => void;
};

export default function PlaceOrderModal({
  open,
  practiceId,
  branchId,
  officeName,
  suppliers,
  lines,
  onClose,
  onPlaced,
}: Props) {
  const active = useMemo(
    () => suppliers.filter((s) => s.isActive !== false),
    [suppliers]
  );
  const [supplierId, setSupplierId] = useState<number | ''>(
    () => active[0]?.id ?? ''
  );
  const [qtyByKey, setQtyByKey] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.key, String(l.quantity)]))
  );
  const [include, setInclude] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(lines.map((l) => [l.key, true]))
  );
  const [orderDate, setOrderDate] = useState(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function place() {
    if (supplierId === '') {
      setError('Choose a distributor');
      return;
    }
    if (!orderDate) {
      setError('Choose the order date');
      return;
    }
    const chosen = lines
      .filter((l) => include[l.key] !== false)
      .map((l) => ({
        inventoryItemId: l.inventoryItemId,
        branchLocationId: l.branchLocationId,
        quantity: Number(qtyByKey[l.key] ?? l.quantity),
      }))
      .filter((l) => Number.isFinite(l.quantity) && l.quantity > 0);
    if (chosen.length === 0) {
      setError('Select at least one item with a quantity');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createPurchaseOrder(practiceId, {
        branchId,
        supplierId: Number(supplierId),
        orderedAt: orderDate,
        lines: chosen,
      });
      onPlaced();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not place order');
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
        aria-labelledby="place-order-title"
      >
        <div className="settings-modal-header">
          <h3 id="place-order-title">Place order</h3>
          <button type="button" className="settings-modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="settings-modal-body">
          <p style={{ marginTop: 0, marginBottom: 12 }}>
            Enter the <strong>quantity you actually ordered</strong> for {officeName}. This only
            records the purchase — <strong>it does not update on-hand or par counts</strong>.
            Counts change when you receive the shipment.
          </p>
          {error && (
            <div className="settings-message settings-error-message" style={{ marginBottom: 10 }}>
              {error}
            </div>
          )}
          <label className="settings-label">
            Order date
            <input
              className="settings-input"
              type="date"
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
            />
          </label>
          <label className="settings-label" style={{ marginTop: 10 }}>
            Distributor
            <select
              className="settings-input"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : '')}
            >
              {active.length === 0 ? <option value="">No distributors</option> : null}
              {active.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <div style={{ marginTop: 14 }}>
            <div
              className="settings-muted"
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 6,
              }}
            >
              Qty actually ordered
            </div>
            {lines.map((line) => (
              <label
                key={line.key}
                className="settings-checkbox-item"
                style={{ alignItems: 'center', marginBottom: 8 }}
              >
                <input
                  type="checkbox"
                  checked={include[line.key] !== false}
                  onChange={(e) =>
                    setInclude((prev) => ({ ...prev, [line.key]: e.target.checked }))
                  }
                />
                <span style={{ flex: 1 }}>
                  <strong>{line.itemName}</strong>
                  {line.itemCode ? (
                    <span className="settings-muted"> · {line.itemCode}</span>
                  ) : null}
                  <div className="settings-muted" style={{ fontSize: 12 }}>
                    {line.locationName}
                    {line.quantity > 0 ? ` · need ${line.quantity}` : ''}
                  </div>
                </span>
                <input
                  className="settings-input"
                  style={{ width: 88 }}
                  inputMode="decimal"
                  disabled={include[line.key] === false}
                  value={qtyByKey[line.key] ?? ''}
                  onChange={(e) =>
                    setQtyByKey((prev) => ({ ...prev, [line.key]: e.target.value }))
                  }
                  aria-label={`${line.itemName} quantity actually ordered`}
                />
              </label>
            ))}
          </div>
          <div className="settings-modal-actions">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void place()}>
              {busy ? 'Saving…' : 'Record order'}
            </button>
            <button type="button" className="btn secondary" disabled={busy} onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
