import { useEffect, useRef, useState } from 'react';
import { loadStripe, type Stripe, type StripeCardElement } from '@stripe/stripe-js';
import { getStripePublishableKey } from '../../config/paymentProvider';

export default function PostVisitCardEntry({
  name,
  onReady,
}: {
  name?: string | null;
  onReady: (create: () => Promise<string>) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stripeRef = useRef<Stripe | null>(null);
  const cardRef = useRef<StripeCardElement | null>(null);
  const [cardName, setCardName] = useState(name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setCardName((prev) => prev || name || '');
  }, [name]);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return undefined;
    void (async () => {
      const pk = getStripePublishableKey();
      if (!pk) {
        setError('Card entry is not configured.');
        return;
      }
      const stripe = await loadStripe(pk);
      if (cancelled || !stripe) return;
      const card = stripe.elements().create('card', {
        style: { base: { fontSize: '15px', color: '#1d2a24', fontFamily: 'inherit' } },
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

  useEffect(() => {
    onReady(async () => {
      const stripe = stripeRef.current;
      const card = cardRef.current;
      if (!stripe || !card) throw new Error('Enter the card first.');
      const trimmed = cardName.trim();
      if (!trimmed) throw new Error('Enter the name on the card.');
      const result = await stripe.createPaymentMethod({
        type: 'card',
        card,
        billing_details: { name: trimmed },
      });
      if (result.error) throw new Error(result.error.message || 'That card could not be used.');
      const id = result.paymentMethod?.id;
      if (!id) throw new Error('Could not use that card.');
      return id;
    });
  }, [cardName, onReady, ready]);

  return (
    <div className="pvms-card-entry">
      <label className="pvms-field">
        <span className="pvms-field__label">Name on card</span>
        <input
          value={cardName}
          onChange={(e) => setCardName(e.target.value)}
          autoComplete="cc-name"
        />
      </label>
      <div className="pvms-card-box" ref={hostRef} />
      {!ready && !error ? <p className="pvms-muted">Loading card form…</p> : null}
      {error ? <p className="pvms-form-error">{error}</p> : null}
    </div>
  );
}
