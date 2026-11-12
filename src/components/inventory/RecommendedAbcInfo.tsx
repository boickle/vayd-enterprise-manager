import { useEffect, useState } from 'react';
import {
  getInventoryAbcExplanation,
  type InventoryAbcExplanation,
} from '../../api/inventoryCounts';

const COUNT_EVERY: Record<string, string> = {
  A: 'counted monthly',
  B: 'counted quarterly',
  C: 'counted twice a year',
};

function units(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return `${rounded.toLocaleString()} unit${rounded === 1 ? '' : 's'}`;
}

function explain(cls: string | null, x: InventoryAbcExplanation): string {
  if (x.drawsFrom) {
    return `This item draws stock from ${x.drawsFrom.name}, so counting and the class are set on that item.`;
  }
  if (!cls)
    return 'Not calculated yet. It is worked out the first time someone opens cycle counts.';
  const days = x.lookbackDays;
  const used = x.unitsUsed ?? 0;
  if (!used) {
    return `Not sold or used on a visit in the last ${days} days at any branch, so it is a C.`;
  }
  if (x.unitCost == null || !x.usage || x.rank == null) {
    return `${units(used)} used in the last ${days} days, but there is no cost on file. Classes rank by dollars used, so add a cost to rank it.`;
  }
  const cutoffs = [
    x.aMinUsage != null ? `A is the top 20% (${money(x.aMinUsage)} or more right now)` : null,
    x.bMinUsage != null ? `B is the next 30% (${money(x.bMinUsage)} or more)` : null,
    'C is everything else',
  ]
    .filter(Boolean)
    .join(', ');
  return `${money(x.usage)} used in the last ${days} days across all branches (${units(used)} × ${money(x.unitCost)} cost). That ranks #${x.rank} of ${x.itemsWithUsage} stock items by dollars used. ${cutoffs}.`;
}

function money(n: number): string {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

export default function RecommendedAbcInfo({
  practiceId,
  itemId,
  recommendedAbc,
}: {
  practiceId: number;
  itemId: number;
  recommendedAbc: string | null;
}) {
  const [info, setInfo] = useState<InventoryAbcExplanation | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    setFailed(false);
    getInventoryAbcExplanation(practiceId, itemId)
      .then((x) => {
        if (!cancelled) setInfo(x);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [practiceId, itemId]);

  return (
    <div style={{ flex: '1 1 100%' }}>
      <div className="settings-label" style={{ marginBottom: 4 }}>
        Recommended class
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <strong style={{ fontSize: 18 }}>{recommendedAbc ?? '—'}</strong>
        {recommendedAbc && COUNT_EVERY[recommendedAbc] ? (
          <span className="settings-muted" style={{ fontSize: 13 }}>
            {COUNT_EVERY[recommendedAbc]}
          </span>
        ) : null}
      </div>
      <p className="settings-muted" style={{ margin: '4px 0 0', fontSize: 13, maxWidth: 560 }}>
        {info
          ? explain(recommendedAbc, info)
          : failed
            ? 'Could not load why this class was picked.'
            : 'Loading…'}
      </p>
    </div>
  );
}
