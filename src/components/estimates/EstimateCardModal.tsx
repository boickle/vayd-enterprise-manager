import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadStripe, type Stripe, type StripeCardElement } from '@stripe/stripe-js';
import { ShieldCheck, X } from 'lucide-react';
import { apiErrorMessage } from '../../api/http';
import { getStripePublishableKey } from '../../config/paymentProvider';
import {
  createEstimateSetupIntent,
  recordEstimateAuthorization,
  type VisitEstimate,
} from '../../api/visitEstimates';
import '../soap/EuthanasiaEstimateModal.css';

type Props = {
  estimateId: string;
  clientName?: string | null;
  clientEmail?: string | null;
  onClose: () => void;
  onSaved: (estimate: VisitEstimate) => void;
};

const money = (n: number) =>
  Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/**
 * Card by phone. Staff enter the number in Stripe and we place a hold for the
 * quoted total. Nothing is captured until after the visit.
 */
export default function EstimateCardModal({
  estimateId,
  clientName,
  clientEmail,
  onClose,
  onSaved,
}: Props) {
  const stripeRef = useRef<Stripe | null>(null);
  const cardRef = useRef<StripeCardElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const setup = await createEstimateSetupIntent(estimateId, {
          customerEmail: clientEmail,
          customerName: clientName,
        });
        if (canceled) return;
        const secret =
          setup.paymentIntentClientSecret || setup.setupIntentClientSecret;
        setClientSecret(secret);
        setAmount(setup.amount);

        const pk = getStripePublishableKey();
        if (!pk) {
          setError('Stripe is not configured (missing publishable key).');
          return;
        }
        const stripe = await loadStripe(pk);
        if (canceled || !stripe) return;
        const host = hostRef.current;
        if (!host) {
          setError('Card form could not mount. Close and try again.');
          return;
        }
        const cardEl = stripe.elements().create('card', {
          style: { base: { fontSize: '16px', color: '#111827' } },
        });
        cardEl.mount(host);
        stripeRef.current = stripe;
        cardRef.current = cardEl;
        setReady(true);
      } catch (e) {
        if (!canceled) {
          setError(apiErrorMessage(e) || 'Failed to start card authorization.');
        }
      }
    })();
    return () => {
      canceled = true;
      cardRef.current?.unmount();
      cardRef.current = null;
      stripeRef.current = null;
    };
  }, [estimateId, clientEmail, clientName]);

  const authorize = async () => {
    if (!stripeRef.current || !cardRef.current || !clientSecret) return;
    setBusy(true);
    setError(null);
    try {
      const { error: confirmErr, paymentIntent } =
        await stripeRef.current.confirmCardPayment(clientSecret, {
          payment_method: { card: cardRef.current },
        });
      if (confirmErr) {
        setError(confirmErr.message || 'Card could not be authorized.');
        return;
      }
      if (
        paymentIntent?.status !== 'requires_capture' &&
        paymentIntent?.status !== 'succeeded'
      ) {
        setError(
          paymentIntent?.status
            ? `Stripe returned ${paymentIntent.status}.`
            : 'Authorization did not complete.'
        );
        return;
      }
      const pmId =
        typeof paymentIntent.payment_method === 'string'
          ? paymentIntent.payment_method
          : paymentIntent.payment_method?.id;
      onSaved(
        await recordEstimateAuthorization(estimateId, {
          paymentIntentId: paymentIntent.id,
          paymentMethodId: pmId ?? null,
        })
      );
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e) || 'Failed to authorize the card.');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="scheduler-modal-backdrop" onClick={onClose}>
      <div
        className="scheduler-modal soap-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="soap-modal-head">
          <h3>
            <ShieldCheck size={18} /> Take card over the phone
          </h3>
          <button type="button" className="soap-icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <p className="soap-modal-sub">
          With the client on the line, tell them their card will not be charged
          until the day of service. Then, with their permission, enter the card
          in Stripe. We place a hold
          {amount != null ? ` for ${money(amount)}` : ''} now — nothing is
          captured until the visit.
        </p>
        <div ref={hostRef} className="estimate-card-element" />
        {!ready && !error ? (
          <p className="estimate-empty">Loading Stripe…</p>
        ) : null}
        {error && <div className="soap-error">{error}</div>}
        <div className="soap-modal-actions">
          <button type="button" className="soap-btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="soap-btn"
            onClick={() => void authorize()}
            disabled={!ready || busy}
          >
            {busy
              ? 'Authorizing…'
              : amount != null
                ? `Authorize ${money(amount)}`
                : 'Authorize hold'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
