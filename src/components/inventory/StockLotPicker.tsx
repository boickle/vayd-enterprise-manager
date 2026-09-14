import { useEffect, useMemo, useState } from 'react';
import {
  listInventoryLots,
  type InventoryLotBalance,
} from '../../api/branchInventory';

export type StockLotPick = {
  lotId: number | null;
  lotNumber: string;
  expirationDate: string | null;
};

type Props = {
  practiceId: number;
  inventoryItemId: number | null;
  branchId?: number | null;
  locationId?: number | null;
  required?: boolean;
  disabled?: boolean;
  /** Receive / unbox: pick an existing lot to add onto, or start a new one. */
  allowNew?: boolean;
  requireExpiration?: boolean;
  requireLotNumber?: boolean;
  selectedLotId: number | null;
  lotNumber?: string;
  expirationDate?: string | null;
  onChange: (next: StockLotPick) => void;
  label?: string;
  className?: string;
};

function dateInputValue(value: string | null | undefined): string {
  if (!value) return '';
  const slice = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(slice) ? slice : '';
}

function lotLabel(lot: InventoryLotBalance, showLocation: boolean): string {
  const raw = lot.lotNumber?.trim() ?? '';
  const lotName =
    raw === 'UNASSIGNED'
      ? 'Existing stock (no lot recorded)'
      : raw
        ? `Lot ${raw}`
        : lot.expirationDate
          ? `Exp ${lot.expirationDate.slice(0, 10)}`
          : 'Dated stock';
  const parts = [
    lotName,
    raw && lot.expirationDate ? `exp ${lot.expirationDate.slice(0, 10)}` : null,
    `QOH ${lot.quantityOnHand}`,
  ];
  if (showLocation && (lot.locationName || lot.locationCode)) {
    parts.push(
      `${lot.locationName ?? ''}${lot.locationCode ? ` (${lot.locationCode})` : ''}`.trim()
    );
  }
  return parts.filter(Boolean).join(' · ');
}

/**
 * FEFO-ordered lot list. Required whenever the item tracks lots and stock is
 * leaving (or joining) a specific bottle.
 */
