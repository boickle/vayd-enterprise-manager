import { useCallback, useEffect, useState } from 'react';
import { ExpirationDateField } from '../inventory/ExpirationDateField';
import {
  addInventoryLot,
  listInventoryBranchLocations,
  listInventoryLots,
  setLotBottleWeight,
  updateInventoryLot,
  type InventoryBranchLocation,
  type InventoryLotBalance,
  type PracticeBranch,
} from '../../api/branchInventory';

type Props = {
  practiceId: number;
  inventoryItemId: number;
  branches: PracticeBranch[];
  /** Prefer lots for this stock item when the catalog code draws from another SKU. */
  stockItemId?: number | null;
  stockItemName?: string | null;
  trackLots?: boolean;
  /** Expiration is always required. Kept so older callers still type-check. */
  requireExpirationOnLots?: boolean;
  requireLotNumber?: boolean;
  /** Set when this controlled item is counted by weight; lots then carry a bottle weight. */
  weightUnit?: 'g' | 'oz' | null;
  /** mL in a full bottle (the item's units per package). */
  bottleMl?: number | null;
  /** Lot quantities move branch counts, so the parent can refresh them. */
  onLotsChanged?: () => void;
  /** Open the inventory SKU that actually holds lots and counts. */
  onOpenStockItem?: () => void;
};

