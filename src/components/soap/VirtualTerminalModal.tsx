import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadStripe, type Stripe, type StripeCardElement } from '@stripe/stripe-js';
import { loadStripePublishableKey } from '../../api/practicePublicConfig';
import { chargeKeyedCard, type VisitInvoice } from '../../api/visitWorkflow';
import './VirtualTerminalModal.css';

type Props = {
  invoiceId: string;
  amountDue: number;
  ownerName?: string | null;
  /** Household already said no to a saved card; start unchecked and say so. */
  declinedBefore?: boolean;
  onCancel: () => void;
  onPaid: (invoice: VisitInvoice) => void;
};

export default function VirtualTerminalModal({
  invoiceId,
  amountDue,
  ownerName,
  declinedBefore = false,
  onCancel,
  onPaid,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stripeRef = useRef<Stripe | null>(null);
  const cardRef = useRef<StripeCardElement | null>(null);
  const [cardName, setCardName] = useState(ownerName ?? '');
  const [saveCard, setSaveCard] = useState(false);
  const [ready, setReady] = useState(false);
  const [complete, setComplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return undefined;
    void (async () => {
      const pk = await loadStripePublishableKey().catch(() => '');
      if (!pk) {
        setError('Card entry is not configured.');
        return;
      }
      const stripe = await loadStripe(pk);
      if (cancelled || !stripe) return;
      const card = stripe.elements().create('card', {
        style: { base: { fontSize: '15px', color: '#1d2a24', fontFamily: 'inherit' } },
      });
      card.on('change', (e) => {
        setComplete(e.complete);
        setError(e.error?.message ?? null);
      });
      card.mount(host);
      stripeRef.current = stripe;
      cardRef.current = card;
      setReady(true);
    })();
    return () => {
      cancelled = true;
      cardRef.current?.unmount();
      cardRef.current = null;
      stripeRef.current = null;
    };
  }, []);

  const charge = async () => {
    const stripe = stripeRef.current;
    const card = cardRef.current;
    if (!stripe || !card) return;
    const name = cardName.trim();
    if (!name) {
      setError('Enter the name on the card.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await stripe.createPaymentMethod({
        type: 'card',
        card,
        billing_details: { name },
      });
      if (result.error || !result.paymentMethod?.id) {
        throw new Error(result.error?.message || 'That card could not be used.');
      }
      const invoice = await chargeKeyedCard(invoiceId, {
        paymentMethodId: result.paymentMethod.id,
        saveCard,
      });
      onPaid(invoice);
    } catch (e) {
      const message =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (e instanceof Error ? e.message : '') ||
        'The card could not be charged.';
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="virtual-terminal-backdrop" role="dialog" aria-modal="true">
      <div className="virtual-terminal">
        <h3>Card over the phone</h3>
        <p className="virtual-terminal__amount">
          Charge <strong>${amountDue.toFixed(2)}</strong>
        </p>
        <label className="virtual-terminal__field">
          Name on card
          <input
            value={cardName}
            onChange={(e) => setCardName(e.target.value)}
            autoComplete="off"
          />
        </label>
        <div className="virtual-terminal__field">
          Card number, expiry, CVC and ZIP
          <div className="virtual-terminal__card" ref={hostRef} />
        </div>
        {!ready && !error ? <p className="virtual-terminal__hint">Loading card form…</p> : null}
        <label className="virtual-terminal__check">
          <input
            type="checkbox"
            checked={saveCard}
            onChange={(e) => setSaveCard(e.target.checked)}
          />
          <span>
            Owner agreed to keep this card on file
            <span className="virtual-terminal__hint">
              {declinedBefore
                ? 'They said no last time — only tick this if they have changed their mind.'
                : 'Ask first. Leave unticked to use the card for this payment only.'}
            </span>
          </span>
        </label>
        {error ? <p className="virtual-terminal__error">{error}</p> : null}
        <div className="virtual-terminal__actions">
          <button
            type="button"
            className="btn primary"
            disabled={!ready || !complete || busy}
            onClick={() => void charge()}
          >
            {busy ? 'Charging…' : `Charge $${amountDue.toFixed(2)}`}
          </button>
          <button type="button" className="btn secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
