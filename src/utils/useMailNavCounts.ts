import { useEffect, useState } from 'react';
import { fetchMailNavCounts, MAIL_NAV_COUNTS_REFRESH, type MailNavCounts } from '../api/onlineStore';

const EMPTY: MailNavCounts = { clientReplies: 0, autoshipPaymentProblems: 0 };

/**
 * Owner (Nov 11, 2026): red counts on the Pharmacy tabs: client replies on held mail orders (Mail Order Queue)
 * and auto-ship payment problems (Auto-ships). Refreshed every minute, on focus, and when a screen asks.
 */
export function useMailNavCounts(practiceId: number, enabled: boolean): MailNavCounts {
  const [counts, setCounts] = useState<MailNavCounts>(EMPTY);
  useEffect(() => {
    if (!enabled || !practiceId) return undefined;
    let alive = true;
    const load = () =>
      fetchMailNavCounts(practiceId)
        .then((c) => {
          if (alive) setCounts(c);
        })
        .catch(() => undefined);
    void load();
    const timer = window.setInterval(load, 60_000);
    window.addEventListener('focus', load);
    window.addEventListener(MAIL_NAV_COUNTS_REFRESH, load);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', load);
      window.removeEventListener(MAIL_NAV_COUNTS_REFRESH, load);
    };
  }, [practiceId, enabled]);
  return counts;
}