export default function CatalogItemLotsEditor({
  practiceId,
  inventoryItemId,
  branches,
  stockItemId,
  stockItemName,
  trackLots,
  requireLotNumber,
  weightUnit,
  bottleMl,
  onLotsChanged,
  onOpenStockItem,
}: Props) {
  const lotsLiveOnOther =
    stockItemId != null && Number(stockItemId) !== Number(inventoryItemId);
  const lotItemId = stockItemId ?? inventoryItemId;
  const [lots, setLots] = useState<InventoryLotBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<InventoryLotBalance | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [branchId, setBranchId] = useState<number | ''>('');
  const [locations, setLocations] = useState<InventoryBranchLocation[]>([]);
  const [locationId, setLocationId] = useState<number | ''>('');
  const [lotNumber, setLotNumber] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [quantity, setQuantity] = useState('0');
  const [fullBottleWeight, setFullBottleWeight] = useState('');
  const [fillMl, setFillMl] = useState('');

  const isEdit = editing !== null && editing !== 'new';

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listInventoryLots(practiceId, lotItemId, {
        includeZero: true,
      });
      setLots(rows);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load lots');
    } finally {
      setLoading(false);
    }
  }, [practiceId, lotItemId]);

  useEffect(() => {
    if (lotsLiveOnOther) {
      setLoading(false);
      setLots([]);
      return;
    }
    void reload();
  }, [reload, lotsLiveOnOther]);

  useEffect(() => {
    if (branchId === '' || isEdit) {
      if (branchId === '') {
        setLocations([]);
        setLocationId('');
      }
      return;
    }
    let canceled = false;
    void listInventoryBranchLocations(practiceId, Number(branchId))
      .then((rows) => {
        if (canceled) return;
        setLocations(rows);
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
  }, [practiceId, branchId, isEdit]);

  function openAdd() {
    setError(null);
    setBranchId('');
    setLocationId('');
    setLotNumber('');
    setSerialNumber('');
    setExpirationDate('');
    setQuantity('0');
    setFullBottleWeight('');
    setFillMl(bottleMl != null ? String(bottleMl) : '');
    setEditing('new');
  }

  function openEdit(lot: InventoryLotBalance) {
    setError(null);
    setBranchId(lot.branchId);
    setLocationId(lot.branchLocationId);
    setLotNumber(lot.lotNumber);
    setSerialNumber(lot.serialNumber ?? '');
    setExpirationDate(lot.expirationDate?.slice(0, 10) ?? '');
    setQuantity(String(lot.quantityOnHand ?? 0));
    setFullBottleWeight('');
    setFillMl(bottleMl != null ? String(bottleMl) : '');
    setEditing(lot);
  }

  async function submitLot() {
    if (requireLotNumber && !lotNumber.trim()) {
      setError('Lot number is required for this item');
      return;
    }
    if (!isEdit && (branchId === '' || locationId === '')) {
      setError('Branch and location are required');
      return;
    }
    if (!expirationDate.trim()) {
      setError('An expiration date is required');
      return;
    }
    const weight = fullBottleWeight.trim() === '' ? null : Number(fullBottleWeight);
    const ml = fillMl.trim() === '' ? null : Number(fillMl);
    if (weight != null && (!Number.isFinite(weight) || weight <= 0)) {
      setError('Full bottle weight must be a positive number');
      return;
    }
    if (weight != null && (ml == null || !Number.isFinite(ml) || ml <= 0)) {
      setError('Enter how many mL a full bottle holds');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let lotId: number | null = null;
      if (isEdit) {
        lotId = (editing as InventoryLotBalance).id;
        await updateInventoryLot(practiceId, lotId, {
          lotNumber: lotNumber.trim(),
          serialNumber: serialNumber.trim() || null,
          expirationDate: expirationDate || null,
          quantityOnHand: Number(quantity) || 0,
        });
      } else {
        const created = await addInventoryLot(practiceId, {
          inventoryItemId: lotItemId,
          branchId: Number(branchId),
          branchLocationId: Number(locationId),
          lotNumber: lotNumber.trim(),
          serialNumber: serialNumber.trim() || null,
          expirationDate: expirationDate || null,
          quantityOnHand: Number(quantity) || 0,
        });
        lotId = created.id;
      }
      if (weight != null && lotId != null) {
        await setLotBottleWeight(practiceId, lotId, { fullBottleWeight: weight, bottleMl: ml });
      }
      setEditing(null);
      await reload();
      onLotsChanged?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save lot');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <h4 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
          {lotsLiveOnOther ? `Lots on ${stockItemName || 'linked inventory'}` : 'Lots'}
        </h4>
        {trackLots && !lotsLiveOnOther && (
          <button type="button" className="btn" onClick={openAdd}>
            Add lot
          </button>
        )}
      </div>
      <p className="settings-muted" style={{ marginBottom: 12, fontSize: 13 }}>
        {lotsLiveOnOther ? (
          <>
            This sellable is the billed service only (for example annual vs initial). It has no
            on-hand of its own. Lots, serials, and counts live on{' '}
            <strong>{stockItemName || 'the linked inventory item'}</strong>, which also appears
            under the service on the invoice so staff can pick a lot.
            {onOpenStockItem ? (
              <>
                {' '}
                <button type="button" className="btn" onClick={onOpenStockItem}>
                  Open {stockItemName || 'inventory item'}
                </button>
              </>
            ) : null}
          </>
        ) : (
          <>
            Lot / serial balances by branch and location. Use Edit to change on-hand for a lot.
            {!trackLots && (
              <>
                {' '}
                Turn on <em>Lots enabled</em> above to add or edit lots. Location counts can also be
                edited under Counts by branch.
              </>
            )}
          </>
        )}
      </p>
      {error && (
        <div className="settings-message settings-error-message" style={{ marginBottom: 8 }}>
          {error}
        </div>
      )}
      {lotsLiveOnOther ? null : loading ? (
        <p className="settings-muted">Loading lots…</p>
      ) : lots.length === 0 ? (
        <p className="settings-muted" style={{ fontSize: 13 }}>
          No lots yet. Add one, or receive stock with a lot number on Unbox.
        </p>
      ) : (
        <table className="inv-catalog-table" style={{ width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              <th>Branch</th>
              <th>Location</th>
              <th>Lot</th>
              <th>Serial</th>
              <th>Expires</th>
              <th>QOH</th>
              {weightUnit ? <th>Empty bottle</th> : null}
              {trackLots && <th />}
            </tr>
          </thead>
          <tbody>
            {lots.map((lot) => (
              <tr key={lot.id}>
                <td>{lot.branchName ?? `#${lot.branchId}`}</td>
                <td>
                  {lot.locationName ?? '—'}
                  {lot.locationCode ? ` (${lot.locationCode})` : ''}
                </td>
                <td>{lot.lotNumber}</td>
                <td>{lot.serialNumber || '—'}</td>
                <td>{lot.expirationDate?.slice(0, 10) || '—'}</td>
                <td>{lot.quantityOnHand}</td>
                {weightUnit ? (
                  <td>
                    {lot.emptyBottleWeightGrams != null
                      ? `${
                          Math.round(
                            (weightUnit === 'oz'
                              ? lot.emptyBottleWeightGrams / 28.349523125
                              : lot.emptyBottleWeightGrams) * 100
                          ) / 100
                        } ${weightUnit}`
                      : '—'}
                  </td>
                ) : null}
                {trackLots && (
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => openEdit(lot)}
                    >
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={isEdit ? 'Edit lot' : 'Add lot'}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 80,
            background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setEditing(null)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 10,
              padding: 20,
              width: 'min(440px, 100%)',
              boxShadow: '0 12px 40px rgba(15,23,42,0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 12px', fontSize: 17 }}>
              {isEdit ? 'Edit lot' : 'Add lot'}
            </h3>
            <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
              {isEdit ? (
                <p className="settings-muted" style={{ margin: 0, fontSize: 13 }}>
                  {(editing as InventoryLotBalance).branchName ?? 'Branch'} ·{' '}
                  {(editing as InventoryLotBalance).locationName ?? 'Location'}. Use a
                  transfer movement to move this lot somewhere else.
                </p>
              ) : (
                <>
                  <label className="settings-label">
                    Branch
                    <select
                      className="settings-input"
                      value={branchId}
                      onChange={(e) =>
                        setBranchId(e.target.value ? Number(e.target.value) : '')
                      }
                    >
                      <option value="">Select…</option>
                      {branches
                        .filter((b) => b.isActive !== false)
                        .map((b) => (
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
                      disabled={branchId === ''}
                      onChange={(e) =>
                        setLocationId(e.target.value ? Number(e.target.value) : '')
                      }
                    >
                      <option value="">Select…</option>
                      {locations.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name} ({loc.code})
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <label className="settings-label">
                Lot number{requireLotNumber ? ' (required)' : ' (optional)'}
                <input
                  className="settings-input"
                  value={lotNumber}
                  onChange={(e) => setLotNumber(e.target.value)}
                  required={requireLotNumber}
                />
              </label>
              <label className="settings-label">
                Serial number
                <input
                  className="settings-input"
                  value={serialNumber}
                  onChange={(e) => setSerialNumber(e.target.value)}
                />
              </label>
              <div className="settings-label">
                Expiration (required)
                <ExpirationDateField
                  value={expirationDate}
                  disabled={saving}
                  required
                  onCommit={(iso) => setExpirationDate(iso ?? '')}
                />
              </div>
              <label className="settings-label">
                Quantity on hand
                <input
                  className="settings-input"
                  type="number"
                  min={0}
                  step="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </label>
              {isEdit && (
                <p className="settings-muted" style={{ margin: 0, fontSize: 12 }}>
                  Changing the quantity records a count adjustment against the branch.
                </p>
              )}
              {weightUnit ? (
                <>
                  <label className="settings-label">
                    Full bottle weight ({weightUnit})
                    <input
                      className="settings-input"
                      inputMode="decimal"
                      value={fullBottleWeight}
                      onChange={(e) => setFullBottleWeight(e.target.value)}
                      placeholder={
                        isEdit && (editing as InventoryLotBalance).emptyBottleWeightGrams != null
                          ? 'Leave blank to keep'
                          : 'One sealed bottle, as received'
                      }
                    />
                  </label>
                  <label className="settings-label">
                    mL per full bottle
                    <input
                      className="settings-input"
                      inputMode="decimal"
                      value={fillMl}
                      onChange={(e) => setFillMl(e.target.value)}
                    />
                  </label>
                  <p className="settings-muted" style={{ margin: 0, fontSize: 12 }}>
                    Scout subtracts the liquid to get the empty bottle, so counts by weight convert
                    to mL. Use the receive weight VetSnap recorded for this lot.
                  </p>
                </>
              ) : null}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={saving}
                onClick={() => void submitLot()}
              >
                {saving ? 'Saving…' : isEdit ? 'Save lot' : 'Add lot'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
