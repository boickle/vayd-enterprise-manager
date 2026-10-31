import { useEffect, useState } from 'react';
import { listPracticeBranches, type PracticeBranch } from '../api/branchInventory';
import { getCountReviewOffices } from '../api/inventoryCounts';

/**
 * Offices whose count results this person can see. Office-level reviewers can't pick
 * "All offices", so callers should default to the first branch when `allowAll` is false.
 */
export function useCountReviewBranches(practiceId: number) {
  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [allowAll, setAllowAll] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      listPracticeBranches(practiceId).catch(() => [] as PracticeBranch[]),
      getCountReviewOffices(practiceId).catch(() => 'all' as const),
    ]).then(([list, offices]) => {
      if (cancelled) return;
      const active = list.filter((b) => b.isActive !== false);
      if (offices === 'all') {
        setBranches(active);
        setAllowAll(true);
      } else {
        setBranches(active.filter((b) => offices.includes(b.id)));
        setAllowAll(false);
      }
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [practiceId]);

  return { branches, allowAll, loaded };
}

export const formatUsd = (n: number | null | undefined, signed = false) => {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
  });
  if (n < 0) return `-${abs}`;
  return signed && n > 0 ? `+${abs}` : abs;
};
