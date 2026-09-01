import { useEffect, useMemo, useState } from 'react';
import {
  getEmployeeBranches,
  listInventoryLots,
  listPracticeBranches,
  type InventoryLotBalance,
} from '../../api/branchInventory';
import { fetchEmployeeWorkdayActualByDate } from '../../api/employeeWorkdayActuals';

type Props = {
  practiceId: number;
  inventoryItemId: number;
  providerId?: number | null;
  disabled?: boolean;
  /** Currently selected lot balance id (null = free-text / none). */
  selectedLotId: number | null;
  lotNumber: string;
  onSelectLot: (lot: InventoryLotBalance | null) => void;
  onLotNumberChange: (value: string) => void;
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
 * Defaults to lots at the provider’s assigned / workday branch. “Search other branches”
 * expands the list; free-text lot entry remains as a fallback when no balance matches.
 */
export default function VaccineLotPicker({
  practiceId,
  inventoryItemId,
  providerId,
  disabled,
  selectedLotId,
  lotNumber,
  onSelectLot,
  onLotNumberChange,
}: Props) {
  const [preferredBranchId, setPreferredBranchId] = useState<number | null>(null);
  const [branchLots, setBranchLots] = useState<InventoryLotBalance[]>([]);
  const [otherLots, setOtherLots] = useState<InventoryLotBalance[]>([]);
  const [searchOthers, setSearchOthers] = useState(false);
  const [loading, setLoading] = useState(false);
  const [branchName, setBranchName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    async function resolveBranch() {
      if (providerId == null || !Number.isFinite(providerId)) {
        setPreferredBranchId(null);
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
        setPreferredBranchId(bid);
        if (bid != null) {
          setBranchName(branches.find((b) => b.id === bid)?.name ?? `Branch #${bid}`);
        }
      } catch {
        if (!canceled) setPreferredBranchId(null);
      }
    }
    void resolveBranch();
    return () => {
      canceled = true;
    };
  }, [practiceId, providerId]);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);
    void listInventoryLots(practiceId, inventoryItemId, {
      ...(preferredBranchId != null ? { branchId: preferredBranchId } : {}),
      includeZero: false,
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
  }, [practiceId, inventoryItemId, preferredBranchId]);

  useEffect(() => {
    if (!searchOthers) {
      setOtherLots([]);
      return;
    }
    let canceled = false;
    void listInventoryLots(practiceId, inventoryItemId, { includeZero: false })
      .then((rows) => {
        if (canceled) return;
        setOtherLots(
          preferredBranchId != null
            ? rows.filter((r) => r.branchId !== preferredBranchId)
            : rows
        );
      })
      .catch(() => {
        if (!canceled) setOtherLots([]);
      });
    return () => {
      canceled = true;
    };
  }, [searchOthers, practiceId, inventoryItemId, preferredBranchId]);

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
              return;
            }
            const lot = allKnown.get(id) ?? null;
            onSelectLot(lot);
          }}
        >
          <option value="">
            {loading
              ? 'Loading lots…'
              : branchLots.length === 0
                ? 'No lots at this branch — type below or search others'
                : 'Select a lot…'}
          </option>
          {branchLots.length > 0 && (
            <optgroup label={branchName ? `${branchName} (provider branch)` : 'Provider branch'}>
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
      <div className="soap-dose-lot-picker__actions">
        {!searchOthers ? (
          <button
            type="button"
            className="soap-btn small"
            disabled={disabled}
            onClick={() => setSearchOthers(true)}
          >
            Search other branches
          </button>
        ) : (
          <button
            type="button"
            className="soap-btn small"
            disabled={disabled}
            onClick={() => setSearchOthers(false)}
          >
            Hide other branches
          </button>
        )}
      </div>
      <label>
        Lot number {selectedLotId != null ? '(from selected lot)' : '(or type manually)'}
        <input
          className="soap-input"
          value={lotNumber}
          disabled={disabled || selectedLotId != null}
          onChange={(e) => onLotNumberChange(e.target.value)}
        />
      </label>
      {error && <p className="soap-dose-error">{error}</p>}
    </div>
  );
}
