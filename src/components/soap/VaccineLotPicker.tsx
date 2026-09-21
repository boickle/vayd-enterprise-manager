import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getEmployeeBranches,
  listInventoryLots,
  listPracticeBranches,
  type InventoryLotBalance,
} from '../../api/branchInventory';
import { fetchEmployeeWorkdayActualByDate } from '../../api/employeeWorkdayActuals';
import AddInventoryLotModal from '../inventory/AddInventoryLotModal';

type Props = {
  practiceId: number;
  inventoryItemId: number;
  itemName?: string | null;
  providerId?: number | null;
  /** Invoice checkout branch — lots follow this, not the provider, when set. */
  branchId?: number | null;
  locationId?: number | null;
  disabled?: boolean;
  /** Currently selected lot balance id. */
  selectedLotId: number | null;
  onSelectLot: (lot: InventoryLotBalance | null) => void;
  /** Reason when using a lot with QOH ≤ 0. */
  zeroOverrideReason?: string;
  onZeroOverrideReasonChange?: (reason: string) => void;
};

function todayYmd(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

function lotLabel(lot: InventoryLotBalance, showBranch: boolean): string {
  const parts = [
    `Lot ${lot.lotNumber}`,
    lot.expirationDate ? `exp ${lot.expirationDate.slice(0, 10)}` : null,
    `QOH ${lot.quantityOnHand}`,
    lot.locationName || lot.locationCode
      ? `${lot.locationName ?? ''}${lot.locationCode ? ` (${lot.locationCode})` : ''}`.trim()
      : null,
  ].filter(Boolean);
  if (showBranch) {
    parts.unshift(lot.branchName ?? `Branch #${lot.branchId}`);
  }
  return parts.join(' · ');
}

/**
 * Lots follow the invoice checkout branch / location when those are set, and
 * reload when either dropdown changes. Otherwise the provider’s workday branch
 * is the fallback. “Search other branches” expands the list.
 *
 * Zero/negative lots stay hidden until “Include zero/negative lots” is checked.
 * The override reason only appears after those lots are in the list and one is selected.
 */
export default function VaccineLotPicker({
  practiceId,
  inventoryItemId,
  itemName,
  providerId,
  branchId: invoiceBranchId,
  locationId: invoiceLocationId,
  disabled,
  selectedLotId,
  onSelectLot,
  zeroOverrideReason = '',
  onZeroOverrideReasonChange,
}: Props) {
  const [providerBranchId, setProviderBranchId] = useState<number | null>(null);
  const [branchLots, setBranchLots] = useState<InventoryLotBalance[]>([]);
  const [otherLots, setOtherLots] = useState<InventoryLotBalance[]>([]);
  const [searchOthers, setSearchOthers] = useState(false);
  const [includeZero, setIncludeZero] = useState(false);
  const [loading, setLoading] = useState(false);
  const [branchName, setBranchName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const preferredBranchId =
    invoiceBranchId != null && Number.isFinite(Number(invoiceBranchId))
      ? Number(invoiceBranchId)
      : providerBranchId;
  const preferredLocationId =
    invoiceLocationId != null && Number.isFinite(Number(invoiceLocationId))
      ? Number(invoiceLocationId)
      : null;

  useEffect(() => {
    let canceled = false;
    async function resolveBranch() {
      if (invoiceBranchId != null && Number.isFinite(Number(invoiceBranchId))) {
        try {
          const branches = await listPracticeBranches(practiceId);
          if (canceled) return;
          const bid = Number(invoiceBranchId);
          setBranchName(branches.find((b) => b.id === bid)?.name ?? `Branch #${bid}`);
        } catch {
          if (!canceled) setBranchName(`Branch #${invoiceBranchId}`);
        }
        return;
      }
      if (providerId == null || !Number.isFinite(providerId)) {
        setProviderBranchId(null);
        return;
      }
      try {
        const [assignments, workday, branches] = await Promise.all([
          getEmployeeBranches(practiceId, providerId).catch(() => []),
          fetchEmployeeWorkdayActualByDate(providerId, todayYmd()).catch(() => null),
          listPracticeBranches(practiceId).catch(() => []),
        ]);
        if (canceled) return;
        const fromWorkday =
          workday?.inventoryBranchId != null &&
          Number.isFinite(Number(workday.inventoryBranchId))
            ? Number(workday.inventoryBranchId)
            : null;
        const primary = assignments.find((a) => a.isPrimary)?.branchId ?? null;
        const first = assignments[0]?.branchId ?? null;
        const bid = fromWorkday ?? primary ?? first;
        setProviderBranchId(bid);
        if (bid != null) {
          setBranchName(branches.find((b) => b.id === bid)?.name ?? `Branch #${bid}`);
        }
      } catch {
        if (!canceled) setProviderBranchId(null);
      }
    }
    void resolveBranch();
    return () => {
      canceled = true;
    };
  }, [practiceId, providerId, invoiceBranchId]);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);
    void listInventoryLots(practiceId, inventoryItemId, {
      ...(preferredBranchId != null ? { branchId: preferredBranchId } : {}),
      ...(preferredLocationId != null ? { locationId: preferredLocationId } : {}),
      includeZero,
    })
      .then((rows) => {
        if (!canceled) setBranchLots(rows);
      })
      .catch((e: unknown) => {
        if (!canceled) {
          setBranchLots([]);
          setError(e instanceof Error ? e.message : 'Could not load lots');
        }
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [
    practiceId,
    inventoryItemId,
    preferredBranchId,
    preferredLocationId,
    reloadTick,
    includeZero,
  ]);

  useEffect(() => {
    if (!searchOthers) {
      setOtherLots([]);
      return;
    }
    let canceled = false;
    void listInventoryLots(practiceId, inventoryItemId, { includeZero })
      .then((rows) => {
        if (canceled) return;
        setOtherLots(
          rows.filter((r) => {
            if (preferredLocationId != null) {
              return r.branchLocationId !== preferredLocationId;
            }
            if (preferredBranchId != null) {
              return r.branchId !== preferredBranchId;
            }
            return true;
          })
        );
      })
      .catch(() => {
        if (!canceled) setOtherLots([]);
      });
    return () => {
      canceled = true;
    };
  }, [
    searchOthers,
    practiceId,
    inventoryItemId,
    preferredBranchId,
    preferredLocationId,
    reloadTick,
    includeZero,
  ]);

  const scopeKey = `${preferredBranchId ?? ''}:${preferredLocationId ?? ''}`;
  const prevScopeRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevScopeRef.current == null) {
      prevScopeRef.current = scopeKey;
      return;
    }
    if (prevScopeRef.current === scopeKey) return;
    prevScopeRef.current = scopeKey;
    setSearchOthers(false);
    onSelectLot(null);
    onZeroOverrideReasonChange?.('');
    // Only when the invoice branch/location changes — not when the parent
    // recreates onSelectLot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  const selectValue = useMemo(() => {
    if (selectedLotId != null) return String(selectedLotId);
    return '';
  }, [selectedLotId]);

  const allKnown = useMemo(() => {
    const map = new Map<number, InventoryLotBalance>();
    for (const l of branchLots) map.set(l.id, l);
    for (const l of otherLots) map.set(l.id, l);
    return map;
  }, [branchLots, otherLots]);

  const selectedLot = selectedLotId != null ? allKnown.get(selectedLotId) ?? null : null;
  const selectedIsZero = selectedLot != null && Number(selectedLot.quantityOnHand) <= 0;

  return (
    <div className="soap-dose-lot-picker">
      <label>
        Lot
        <select
          className="soap-input"
          value={selectValue}
          disabled={disabled || loading}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : null;
            if (id == null || !Number.isFinite(id)) {
              onSelectLot(null);
              onZeroOverrideReasonChange?.('');
              return;
            }
            const lot = allKnown.get(id) ?? null;
            onSelectLot(lot);
            if (!lot || Number(lot.quantityOnHand) > 0) {
              onZeroOverrideReasonChange?.('');
            }
          }}
        >
          <option value="">
            {loading
              ? 'Loading lots…'
              : branchLots.length === 0
                ? includeZero
                  ? preferredLocationId != null
                    ? 'No lots at this location — add a lot or search others'
                    : 'No lots at this branch — add a lot or search others'
                  : 'No lots with stock — add a lot, search others, or include zero/negative lots'
                : 'Select a lot…'}
          </option>
          {branchLots.length > 0 && (
            <optgroup
              label={
                preferredLocationId != null
                  ? `${branchName ?? 'Invoice branch'} · this location`
                  : branchName
                    ? `${branchName} (invoice branch)`
                    : 'Invoice branch'
              }
            >
              {branchLots.map((lot) => (
                <option key={lot.id} value={lot.id}>
                  {lotLabel(lot, false)}
                </option>
              ))}
            </optgroup>
          )}
          {searchOthers && otherLots.length > 0 && (
            <optgroup label="Other branches">
              {otherLots.map((lot) => (
                <option key={lot.id} value={lot.id}>
                  {lotLabel(lot, true)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      <label className="soap-dose-lot-picker__zero">
        <input
          type="checkbox"
          checked={includeZero}
          disabled={disabled}
          onChange={(e) => {
            const on = e.target.checked;
            setIncludeZero(on);
            if (!on && selectedIsZero) {
              onSelectLot(null);
              onZeroOverrideReasonChange?.('');
            }
          }}
        />
        Include zero/negative lots
      </label>
      {includeZero && selectedIsZero ? (
        <label>
          Use lot despite zero/negative count — why is it still on hand? *
          <textarea
            className="soap-input"
            rows={2}
            value={zeroOverrideReason}
            disabled={disabled}
            placeholder="e.g. Bottle on truck; count not updated yet"
            onChange={(e) => onZeroOverrideReasonChange?.(e.target.value)}
          />
        </label>
      ) : null}
      <div className="soap-dose-lot-picker__actions">
        <button
          type="button"
          className="soap-btn small"
          disabled={disabled}
          onClick={() => setAddOpen(true)}
        >
          Add lot
        </button>
        {!searchOthers ? (
          <button
            type="button"
            className="soap-btn small"
            disabled={disabled}
            onClick={() => setSearchOthers(true)}
          >
            Search other locations
          </button>
        ) : (
          <button
            type="button"
            className="soap-btn small"
            disabled={disabled}
            onClick={() => setSearchOthers(false)}
          >
            Hide other locations
          </button>
        )}
      </div>
      {error && <p className="soap-dose-error">{error}</p>}
      <AddInventoryLotModal
        open={addOpen}
        practiceId={practiceId}
        inventoryItemId={inventoryItemId}
        itemName={itemName}
        defaultBranchId={preferredBranchId}
        defaultLocationId={preferredLocationId}
        requireLotNumber
        defaultQuantity={1}
        onClose={() => setAddOpen(false)}
        onCreated={(lot) => {
          setReloadTick((n) => n + 1);
          if (preferredBranchId != null && lot.branchId !== preferredBranchId) {
            setSearchOthers(true);
          }
          onSelectLot(lot);
          onZeroOverrideReasonChange?.('');
        }}
      />
    </div>
  );
}
