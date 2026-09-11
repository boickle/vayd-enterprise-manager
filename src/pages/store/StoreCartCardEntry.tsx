import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { loadStripe, type Stripe, type StripeCardElement } from '@stripe/stripe-js';
import { getStripePublishableKey } from '../../config/paymentProvider';

export type StoreCartCardEntryHandle = {
  createPaymentMethod: () => Promise<{ paymentMethodId: string; saveCard: boolean }>;
};

export type StoreCardBillingPrefill = {
  name: string;
  email?: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postal: string;
};

type Props = {
  billingPrefill: StoreCardBillingPrefill;
  onClose?: () => void;
};

const StoreCartCardEntry = forwardRef<StoreCartCardEntryHandle, Props>(function StoreCartCardEntry(
  { billingPrefill, onClose },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<Stripe | null>(null);
  const cardRef = useRef<StripeCardElement | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveCard, setSaveCard] = useState(true);
  const [billing, setBilling] = useState(billingPrefill);

  useEffect(() => {
    setBilling((prev) => ({
      name: prev.name || billingPrefill.name,
      email: prev.email || billingPrefill.email,
      line1: prev.line1 || billingPrefill.line1,
      line2: prev.line2 || billingPrefill.line2,
      city: prev.city || billingPrefill.city,
      state: prev.state || billingPrefill.state,
      postal: prev.postal || billingPrefill.postal,
    }));
  }, [billingPrefill]);

  useEffect(() => {
    let canceled = false;
    const host = hostRef.current;
    if (!host) return undefined;
    void (async () => {
      const pk = getStripePublishableKey();
      if (!pk) {
        setError('Card entry is not configured.');
        return;
      }
      const stripe = await loadStripe(pk);
      if (canceled || !stripe) return;
      const card = stripe.elements().create('card', {
        style: {
          base: { fontSize: '15px', color: '#1d2a24', fontFamily: 'inherit' },
        },
      });
      card.mount(host);
      stripeRef.current = stripe;
      cardRef.current = card;
      setReady(true);
    })();
    return () => {
      canceled = true;
      cardRef.current?.unmount();
      cardRef.current = null;
      stripeRef.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    async createPaymentMethod() {
      const stripe = stripeRef.current;
      const card = cardRef.current;
      if (!stripe || !card) throw new Error('Enter the card first.');
      const name = billing.name.trim();
      const line1 = billing.line1.trim();
      const city = billing.city.trim();
      const state = billing.state.trim();
      const postal = billing.postal.trim();
      if (!name) throw new Error('Enter the name on the card.');
      if (!line1 || !city || !state || !postal) {
        throw new Error('Enter the billing address for this card.');
      }
      const result = await stripe.createPaymentMethod({
        type: 'card',
        card,
        billing_details: {
          name,
          email: billing.email?.trim() || undefined,
          address: {
            line1,
            line2: billing.line2.trim() || undefined,
            city,
            state,
            postal_code: postal,
            country: 'US',
          },
        },
      });
      if (result.error) throw new Error(result.error.message || 'Card was declined.');
      const id = result.paymentMethod?.id;
      if (!id) throw new Error('Could not save that card.');
      return { paymentMethodId: id, saveCard };
    },
  }));

  const setField = (key: keyof StoreCardBillingPrefill, value: string) => {
    setBilling((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="vayd-store__card-entry">
      <label>
        Name on card
        <input
          value={billing.name}
          onChange={(e) => setField('name', e.target.value)}
          autoComplete="cc-name"
          placeholder="As it appears on the card"
        />
      </label>
      <div>
        <span className="vayd-store__card-label">Card number</span>
        <div ref={hostRef} className="vayd-store__card-box" />
      </div>
      {!ready && !error ? <p className="vayd-store__note">Loading card form…</p> : null}
      {error ? <p className="vayd-store__err">{error}</p> : null}
      <label className="vayd-store__cart-wide">
        Billing address
        <input
          value={billing.line1}
          onChange={(e) => setField('line1', e.target.value)}
          autoComplete="billing address-line1"
        />
      </label>
      <label>
        Apt / suite
        <input
          value={billing.line2}
          onChange={(e) => setField('line2', e.target.value)}
          autoComplete="billing address-line2"
        />
      </label>
      <label>
        City
        <input
          value={billing.city}
          onChange={(e) => setField('city', e.target.value)}
          autoComplete="billing address-level2"
        />
      </label>
      <label>
        State
        <input
          value={billing.state}
          onChange={(e) => setField('state', e.target.value)}
          autoComplete="billing address-level1"
        />
      </label>
      <label>
        ZIP
        <input
          value={billing.postal}
          onChange={(e) => setField('postal', e.target.value)}
          autoComplete="billing postal-code"
        />
      </label>
      <label className="vayd-store__card-save">
        <input
          type="checkbox"
          checked={saveCard}
          onChange={(e) => setSaveCard(e.target.checked)}
        />
        <span>Save my card on file to make future purchases easier</span>
      </label>
      {onClose ? (
        <button type="button" className="vayd-store__card-link" onClick={onClose}>
          Use a card on file instead
        </button>
      ) : null}
    </div>
  );
});

export default StoreCartCardEntry;
