import { useEffect, useState } from 'react';
import { Check, Pill, RotateCcw, X } from 'lucide-react';
import { setOrderState, updateOrder, type EncounterOrder } from '../../api/visitWorkflow';
import { fetchCatalogPricingForOrder, getCatalogLinePrice } from '../../utils/catalogItemPricing';

type Props = {
  encounterId: string;
  orders: EncounterOrder[];
  disabled?: boolean;
  patientId?: number;
  clientId?: number;
  practiceId: number;
  onChange: (orders: EncounterOrder[]) => void;
  onInvoiceShouldRefresh: () => void;
  /** Marks Room Loader–originated order ids so Accept does not resurface them on the left Plan list. */
  onRoomLoaderOrderIds: (ids: string[]) => void;
};

function money(n: number): string {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

/**
 * Room Loader estimate lines waiting for accept/decline (and declined lines waiting for
 * re-add). Lives in the checkout aside so decisions stay on the right: Accept charges into
 * Checkout; Decline stays here.
 */
export default function ProposedOrdersPanel({
  encounterId,
  orders,
  disabled,
  patientId,
  clientId,
  practiceId,
  onChange,
  onInvoiceShouldRefresh,
  onRoomLoaderOrderIds,
}: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const pending = orders.filter((o) => o.state === 'proposed' || o.state === 'declined');
  const pendingIdsKey = pending.map((o) => o.id).join(',');

  // Keep Room Loader ids tagged even when declined from elsewhere, so Re-add / Accept
  // charges Checkout only and never drops back into the left Plan list.
  useEffect(() => {
    if (!pendingIdsKey) return;
    onRoomLoaderOrderIds(pendingIdsKey.split(','));
  }, [pendingIdsKey, onRoomLoaderOrderIds]);

  if (pending.length === 0) return null;

  const canPrice = patientId != null && Number.isFinite(patientId);

  const changeState = async (order: EncounterOrder, state: 'accepted' | 'declined') => {
    if (busyId) return;
    setBusyId(order.id);
    try {
      onRoomLoaderOrderIds([order.id]);
      let updated = await setOrderState(encounterId, order.id, state);

      if (state === 'accepted' && order.catalogItemId != null && canPrice) {
        const snapshot = await fetchCatalogPricingForOrder({
          order: updated,
          patientId: patientId!,
          practiceId,
          clientId,
        });
        if (snapshot) {
          const qty = Number(updated.qty) || 1;
          const { unitFinal, isCovered } = getCatalogLinePrice(snapshot, qty);
          // Never overwrite a Room Loader / existing price with $0 from a failed catalog lookup.
          // Covered membership lines legitimately price at 0; everything else keeps what it has.
          const keepExisting = unitFinal === 0 && !isCovered && Number(updated.unitPrice) > 0;
          if (
            !keepExisting &&
            (unitFinal !== Number(updated.unitPrice) || isCovered !== updated.isCovered)
          ) {
            updated = await updateOrder(encounterId, updated.id, {
              unitPrice: unitFinal,
              isCovered,
            });
          }
        }
      }

      onChange(orders.map((o) => (o.id === order.id ? updated : o)));
      onInvoiceShouldRefresh();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="soap-aside-proposed">
      <div className="soap-subhead">Proposed (from Room Loader) — accept or decline</div>
      <p className="soap-aside-proposed-hint">
        Already on the visit from the pre-visit estimate. Accept to charge (it appears in Checkout),
        or decline if you won&apos;t do it — check these before adding the same item from Plan.
      </p>
      {pending.map((o) => (
        <div key={o.id} className={`soap-order ${o.state}`}>
          <span className="soap-order-name">
            {o.kind === 'med' && <Pill size={13} />} {o.name}
            {Number(o.qty) > 1 && <span className="soap-order-qty"> ×{Number(o.qty)}</span>}
            {o.state === 'declined' && <span className="soap-tag declined">declined</span>}
          </span>
          <span className="soap-order-price">
            {o.isCovered ? '—' : money(Number(o.qty) * Number(o.unitPrice))}
          </span>
          <div className="soap-order-actions">
            {o.state === 'declined' ? (
              <button
                type="button"
                className="soap-btn small ok"
                disabled={disabled || busyId != null}
                onClick={() => void changeState(o, 'accepted')}
              >
                <RotateCcw size={13} /> Re-add
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="soap-btn small ok"
                  disabled={disabled || busyId != null}
                  onClick={() => void changeState(o, 'accepted')}
                >
                  <Check size={13} /> Accept
                </button>
                <button
                  type="button"
                  className="soap-btn small danger"
                  disabled={disabled || busyId != null}
                  onClick={() => void changeState(o, 'declined')}
                >
                  <X size={13} /> Decline
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
