import { useEffect, useRef } from 'react';

const DEFAULT_INTERVAL_MS = 45_000;

type Options = {
  enabled?: boolean;
  intervalMs?: number;
  /** When true, the refresh is skipped (modals open, saves in flight, etc.). */
  isBusy?: () => boolean;
};

/**
 * Polls on an interval while the tab is visible and refreshes when the user returns to the tab.
 * Skips refresh while {@link Options.isBusy} returns true.
 */
export function useBackgroundRefresh(refresh: () => void | Promise<void>, opts?: Options): void {
  const enabled = opts?.enabled ?? true;
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const busyRef = useRef(opts?.isBusy);
  busyRef.current = opts?.isBusy;

  useEffect(() => {
    if (!enabled) return;

    const run = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (busyRef.current?.()) return;
      void refreshRef.current();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') run();
    };

    document.addEventListener('visibilitychange', onVisibility);
    const id = window.setInterval(run, intervalMs);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(id);
    };
  }, [enabled, intervalMs]);
}
