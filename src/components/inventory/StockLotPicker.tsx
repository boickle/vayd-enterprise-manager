import { useEffect, useMemo, useState } from 'react';
import {
  getUncountedShelfLot,
  getShelfCountStatus,
  listInventoryLots,
  type InventoryLotBalance,
} from '../../api/branchInventory';
import { apiErrorMessage } from '../../api/http';
import AddInventoryLotModal from './AddInventoryLotModal';
import { ExpirationDateField, dateInputValue } from './ExpirationDateField';
import './StockLotPicker.css';

export { ExpirationDateField } from './ExpirationDateField';

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
  /**
   * Show “Add lot” that creates a real inventory lot via modal (invoice /
   * checkout when none exist at this location).
   */
  allowAddLot?: boolean;
  itemName?: string | null;
  requireExpiration?: boolean;
  requireLotNumber?: boolean;
  selectedLotId: number | null;
  lotNumber?: string;
  expirationDate?: string | null;
  onChange: (next: StockLotPick) => void;
  label?: string;
  className?: string;
  /** Bump to reload lots (e.g. after editing the inventory item). */
  refreshKey?: number;
  /**
   * Stock is being sold, used at a visit or mailed: expired lots are shown but can't be picked
   * (owner decision D2). Move Items and Waste / Adjust leave this off so expired bottles can go.
   */
  forUse?: boolean;
  /**
   * A controlled drug: the shelf passed in is the doctor's controlled drug location (their safe),
   * named here. Staff can still take a lot from another shelf; the Controlled Drugs report flags
   * it (owner decision, Oct 30, 2026).
   */
  otherShelvesFrom?: string | null;
  /** Unbox: these lot fields were filled in by reading the supplier invoice (U4). */
  fromInvoiceRead?: boolean;
  /**
   * "Older lot … has stock": a nudge to use the oldest bottle first. Waste / Adjust turns it off,
   * since you waste the bottle that's broken or expired, not the oldest (U7).
   */
  olderLotHint?: boolean;
};

/** "Oct 1" from "2026-10-01". */
function shortDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? iso.slice(0, 10)
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Today in Eastern time, YYYY-MM-DD: the calendar lots expire by. */
function easternToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** The API marks expired lots; older responses without the flag are worked out here. */
export function lotIsExpired(
  lot: Pick<InventoryLotBalance, 'expired' | 'expirationDate'>
): boolean {
  if (typeof lot.expired === 'boolean') return lot.expired;
  const exp = lot.expirationDate?.slice(0, 10);
  return Boolean(exp && /^\d{4}-\d{2}-\d{2}$/.test(exp) && exp < easternToday());
}

