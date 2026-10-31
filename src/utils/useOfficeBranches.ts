import { useEffect, useState } from 'react';
import { listPracticeBranches, type PracticeBranch } from '../api/branchInventory';
import { fetchMyOffices } from '../api/permissions';

/**
 * Active branches where the signed-in user holds any of `keys`. Someone whose role is for one
 * office (an inventory manager for her own location) sees just that office (owner decision,
 * Oct 30, 2026). `allowAll` is false then, so pages hide "All offices".
 */
export function useOfficeBranches(practiceId: number, keys: string[]) {
  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [allowAll, setAllowAll] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const keyList = keys.join(',');

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      listPracticeBranches(practiceId).catch(() => [] as PracticeBranch[]),
      Promise.all(
        keyList.split(',').map((k) => fetchMyOffices(practiceId, k).catch(() => [] as number[]))
      ),
    ]).then(([list, perKey]) => {
      if (cancelled) return;
      const active = list.filter((b) => b.isActive !== false);
      if (perKey.some((o) => o === 'all')) {
        setBranches(active);
        setAllowAll(true);
      } else {
        const ids = new Set(perKey.flatMap((o) => (o === 'all' ? [] : o)));
        setBranches(active.filter((b) => ids.has(b.id)));
        setAllowAll(false);
      }
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [practiceId, keyList]);

  return { branches, allowAll, loaded };
}
