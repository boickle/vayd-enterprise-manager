import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { loadStripe, type Stripe, type StripeCardElement } from '@stripe/stripe-js';
import {
  saveMembershipRenewalCard,
  type MembershipBillingInterval,
  type MembershipRenewalCardResult,
  type MembershipRenewalPreview,
} from '../api/memberships';
import { loadStripePublishableKey } from '../api/practicePublicConfig';
import RenewalPlanPicker, { intervalAvailable } from './RenewalPlanPicker';

type Props = {
  token: string;
  preview: MembershipRenewalPreview;
  money: (value: number | null) => string;
  formatDay: (iso: string) => string;
  extractErr: (error: unknown) => string;
  onSaved: (result: MembershipRenewalCardResult) => void;
};

/** Legacy Square members: pick next year's plan and save a card in Stripe. */
export default function MembershipRenewalCard({
  token,
  preview,
  money,
  formatDay,
  extractErr,
  onSaved,
}: Props) {
  const options = preview.planOptions;
  const [packageId, setPackageId] = useState<number>(preview.recommendedPackageId);
  const [interval, setBillingInterval] = useState<MembershipBillingInterval>(
    preview.billingInterval ?? 'monthly'
  );
  const [nameOnCard, setNameOnCard] = useState('');
  const [cardReady, setCardReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cardMountRef = useRef<HTMLDivElement | null>(null);
  const stripeRef = useRef<Stripe | null>(null);
  const cardRef = useRef<StripeCardElement | null>(null);

  const selected = useMemo(
    () => options.find((o) => o.packageId === packageId) ?? options[0] ?? null,
    [options, packageId]
  );

  useEffect(() => {
    if (!selected || intervalAvailable(selected, interval)) return;
    const other: MembershipBillingInterval = interval === 'annual' ? 'monthly' : 'annual';
    if (intervalAvailable(selected, other)) setBillingInterval(other);
  }, [selected, interval]);

  useEffect(() => {
    let canceled = false;
    async function init() {
      const pk = await loadStripePublishableKey();
      if (canceled) return;
      if (!pk) {
        setError('Card entry is not available right now. Please call us to finish renewing.');
        return;
      }
      try {
        const stripe = await loadStripe(pk);
        if (canceled || !stripe || !cardMountRef.current) return;
        const card = stripe.elements().create('card', {
          style: {
            base: { fontSize: '16px', color: '#111827', '::placeholder': { color: '#9ca3af' } },
            invalid: { color: '#b91c1c' },
          },
        });
        card.mount(cardMountRef.current);
        stripeRef.current = stripe;
        cardRef.current = card;
        setCardReady(true);
      } catch (err) {
        if (!canceled) setError(extractErr(err));
      }
    }
    void init();
    return () => {
      canceled = true;
      setCardReady(false);
      try {
        cardRef.current?.unmount();
      } catch {
        /* ignore */
      }
    };
  }, [extractErr]);

  const price =
    selected == null ? null : interval === 'annual' ? selected.annualPrice : selected.monthlyPrice;
  const canSubmit =
    cardReady && !submitting && selected != null && intervalAvailable(selected, interval);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selected || !stripeRef.current || !cardRef.current) return;
    setSubmitting(true);
    setError(null);
    try {
      const { paymentMethod, error: stripeError } = await stripeRef.current.createPaymentMethod({
        type: 'card',
        card: cardRef.current,
        billing_details: { name: nameOnCard.trim() || undefined },
      });
      if (stripeError || !paymentMethod) {
        setError(stripeError?.message || 'Please check your card details.');
        return;
      }
      const result = await saveMembershipRenewalCard(token, {
        packageId: selected.packageId,
        billingInterval: interval,
        paymentMethodId: paymentMethod.id,
      });
      onSaved(result);
    } catch (err) {
      setError(extractErr(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="renewal-review__move" onSubmit={(e) => void onSubmit(e)}>
      <h2>We&apos;re moving to a new payment system</h2>
      <p>
        To keep {preview.petName}&apos;s benefits going without a break, please add your card below.
        Nothing is charged today: your first charge is on your renewal date,{' '}
        {formatDay(preview.termEnd)}, and we stop your old billing so you&apos;re never charged
        twice.
      </p>

      <RenewalPlanPicker
        options={options}
        selected={selected}
        interval={interval}
        onSelect={setPackageId}
        onInterval={setBillingInterval}
        money={money}
      />

      <label>
        Name on card
        <input
          value={nameOnCard}
          onChange={(e) => setNameOnCard(e.target.value)}
          autoComplete="cc-name"
          required
        />
      </label>
      <div className="renewal-review__card-input" ref={cardMountRef} />

      {selected && price != null && money(price) ? (
        <p className="renewal-review__muted">
          {selected.name}: {money(price)} per {interval === 'annual' ? 'year' : 'month'}, starting
          at renewal.
        </p>
      ) : null}
      {error ? <p className="renewal-review__error">{error}</p> : null}
      <button type="submit" className="renewal-review__primary" disabled={!canSubmit}>
        {submitting ? 'Saving…' : 'Save card and keep my membership'}
      </button>
    </form>
  );
}
