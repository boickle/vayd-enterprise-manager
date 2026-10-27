import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getIdexxInvoiceState,
  syncIdexxOrder,
  type IdexxInvoiceLine,
  type IdexxInvoiceState,
  type IdexxOrder,
  type IdexxSyncResult,
} from '../../api/idexx';

export type IdexxSyncNote = {
  orderId: number;
  added: string[];
  uncaptured: IdexxSyncResult['uncaptured'];
};

/**
 * IDEXX state for one bill. Orders still being finished in VetConnect PLUS are re-read
 * when the user comes back to this tab, so the chip moves on and any tests added there
 * land on the bill (`onChargesAdded` reloads it).
 */
export function useIdexxInvoice(
  invoiceId: string | null | undefined,
  labLineKey: string,
  onChargesAdded?: () => void
) {
  const [state, setState] = useState<IdexxInvoiceState | null>(null);
  const [notes, setNotes] = useState<IdexxSyncNote[]>([]);
  const chargesAdded = useRef(onChargesAdded);
  chargesAdded.current = onChargesAdded;

  const reload = useCallback(async () => {
    if (!invoiceId || !labLineKey) {
      setState(null);
      return;
    }
    try {
      setState(await getIdexxInvoiceState(invoiceId));
    } catch {
      setState(null);
    }
  }, [invoiceId, labLineKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const sync = useCallback(
    async (orderId: number) => {
      const res = await syncIdexxOrder(orderId);
      if (res.added.length || res.uncaptured.length) {
        setNotes((prev) => [...prev.filter((n) => n.orderId !== orderId), { orderId, ...res }]);
      }
      if (res.added.length) chargesAdded.current?.();
      await reload();
      return res;
    },
    [reload]
  );

  // Coming back from the IDEXX tab: pick up submitted orders and added tests.
  const draftKey = (state?.orders ?? [])
    .filter((o) => o.status === 'CREATED')
    .map((o) => o.id)
    .join(',');
  useEffect(() => {
    if (!draftKey) return;
    const ids = draftKey.split(',').map(Number);
    const onFocus = () => {
      for (const id of ids) void sync(id).catch(() => undefined);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [draftKey, sync]);

  const orderById = useMemo(() => new Map((state?.orders ?? []).map((o) => [o.id, o])), [state]);
  const lineById = useMemo(() => new Map((state?.lines ?? []).map((l) => [l.lineId, l])), [state]);

  const lineOrder = useCallback(
    (lineId: string): IdexxOrder | null => {
      const line = lineById.get(lineId);
      return line?.orderId != null ? (orderById.get(line.orderId) ?? null) : null;
    },
    [lineById, orderById]
  );

  /** IDEXX lines for a pet not on a live order yet. */
  const unsentFor = useCallback(
    (patientId: number | null): IdexxInvoiceLine[] =>
      (state?.lines ?? []).filter((l) => {
        if (patientId != null && l.patientId !== patientId) return false;
        const order = l.orderId != null ? orderById.get(l.orderId) : null;
        return !order || order.status === 'CANCELLED';
      }),
    [state, orderById]
  );

  /** Asks before removing a line on a live IDEXX order; removing it cancels the order. */
  const confirmRemove = useCallback(
    async (
      lineId: string,
      confirm: (opts: {
        title: string;
        message: string;
        confirmLabel: string;
        cancelLabel: string;
      }) => Promise<boolean>
    ) => {
      const order = lineOrder(lineId);
      if (!order || order.status === 'CANCELLED') return true;
      return confirm({
        title: 'Cancel the IDEXX order?',
        message: `This test is on IDEXX order #${order.idexxOrderId}. Removing it cancels the order with IDEXX${
          order.status === 'SUBMITTED' ? ', so don’t send the sample' : ''
        }. If IDEXX already has the sample or sent results, the charge stays.`,
        confirmLabel: 'Remove and cancel order',
        cancelLabel: 'Keep',
      });
    },
    [lineOrder]
  );

  return {
    state,
    confirmRemove,
    configured: state?.configured ?? false,
    isIdexxLine: (lineId: string) => lineById.has(lineId),
    lineOrder,
    unsentFor,
    notes,
    reload,
    sync,
  };
}
