import { useEffect, useState } from 'react';
import { fetchTasksSummary, listTasks } from '../api/tasks';
import {
  filterVisibleWatchingTasks,
  navAssignedBadgeCountFromSummary,
  navWatchingBadgeCountFromTasks,
  VAYD_TASKS_CHANGED,
} from '../utils/taskOwnership';

const WATCHING_NAV_COUNT_CAP = 200;

/** Red + purple task counts for nav badges (GET /tasks/summary + watching list). */
export function useTaskNavBadges(enabled: boolean) {
  const [assignedCount, setAssignedCount] = useState(0);
  const [watchingCount, setWatchingCount] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setAssignedCount(0);
      setWatchingCount(0);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const [summary, watchingRes] = await Promise.all([
          fetchTasksSummary(),
          listTasks({ involvement: 'watching', includeDone: false, limit: WATCHING_NAV_COUNT_CAP, offset: 0 }),
        ]);
        if (cancelled) return;
        setAssignedCount(navAssignedBadgeCountFromSummary(summary));
        setWatchingCount(navWatchingBadgeCountFromTasks(watchingRes.items));
      } catch {
        if (!cancelled) {
          setAssignedCount(0);
          setWatchingCount(0);
        }
      }
    };
    void load();
    const onRefresh = () => void load();
    window.addEventListener('focus', onRefresh);
    window.addEventListener(VAYD_TASKS_CHANGED, onRefresh);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    const interval = window.setInterval(() => void load(), 45_000);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onRefresh);
      window.removeEventListener(VAYD_TASKS_CHANGED, onRefresh);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
    };
  }, [enabled]);

  return { assignedCount, watchingCount };
}
