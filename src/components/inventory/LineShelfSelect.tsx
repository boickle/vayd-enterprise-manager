import { useEffect, useState } from 'react';
import {
  listInventoryBranchLocations,
  listPracticeBranches,
  type InventoryBranchLocation,
  type PracticeBranch,
} from '../../api/branchInventory';

export type ShelfChoice = { branchId: number; locationId: number; name: string };

type Office = { branch: PracticeBranch; locations: InventoryBranchLocation[] };

const cache = new Map<number, Promise<Office[]>>();

/** Every active office and its active shelves, loaded once per practice. */
function loadOffices(practiceId: number): Promise<Office[]> {
  let p = cache.get(practiceId);
  if (!p) {
    p = listPracticeBranches(practiceId).then((branches) =>
      Promise.all(
        branches
          .filter((b) => b.isActive !== false)
          .map(async (branch) => ({
            branch,
            locations: (await listInventoryBranchLocations(practiceId, branch.id).catch(() => [])).filter(
              (l) => l.isActive !== false
            ),
          }))
      )
    );
    p.catch(() => cache.delete(practiceId));
    cache.set(practiceId, p);
  }
  return p;
}

/**
 * The shelf one charge draws its stock from. Changing it changes this charge only; the caller
 * decides whether to offer the rest of the invoice too.
 */
export default function LineShelfSelect({
  practiceId,
  locationId,
  disabled,
  onChange,
}: {
  practiceId: number;
  locationId: number | null;
  disabled?: boolean;
  onChange: (next: ShelfChoice) => void;
}) {
  const [offices, setOffices] = useState<Office[]>([]);
  useEffect(() => {
    let canceled = false;
    void loadOffices(practiceId)
      .then((rows) => {
        if (!canceled) setOffices(rows);
      })
      .catch(() => undefined);
    return () => {
      canceled = true;
    };
  }, [practiceId]);

  return (
    <label className="settings-label" style={{ display: 'block', marginBottom: 6 }}>
      Location
      <select
        className="settings-input"
        aria-label="Location this item comes from"
        value={locationId ?? ''}
        disabled={disabled || offices.length === 0}
        onChange={(e) => {
          const id = Number(e.target.value);
          for (const o of offices) {
            const loc = o.locations.find((l) => l.id === id);
            if (loc) {
              onChange({ branchId: o.branch.id, locationId: loc.id, name: `${o.branch.name} → ${loc.name}` });
              return;
            }
          }
        }}
      >
        {locationId == null ? <option value="">Select location…</option> : null}
        {offices.map((o) => (
          <optgroup key={o.branch.id} label={o.branch.name}>
            {o.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
