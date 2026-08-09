import { useState } from 'react';
import {
  createQuantityPriceBreak,
  updateQuantityPriceBreak,
  deleteQuantityPriceBreak,
  type ItemType,
  type QuantityPriceBreak,
  type InventoryItem,
  type Lab,
  type Procedure,
} from '../../api/quantityPriceBreaks';

type Props = {
  itemType: ItemType;
  itemId: number;
  practiceId: number;
  item: InventoryItem | Lab | Procedure;
  priceBreaks: QuantityPriceBreak[];
  onChanged: () => void | Promise<void>;
};

function itemCost(item: InventoryItem | Lab | Procedure): number | null {
  const raw = (item as { cost?: unknown }).cost;
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export default function QuantityPriceBreaksEditor({
  itemType,
  itemId,
  practiceId,
  item,
  priceBreaks,
  onChanged,
}: Props) {
  const [editing, setEditing] = useState<QuantityPriceBreak | null>(null);
  const [creating, setCreating] = useState<{
    price: string;
    markup: string;
    lowQuantity: string;
    highQuantity: string;
    isActive: boolean;
  } | null>(null);
  const [priceManuallyEdited, setPriceManuallyEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const cost = itemCost(item);

  async function saveEdit(id: number) {
    if (!editing) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await updateQuantityPriceBreak(id, {
        price: editing.price,
        markup: editing.markup,
        lowQuantity: editing.lowQuantity,
        highQuantity: editing.highQuantity,
        isActive: editing.isActive,
      });
      setSuccess('Price break updated');
      setTimeout(() => setSuccess(null), 3000);
      setEditing(null);
      await onChanged();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      setError(e?.response?.data?.message || e?.message || 'Failed to update price break');
    } finally {
      setSaving(false);
    }
  }

  async function createBreak() {
    if (!creating) return;
    const price = creating.price?.trim();
    const lowQty = creating.lowQuantity?.trim();
    const highQty = creating.highQuantity?.trim();
    if (!price || !lowQty || !highQty) {
      setError('Please fill in Price, Low Quantity, and High Quantity');
      return;
    }
    const priceNum = Number(price);
    const lowQtyNum = Number(lowQty);
    const highQtyNum = Number(highQty);
    if (isNaN(priceNum) || priceNum < 0) {
      setError('Price must be a valid number >= 0');
      return;
    }
    if (isNaN(lowQtyNum) || lowQtyNum < 1) {
      setError('Low Quantity must be >= 1');
      return;
    }
    if (isNaN(highQtyNum) || highQtyNum < 1) {
      setError('High Quantity must be >= 1');
      return;
    }
    if (lowQtyNum > highQtyNum) {
      setError('Low Quantity must be <= High Quantity');
      return;
    }
    const markupValue = creating.markup?.trim() ? Number(creating.markup) : null;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await createQuantityPriceBreak(
        itemType,
        itemId,
        practiceId,
        priceNum,
        lowQtyNum,
        highQtyNum,
        markupValue,
        creating.isActive
      );
      setSuccess('Price break created');
      setTimeout(() => setSuccess(null), 3000);
      setCreating(null);
      await onChanged();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      setError(e?.response?.data?.message || e?.message || 'Failed to create price break');
    } finally {
      setSaving(false);
    }
  }

  async function removeBreak(id: number) {
    if (!confirm('Delete this price break?')) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await deleteQuantityPriceBreak(id);
      setSuccess('Price break deleted');
      setTimeout(() => setSuccess(null), 3000);
      await onChanged();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      setError(e?.response?.data?.message || e?.message || 'Failed to delete price break');
    } finally {
      setSaving(false);
    }
  }

  const sorted = [...priceBreaks].sort((a, b) => a.lowQuantity - b.lowQuantity);

  return (
    <div>
      <h4 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>
        Quantity price breaks (practice)
      </h4>
      <p className="settings-muted" style={{ marginBottom: 12, fontSize: 13 }}>
        Tier unit prices by quantity. Applied at checkout for this catalog item.
      </p>

      {error && (
        <div className="settings-message settings-error-message" style={{ marginBottom: 12 }}>
          {error}
          <button type="button" onClick={() => setError(null)} className="settings-close">
            ×
          </button>
        </div>
      )}
      {success && (
        <div className="settings-message settings-success-message" style={{ marginBottom: 12 }}>
          {success}
          <button type="button" onClick={() => setSuccess(null)} className="settings-close">
            ×
          </button>
        </div>
      )}

      {sorted.length === 0 ? (
        <p className="settings-muted">No tiers configured.</p>
      ) : (
        <div className="settings-table-container">
          <table className="settings-table">
            <thead>
              <tr>
                <th>Low Qty</th>
                <th>High Qty</th>
                <th>Price</th>
                <th>Markup %</th>
                <th>Active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((pb) => (
                <tr key={pb.id}>
                  {editing?.id === pb.id ? (
                    <>
                      <td>
                        <input
                          type="number"
                          className="settings-input"
                          value={editing.lowQuantity}
                          min={1}
                          style={{ width: 80 }}
                          onChange={(e) =>
                            setEditing({ ...editing, lowQuantity: Number(e.target.value) })
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          className="settings-input"
                          value={editing.highQuantity}
                          min={1}
                          style={{ width: 80 }}
                          onChange={(e) =>
                            setEditing({ ...editing, highQuantity: Number(e.target.value) })
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          className="settings-input"
                          value={editing.price}
                          min={0}
                          step="0.01"
                          style={{ width: 100 }}
                          onChange={(e) =>
                            setEditing({ ...editing, price: Number(e.target.value) })
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          className="settings-input"
                          value={editing.markup ?? ''}
                          step="0.1"
                          style={{ width: 100 }}
                          onChange={(e) => {
                            const markupValue =
                              e.target.value === '' ? null : Number(e.target.value);
                            const updated = { ...editing, markup: markupValue };
                            if (markupValue != null && cost != null) {
                              updated.price =
                                Math.round(cost * (1 + markupValue / 100) * 100) / 100;
                            }
                            setEditing(updated);
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={editing.isActive}
                          onChange={(e) =>
                            setEditing({ ...editing, isActive: e.target.checked })
                          }
                        />
                      </td>
                      <td>
                        <div className="settings-action-buttons">
                          <button
                            type="button"
                            className="btn"
                            disabled={saving}
                            onClick={() => void saveEdit(pb.id)}
                          >
                            {saving ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            type="button"
                            className="btn secondary"
                            disabled={saving}
                            onClick={() => setEditing(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{pb.lowQuantity}</td>
                      <td>{pb.highQuantity === 999 ? '∞' : pb.highQuantity}</td>
                      <td>${Number(pb.price).toFixed(2)}</td>
                      <td>{pb.markup != null ? `${Number(pb.markup).toFixed(1)}%` : '—'}</td>
                      <td>{pb.isActive ? 'Yes' : 'No'}</td>
                      <td>
                        <div className="settings-action-buttons">
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => setEditing(pb)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn secondary"
                            disabled={saving}
                            onClick={() => void removeBreak(pb.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!creating && !editing && (
        <div className="settings-action-bar" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setPriceManuallyEdited(false);
              setCreating({
                price: '',
                markup: '',
                lowQuantity: '',
                highQuantity: '',
                isActive: true,
              });
            }}
          >
            Add price break
          </button>
        </div>
      )}

      {creating && (
        <div className="settings-card" style={{ marginTop: 16, background: '#f8fdfa' }}>
          <h4 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>New price break</h4>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div>
              <label className="settings-label">Low quantity</label>
              <input
                type="number"
                className="settings-input"
                min={1}
                value={creating.lowQuantity}
                onChange={(e) => setCreating({ ...creating, lowQuantity: e.target.value })}
              />
            </div>
            <div>
              <label className="settings-label">High quantity</label>
              <input
                type="number"
                className="settings-input"
                min={1}
                placeholder="999"
                value={creating.highQuantity}
                onChange={(e) => setCreating({ ...creating, highQuantity: e.target.value })}
              />
            </div>
            <div>
              <label className="settings-label">Price</label>
              <input
                type="number"
                className="settings-input"
                min={0}
                step="0.01"
                value={creating.price}
                onChange={(e) => {
                  setPriceManuallyEdited(true);
                  setCreating({ ...creating, price: e.target.value });
                }}
              />
            </div>
            <div>
              <label className="settings-label">Markup % (optional)</label>
              <input
                type="number"
                className="settings-input"
                step="0.1"
                value={creating.markup}
                onChange={(e) => {
                  const markupValue = e.target.value;
                  setCreating({ ...creating, markup: markupValue });
                  if (markupValue && cost != null && !priceManuallyEdited) {
                    const markupPercent = Number(markupValue);
                    if (!isNaN(markupPercent)) {
                      const calculated =
                        Math.round(cost * (1 + markupPercent / 100) * 100) / 100;
                      setCreating((prev) =>
                        prev
                          ? { ...prev, markup: markupValue, price: calculated.toFixed(2) }
                          : prev
                      );
                    }
                  }
                }}
              />
            </div>
          </div>
          <label className="settings-checkbox-item" style={{ marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={creating.isActive}
              onChange={(e) => setCreating({ ...creating, isActive: e.target.checked })}
            />
            <span>Active</span>
          </label>
          <div className="settings-action-bar">
            <button
              type="button"
              className="btn"
              disabled={saving}
              onClick={() => void createBreak()}
            >
              {saving ? 'Creating…' : 'Create price break'}
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={saving}
              onClick={() => setCreating(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
