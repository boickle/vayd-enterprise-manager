import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadStripe, type Stripe, type StripeCardElement } from '@stripe/stripe-js';
import { loadStripePublishableKey } from '../../api/practicePublicConfig';
import { isNetworkError, NOT_CHARGED_OFFLINE_MESSAGE } from '../../api/http';
import { chargeKeyedCard, type VisitInvoice } from '../../api/visitWorkflow';
import './VirtualTerminalModal.css';
import { CARD_ON_FILE_STAFF_WORDING } from '../../utils/cardOnFileWording';

type Props = {
  invoiceId: string;
  amountDue: number;
  ownerName?: string | null;
  /** Household already said no to a saved card; start unchecked and say so. */
  declinedBefore?: boolean;
  /**
   * The owner's answer from the checkout's "keep this card on file" box. When given, this window
   * doesn't ask again: it says what will happen instead (owner, Nov 13, 2026: ask once).
   */
  consentFromCheckout?: boolean;
  /** The card already on file, e.g. "Visa •••• 4242". Saving this card replaces it. */
  currentCardLabel?: string | null;
  onCancel: () => void;
  /** savedCard: the card the owner agreed to keep (its id), or null when used for this payment only. */
  onPaid: (invoice: VisitInvoice, savedCard: string | null) => void;
};

export default function VirtualTerminalModal({
  invoiceId,
  amountDue,
  ownerName,
  declinedBefore = false,
  consentFromCheckout,
  currentCardLabel,
  onCancel,
  onPaid,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stripeRef = useRef<Stripe | null>(null);
  const cardRef = useRef<StripeCardElement | null>(null);
  const [cardName, setCardName] = useState(ownerName ?? '');
  const askedAtCheckout = consentFromCheckout !== undefined;
  const [saveCard, setSaveCard] = useState(consentFromCheckout === true);
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
      onPaid(invoice, saveCard ? result.paymentMethod.id : null);
    } catch (e) {
      if (isNetworkError(e)) {
        setError(NOT_CHARGED_OFFLINE_MESSAGE);
        return;
      }
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
        <h3>Type card manually</h3>
        <p className="virtual-terminal__hint">
          Typed-in cards cost us a higher card fee than Tap to Pay. Use this when the reader isn&apos;t working, the card won&apos;t tap, or the owner isn&apos;t with you.
        </p>
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
        {askedAtCheckout ? (
          <p className="virtual-terminal__hint" data-testid="virtual-terminal-consent-note">
            {saveCard
              ? 'This card will be kept on file: the owner agreed at checkout.'
              : 'For this payment only: the card won’t be kept on file (the checkout box isn’t ticked).'}
          </p>
        ) : (
        <label className="virtual-terminal__check">
          <input
            type="checkbox"
            checked={saveCard}
            onChange={(e) => setSaveCard(e.target.checked)}
          />
          <span>
            {CARD_ON_FILE_STAFF_WORDING}
            <span className="virtual-terminal__hint">
              {currentCardLabel
                ? `Ticking this replaces ${currentCardLabel} as the card on file. Leave unticked to use this card for this payment only.`
                : declinedBefore
                ? 'They said no last time — only tick this if they have changed their mind.'
                : 'Ask first. Leave unticked to use the card for this payment only.'}
            </span>
          </span>
        </label>
        )}
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
