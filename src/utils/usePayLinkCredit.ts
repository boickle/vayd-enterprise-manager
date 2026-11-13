import { useCallback, useEffect, useState } from 'react';
import { fetchAvailableAccountCredit } from '../api/visitWorkflow';

/**
 * The family's spendable account credit, for the ledger's pay-link line. It loads when the client
 * or the amount owed changes, and again whenever `refreshCredit()` is called (after Add credit, a
 * payment, a return, or anything else that moves account credit) so the line never goes stale.
 */
export function usePayLinkCredit(
  clientId: number | string | null | undefined,
  unpaidTotal: number
): { credit: number; refreshCredit: () => void } {
  const [credit, setCredit] = useState(0);
  const [tick, setTick] = useState(0);
  const refreshCredit = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (clientId == null || unpaidTotal <= 0.009) {
      setCredit(0);
      return;
    }
    let cancelled = false;
    // D7 option 3: a deposit held for one of the unpaid bills' own visits comes off the link too.
    void fetchAvailableAccountCredit(Number(clientId), undefined, { forPayLink: true })
      .then((c) => {
        if (!cancelled) setCredit((Number(c.total) || 0) + (Number(c.payLinkDeposit) || 0));
      })
      .catch(() => {
        if (!cancelled) setCredit(0);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, unpaidTotal, tick]);
  return { credit, refreshCredit };
}
