import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadStripe, type Stripe, type StripeCardElement } from '@stripe/stripe-js';
import { ShieldCheck, X } from 'lucide-react';
import { getStripePublishableKey } from '../../config/paymentProvider';
import {
  createEuthanasiaSetupIntent,
  savePaymentMethod,
} from '../../api/visitWorkflow';

type Props = {
  appointmentId: number;
  clientId: number | null;
  clientName?: string;
  clientEmail?: string;
  onClose: () => void;
  onSaved: () => void;
};

/**
 * Euthanasia prepay (spec §8, Option A). At booking we save the client's card
 * with consent via a SetupIntent. No money moves and no authorization hold is
 * placed. The card is charged off-session only when the visit is completed.
 */
export default function EuthanasiaPrepayModal({
  appointmentId,
  clientId,
  clientName,
  clientEmail,
  onClose,
  onSaved,
}: Props) {
  const stripeRef = useRef<Stripe | null>(null);
  const cardRef = useRef<StripeCardElement | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const setup = await createEuthanasiaSetupIntent({
          appointmentId,
          clientId: clientId ?? undefined,
          customerEmail: clientEmail,
          customerName: clientName,
        });
        if (canceled) return;
        setInvoiceId(setup.invoiceId);
        setClientSecret(setup.setupIntentClientSecret);

        const pk = getStripePublishableKey();
        if (!pk) {
          setError('Stripe is not configured (missing publishable key).');
          return;
        }
        const stripe = await loadStripe(pk);
        if (canceled || !stripe) return;
        const elements = stripe.elements();
        const cardEl = elements.create('card', {
          style: { base: { fontSize: '16px', color: '#111827' } },
        });
        const mount = document.querySelector('#euthanasia-card-container');
        if (mount instanceof HTMLElement) cardEl.mount(mount);
        stripeRef.current = stripe;
        cardRef.current = cardEl;
        setReady(true);
      } catch (e) {
        if (!canceled) {
          setError(e instanceof Error ? e.message : 'Failed to start card setup.');
        }
      }
    })();
    return () => {
      canceled = true;
      cardRef.current?.unmount();
    };
  }, [appointmentId, clientId, clientEmail, clientName]);

  const save = async () => {
    if (!stripeRef.current || !cardRef.current || !clientSecret || !invoiceId) return;
    setBusy(true);
    setError(null);
    try {
      const { error: confirmErr, setupIntent } =
        await stripeRef.current.confirmCardSetup(clientSecret, {
          payment_method: { card: cardRef.current },
        });
      if (confirmErr) {
        setError(confirmErr.message || 'Card could not be saved.');
        return;
      }
      const pmId =
        typeof setupIntent?.payment_method === 'string'
          ? setupIntent.payment_method
          : setupIntent?.payment_method?.id;
      if (!pmId) {
        setError('Card saved but no payment method was returned.');
        return;
      }
      await savePaymentMethod(invoiceId, pmId);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save the card.');
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
            <ShieldCheck size={18} /> Save card for euthanasia visit
          </h3>
          <button type="button" className="soap-icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <p className="soap-modal-sub">
          With the client's consent, we securely save their card now. No charge is
          made and no hold is placed. The card is charged only when the visit is
          marked completed. If the pet passes before the appointment, nothing is
          charged.
        </p>
        <div id="euthanasia-card-container" className="soap-card-element" />
        {error && <div className="soap-error">{error}</div>}
        <div className="soap-modal-actions">
          <button type="button" className="soap-btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="soap-btn"
            onClick={save}
            disabled={!ready || busy}
          >
            {busy ? 'Saving…' : 'Save card with consent'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