export default function StockLotPicker({
  practiceId,
  inventoryItemId,
  branchId,
  locationId,
  required = true,
  disabled,
  allowNew = false,
  requireExpiration = true,
  requireLotNumber = false,
  selectedLotId,
  lotNumber = '',
  expirationDate = '',
  onChange,
  label = 'Lot / expiration',
  className,
}: Props) {
  const [lots, setLots] = useState<InventoryLotBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newLot, setNewLot] = useState(false);

  useEffect(() => {
    if (inventoryItemId == null) {
      setLots([]);
      return;
    }
    let canceled = false;
    setLoading(true);
    setError(null);
    void listInventoryLots(practiceId, inventoryItemId, {
      ...(branchId != null ? { branchId } : {}),
      ...(locationId != null ? { locationId } : {}),
      includeZero: allowNew,
    })
      .then((rows) => {
        if (!canceled) setLots(rows);
      })
      .catch((e: unknown) => {
        if (!canceled) {
          setLots([]);
          setError(e instanceof Error ? e.message : 'Could not load lots');
        }
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [practiceId, inventoryItemId, branchId, locationId, allowNew]);

  useEffect(() => {
    if (!allowNew || selectedLotId != null || loading) return;
    if (lots.length === 0 || lotNumber.trim()) setNewLot(true);
  }, [allowNew, lots.length, loading, lotNumber, selectedLotId]);

  useEffect(() => {
    if (selectedLotId != null) return;
    if (lotNumber.trim()) {
      const match = lots.find(
        (lot) => lot.lotNumber.trim().toLowerCase() === lotNumber.trim().toLowerCase()
      );
      if (!match) return;
      setNewLot(false);
      onChange({
        lotId: match.id,
        lotNumber: match.lotNumber,
        expirationDate: dateInputValue(match.expirationDate),
      });
      return;
    }
    const exp = dateInputValue(expirationDate);
    if (!exp) return;
    const match = lots.find(
      (lot) =>
        (lot.lotNumber ?? '').trim() === '' && dateInputValue(lot.expirationDate) === exp
    );
    if (!match) return;
    setNewLot(false);
    onChange({
      lotId: match.id,
      lotNumber: match.lotNumber,
      expirationDate: dateInputValue(match.expirationDate),
    });
    // Match a typed / invoice lot # or expiration to an existing bottle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lots, lotNumber, expirationDate, selectedLotId]);

  useEffect(() => {
    if (allowNew || selectedLotId != null || lots.length !== 1) return;
    const only = lots[0];
    onChange({
      lotId: only.id,
      lotNumber: only.lotNumber,
      expirationDate: dateInputValue(only.expirationDate),
    });
    // One lot at this location — no choice to make.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowNew, lots, selectedLotId]);

  const byId = useMemo(() => {
    const map = new Map<number, InventoryLotBalance>();
    for (const lot of lots) map.set(lot.id, lot);
    return map;
  }, [lots]);

  if (inventoryItemId == null) return null;

  const showLocation = locationId == null;
  const selectValue = newLot ? 'new' : selectedLotId != null ? String(selectedLotId) : '';
  const showEditableLotFields =
    allowNew && (newLot || (selectedLotId == null && lotNumber.trim() !== ''));

  return (
    <div className={className}>
      <label className="settings-label" style={{ marginBottom: 0 }}>
        {label}
        {required ? ' *' : ''}
        <select
          className="settings-input"
          value={selectValue}
          disabled={disabled || loading}
          required={required && !allowNew}
          onChange={(e) => {
            const value = e.target.value;
            if (value === 'new') {
              setNewLot(true);
              onChange({
                lotId: null,
                lotNumber,
                expirationDate: expirationDate ?? null,
              });
              return;
            }
            setNewLot(false);
            const id = value ? Number(value) : null;
            if (id == null || !Number.isFinite(id)) {
              onChange({ lotId: null, lotNumber: '', expirationDate: null });
              return;
            }
            const lot = byId.get(id);
            onChange({
              lotId: id,
              lotNumber: lot?.lotNumber ?? '',
              expirationDate: dateInputValue(lot?.expirationDate),
            });
          }}
        >
          <option value="">
            {loading
              ? 'Loading lots…'
              : lots.length === 0
                ? allowNew
                  ? 'New lot…'
                  : 'No lots here — receive this item first'
                : lots.length > 1
                  ? 'Choose the soonest-exp lot…'
                  : 'Select a lot…'}
          </option>
          {lots.map((lot) => (
            <option key={lot.id} value={lot.id}>
              {lotLabel(lot, showLocation)}
            </option>
          ))}
          {allowNew ? <option value="new">New lot…</option> : null}
        </select>
      </label>
      {showEditableLotFields ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
          <label className="settings-label" style={{ marginBottom: 0 }}>
            Lot #{requireLotNumber ? ' *' : ' (optional)'}
            <input
              className="settings-input"
              value={lotNumber}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  lotId: null,
                  lotNumber: e.target.value,
                  expirationDate: expirationDate ?? null,
                })
              }
              required={requireLotNumber}
            />
          </label>
          <label className="settings-label" style={{ marginBottom: 0 }}>
            Exp date{requireExpiration ? ' *' : ''}
            <input
              className="settings-input"
              type="date"
              value={dateInputValue(expirationDate)}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  lotId: null,
                  lotNumber,
                  expirationDate: e.target.value || null,
                })
              }
              required={requireExpiration}
            />
          </label>
        </div>
      ) : null}
      {showEditableLotFields ? (
        <p className="settings-muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
          From the invoice — change these if the read was wrong.
        </p>
      ) : null}
      {error ? (
        <p className="settings-muted" style={{ color: '#b45309', margin: '4px 0 0' }}>
          {error}
        </p>
      ) : lots.length > 1 ? (
        <p className="settings-muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
          Soonest expiration is listed first — use that bottle unless you know otherwise.
        </p>
      ) : null}
    </div>
  );
}