/** Soonest expiration first; lots with no date last. Equal dates keep the order they came in. */
export function sortLotsFefo(rows: InventoryLotBalance[]): InventoryLotBalance[] {
  const key = (lot: InventoryLotBalance) => lot.expirationDate?.slice(0, 10) || '9999-99-99';
  return rows
    .map((lot, i) => ({ lot, i }))
    .sort((a, b) => (key(a.lot) < key(b.lot) ? -1 : key(a.lot) > key(b.lot) ? 1 : a.i - b.i))
    .map((x) => x.lot);
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
  const expired = lotIsExpired(lot) && lot.expirationDate;
  const parts = [
    lotName,
    expired
      ? `Expired ${shortDate(lot.expirationDate!)}`
      : raw && lot.expirationDate
        ? `exp ${lot.expirationDate.slice(0, 10)}`
        : null,
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
  allowAddLot = true,
  itemName,
  requireExpiration = true,
  requireLotNumber = false,
  selectedLotId,
  lotNumber = '',
  expirationDate = '',
  onChange,
  label = 'Lot / expiration',
  className,
  refreshKey = 0,
  forUse = false,
  fromInvoiceRead = false,
  olderLotHint = true,
  otherShelvesFrom = null,
}: Props) {
  /** Showing lots from every shelf instead of the doctor's controlled drug location. */
  const [anyShelf, setAnyShelf] = useState(false);
  const branchFilter = anyShelf ? null : branchId;
  const locationFilter = anyShelf ? null : locationId;
  const [lots, setLots] = useState<InventoryLotBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newLot, setNewLot] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [shelfLot, setShelfLot] = useState<{ id: number; lotNumber: string } | null>(null);
  const [shelfLotError, setShelfLotError] = useState<string | null>(null);
  /** False until this shelf's first count, even after Add lot: its other bottles are still unknown. */
  const [shelfCounted, setShelfCounted] = useState<boolean | null>(null);

  useEffect(() => {
    if (inventoryItemId == null) {
      setLots([]);
      return;
    }
    let canceled = false;
    setLoading(true);
    setError(null);
    void listInventoryLots(practiceId, inventoryItemId, {
      ...(branchFilter != null ? { branchId: branchFilter } : {}),
      ...(locationFilter != null ? { locationId: locationFilter } : {}),
      includeZero: allowNew,
    })
      .then((rows) => {
        if (!canceled) setLots(sortLotsFefo(rows));
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
  }, [practiceId, inventoryItemId, branchFilter, locationFilter, allowNew, refreshKey, reloadTick]);

  const askShelfCounted =
    inventoryItemId != null && !allowNew && !requireLotNumber && locationId != null && lots.length > 0;
  useEffect(() => {
    setShelfCounted(null);
    if (!askShelfCounted || inventoryItemId == null || locationId == null) return;
    let canceled = false;
    void getShelfCountStatus(practiceId, inventoryItemId, locationId)
      .then((r) => {
        if (!canceled) setShelfCounted(r.counted);
      })
      .catch(() => {
        if (!canceled) setShelfCounted(null);
      });
    return () => {
      canceled = true;
    };
  }, [askShelfCounted, practiceId, inventoryItemId, locationId, refreshKey, reloadTick]);

  /** Lots staff may pick: in use mode, expired ones are left out. */
  const pickable = useMemo(
    () => (forUse ? lots.filter((lot) => !lotIsExpired(lot)) : lots),
    [forUse, lots]
  );

  useEffect(() => {
    if (!allowNew || selectedLotId != null || loading) return;
    if (lots.length === 0 || lotNumber.trim()) setNewLot(true);
  }, [allowNew, lots.length, loading, lotNumber, selectedLotId]);

  useEffect(() => {
    if (selectedLotId != null) return;
    if (lotNumber.trim()) {
      const match = pickable.find(
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
    const match = pickable.find(
      (lot) => (lot.lotNumber ?? '').trim() === '' && dateInputValue(lot.expirationDate) === exp
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
  }, [pickable, lotNumber, expirationDate, selectedLotId]);

  useEffect(() => {
    if (allowNew || selectedLotId != null || pickable.length !== 1) return;
    const only = pickable[0]!;
    onChange({
      lotId: only.id,
      lotNumber: only.lotNumber,
      expirationDate: dateInputValue(only.expirationDate),
    });
    // One usable lot at this location — no choice to make.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowNew, pickable, selectedLotId]);

  // FEFO suggestion (CAT-10): when stock is leaving, the soonest-expiring lot that is still good
  // and has stock is the one to use first. Only a hint: nothing is blocked or saved.
  const useFirst = useMemo(() => {
    if (allowNew) return null;
    const usable = lots.filter((lot) => !lotIsExpired(lot) && Number(lot.quantityOnHand) > 0);
    return usable.length > 1 ? usable[0]! : null;
  }, [allowNew, lots]);

  const olderLotNote = useMemo(() => {
    if (!useFirst || selectedLotId == null || selectedLotId === useFirst.id) return null;
    const picked = lots.find((lot) => lot.id === selectedLotId);
    if (!picked || lotIsExpired(picked)) return null;
    const pickedExp = picked.expirationDate?.slice(0, 10) || '9999-99-99';
    const firstExp = useFirst.expirationDate?.slice(0, 10) || '9999-99-99';
    if (pickedExp <= firstExp) return null;
    const raw = useFirst.lotNumber?.trim() ?? '';
    return raw && raw !== 'UNASSIGNED' ? raw : (useFirst.expirationDate?.slice(0, 10) ?? 'earlier');
  }, [useFirst, lots, selectedLotId]);

  const byId = useMemo(() => {
    const map = new Map<number, InventoryLotBalance>();
    for (const lot of lots) map.set(lot.id, lot);
    return map;
  }, [lots]);

  if (inventoryItemId == null) return null;

  const showLocation = locationFilter == null;
  const selectValue = newLot ? 'new' : selectedLotId != null ? String(selectedLotId) : '';
  const showEditableLotFields =
    allowNew && (newLot || (selectedLotId == null && lotNumber.trim() !== ''));
  const canAddLot = allowAddLot && !allowNew && !disabled;
  const offerShelfStock =
    !allowNew &&
    !requireLotNumber &&
    locationId != null &&
    !loading &&
    (lots.length === 0 || shelfCounted === false);
  // The no-lot bucket sits at 0 or below, so the lot list (on-hand only) leaves it out.
  const shelfLotId =
    shelfLot?.id ?? (selectedLotId != null && lotNumber === 'UNASSIGNED' ? selectedLotId : null);
  const shelfLotShown = shelfLotId != null && !byId.has(shelfLotId);

  return (
    <div className={className}>
      <div className="stock-lot-picker__head">
        <label className="settings-label" style={{ marginBottom: 0 }}>
          {label}
          {required ? ' *' : ''}
        </label>
        {canAddLot ? (
          <button
            type="button"
            className="btn secondary stock-lot-picker__add"
            disabled={loading}
            onClick={() => setAddOpen(true)}
          >
            Add lot
          </button>
        ) : null}
      </div>
      {otherShelvesFrom ? (
        <p className="settings-muted" style={{ fontSize: 12, margin: '0 0 4px' }}>
          {anyShelf ? 'Every shelf (flagged on the Controlled Drugs report if not the doctor’s). ' : `From ${otherShelvesFrom}. `}
          <button
            type="button"
            style={{ background: 'none', border: 0, padding: 0, color: '#0f766e', fontWeight: 600, cursor: 'pointer' }}
            disabled={disabled}
            onClick={() => setAnyShelf((v) => !v)}
          >
            {anyShelf ? `Back to ${otherShelvesFrom}` : 'Another shelf…'}
          </button>
        </p>
      ) : null}
      <select
        className="settings-input"
        value={selectValue}
        disabled={disabled || loading}
        required={required && !allowNew}
        onChange={(e) => {
          const value = e.target.value;
          if (value === 'shelf') {
            if (locationId == null) return;
            setShelfLotError(null);
            void getUncountedShelfLot(practiceId, inventoryItemId, locationId)
              .then((lot) => {
                setShelfLot({ id: lot.id, lotNumber: lot.lotNumber });
                onChange({ lotId: lot.id, lotNumber: lot.lotNumber, expirationDate: null });
              })
              .catch((err: unknown) =>
                setShelfLotError(apiErrorMessage(err) || 'Could not use shelf stock')
              );
            return;
          }
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
          if (id === shelfLotId && !byId.has(id)) {
            onChange({ lotId: id, lotNumber: 'UNASSIGNED', expirationDate: null });
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
                : locationId != null
                  ? 'No lots at this location — receive here or pick another location'
                  : 'No lots here — receive this item first'
              : lots.length > 1
                ? 'Choose the soonest-exp lot…'
                : 'Select a lot…'}
        </option>
        {lots.map((lot) => {
          const blocked = forUse && lotIsExpired(lot);
          return (
            <option
              key={lot.id}
              value={lot.id}
              disabled={blocked}
              className={blocked ? 'stock-lot-picker__expired' : undefined}
            >
              {lotLabel(lot, showLocation)}
              {useFirst?.id === lot.id ? ' (recommended)' : ''}
            </option>
          );
        })}
        {shelfLotShown ? (
          <option value={shelfLotId}>Existing stock (no lot recorded)</option>
        ) : offerShelfStock ? (
          <option value="shelf">Existing stock — shelf not counted yet</option>
        ) : null}
        {allowNew ? <option value="new">New lot…</option> : null}
      </select>
      {shelfLotError ? (
        <p className="settings-muted" style={{ color: '#b45309', margin: '4px 0 0' }}>
          {shelfLotError}
        </p>
      ) : null}
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
            <ExpirationDateField
              value={expirationDate}
              disabled={disabled}
              required={requireExpiration}
              onCommit={(next) =>
                onChange({
                  lotId: null,
                  lotNumber,
                  expirationDate: next,
                })
              }
            />
          </label>
        </div>
      ) : null}
      {showEditableLotFields && fromInvoiceRead ? (
        <p className="settings-muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
          From the invoice — change these if the read was wrong.
        </p>
      ) : null}
      {error ? (
        <p className="settings-muted" style={{ color: '#b45309', margin: '4px 0 0' }}>
          {error}
        </p>
      ) : forUse && pickable.length < lots.length ? (
        <p className="settings-muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
          Expired lots can&apos;t be used. Log them on Waste / Adjust as Expired.
        </p>
      ) : lots.length > 1 ? (
        <p className="settings-muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
          Soonest expiration is listed first — use that bottle unless you know otherwise.
        </p>
      ) : null}
      {olderLotNote && olderLotHint ? (
        <p
          className="settings-muted stock-lot-picker__older-note"
          role="note"
          style={{ margin: '4px 0 0', fontSize: 12, color: '#92400e' }}
        >
          Older lot {olderLotNote} has stock
        </p>
      ) : null}
      {canAddLot && inventoryItemId != null ? (
        <AddInventoryLotModal
          open={addOpen}
          practiceId={practiceId}
          inventoryItemId={inventoryItemId}
          itemName={itemName}
          defaultBranchId={branchId}
          defaultLocationId={locationId}
          requireLotNumber={requireLotNumber}
          onClose={() => setAddOpen(false)}
          onCreated={(lot) => {
            setNewLot(false);
            setReloadTick((n) => n + 1);
            onChange({
              lotId: lot.id,
              lotNumber: lot.lotNumber,
              expirationDate: dateInputValue(lot.expirationDate),
            });
          }}
        />
      ) : null}
    </div>
  );
}
