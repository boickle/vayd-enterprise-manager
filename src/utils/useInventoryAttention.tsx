import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { getInventoryAttention, type InventoryAttention } from '../api/inventoryCounts';
import { resolvePracticeIdFromToken } from './practiceIdFromToken';

const REFRESH_EVENT = 'inventory-attention-refresh';
const POLL_MS = 5 * 60 * 1000;

let cached: { practiceId: number; at: number; data: InventoryAttention } | null = null;
let inflight: Promise<InventoryAttention | null> | null = null;

function load(practiceId: number, force = false): Promise<InventoryAttention | null> {
  if (!force && cached?.practiceId === practiceId && Date.now() - cached.at < 60_000) {
    return Promise.resolve(cached.data);
  }
  if (inflight && !force) return inflight;
  inflight = getInventoryAttention(practiceId)
    .then((data) => {
      cached = { practiceId, at: Date.now(), data };
      return data;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Call after resolving something that changes the badge counts. */
export function refreshInventoryAttention() {
  window.dispatchEvent(new Event(REFRESH_EVENT));
}

/** Things in inventory reports that need someone to look at them (for badges). */
export function useInventoryAttention(enabled = true) {
  const { token } = useAuth() as { token: string | null };
  const practiceId = resolvePracticeIdFromToken(token);
  const { pathname } = useLocation();
  const [data, setData] = useState<InventoryAttention | null>(
    cached?.practiceId === practiceId ? cached.data : null
  );

  useEffect(() => {
    if (!enabled || !token || !practiceId) return;
    let alive = true;
    const run = (force = false) =>
      void load(practiceId, force).then((d) => {
        if (alive && d) setData(d);
      });
    run();
    const timer = window.setInterval(() => run(true), POLL_MS);
    const onRefresh = () => run(true);
    window.addEventListener(REFRESH_EVENT, onRefresh);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener(REFRESH_EVENT, onRefresh);
    };
  }, [enabled, token, practiceId, pathname]);

  const flaggedCounts = data?.flaggedCounts ?? 0;
  const costReviews = data?.costReviews ?? 0;
  const shrinkAlert = Boolean(data?.shrink.alert);
  return {
    data,
    flaggedCounts,
    costReviews,
    shrinkAlert,
    total: flaggedCounts + costReviews + (shrinkAlert ? 1 : 0),
  };
}

export function AttentionBadge({ count, title }: { count: number | '!'; title?: string }) {
  if (count === 0) return null;
  return (
    <span
      title={title}
      aria-label={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 18,
        height: 18,
        padding: '0 5px',
        marginLeft: 6,
        borderRadius: 9,
        background: '#d92d20',
        color: '#fff',
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1,
        verticalAlign: 'middle',
      }}
    >
      {typeof count === 'number' && count > 99 ? '99+' : count}
    </span>
  );
}
