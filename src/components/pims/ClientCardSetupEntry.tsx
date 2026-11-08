import { useEffect, useRef, useState } from 'react';
import { loadStripe, type Stripe, type StripeCardElement } from '@stripe/stripe-js';
import { loadStripePublishableKey } from '../../api/practicePublicConfig';

/**
 * Stripe card box for saving a card with a SetupIntent (no charge). The parent gets `confirm`,
 * which confirms the SetupIntent with what was typed and returns the SetupIntent id.
 */
export default function ClientCardSetupEntry({
  name,
  onReady,
}: {
  name?: string | null;
  onReady: (confirm: (clientSecret: string) => Promise<string>) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stripeRef = useRef<Stripe | null>(null);
  const cardRef = useRef<StripeCardElement | null>(null);
  const [cardName, setCardName] = useState(name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return undefined;
    void (async () => {
      const pk = await loadStripePublishableKey();
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
    onReady(async (clientSecret: string) => {
      const stripe = stripeRef.current;
      const card = cardRef.current;
      if (!stripe || !card) throw new Error('Enter the card first.');
      const trimmed = cardName.trim();
      if (!trimmed) throw new Error('Enter the name on the card.');
      const result = await stripe.confirmCardSetup(clientSecret, {
        payment_method: { card, billing_details: { name: trimmed } },
      });
      if (result.error) throw new Error(result.error.message || 'That card could not be used.');
      const id = result.setupIntent?.id;
      if (!id) throw new Error('Could not use that card.');
      return id;
    });
  }, [cardName, onReady, ready]);

  return (
    <div className="client-card__entry">
      <label className="client-card__field">
        <span>Name on card</span>
        <input value={cardName} onChange={(e) => setCardName(e.target.value)} autoComplete="cc-name" />
      </label>
      <div className="client-card__box" ref={hostRef} />
      {!ready && !error ? <p className="client-card__muted">Loading card form…</p> : null}
      {error ? <p className="client-fin__err">{error}</p> : null}
    </div>
  );
}
