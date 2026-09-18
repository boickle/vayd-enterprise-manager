import { useEffect, useRef, useState } from 'react';
import { loadStripe, type Stripe, type StripeCardElement } from '@stripe/stripe-js';
import { getStripePublishableKey } from '../config/paymentProvider';

export default function ConsentCardPay({
  name,
  email,
  onReady,
}: {
  name: string;
  email: string;
  onReady: (create: () => Promise<string>) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stripeRef = useRef<Stripe | null>(null);
  const cardRef = useRef<StripeCardElement | null>(null);
  const [cardName, setCardName] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setCardName((prev) => prev || name);
  }, [name]);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return undefined;
    void (async () => {
      const pk = getStripePublishableKey();
      if (!pk) {
        setError('Card payment is not configured.');
        return;
      }
      const stripe = await loadStripe(pk);
      if (cancelled || !stripe) return;
      const card = stripe.elements().create('card', {
        style: { base: { fontSize: '16px', color: '#1f2937', fontFamily: 'inherit' } },
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
        billing_details: { name: trimmed, email: email.trim() || undefined },
      });
      if (result.error) throw new Error(result.error.message || 'Card was declined.');
      const id = result.paymentMethod?.id;
      if (!id) throw new Error('Could not use that card.');
      return id;
    });
  }, [cardName, email, onReady, ready]);

  return (
    <div className="consent-pay">
      <label className="consent-field">
        Name on card
        <input value={cardName} onChange={(e) => setCardName(e.target.value)} autoComplete="cc-name" />
      </label>
      <div className="consent-card-box" ref={hostRef} />
      {!ready && !error ? <p className="consent-muted">Loading card form…</p> : null}
      {error ? <p className="consent-error">{error}</p> : null}
    </div>
  );
}
