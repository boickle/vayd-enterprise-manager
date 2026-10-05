import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { loadStripe, type Stripe, type StripeCardElement } from '@stripe/stripe-js';
import {
  saveMembershipRenewalCard,
  type MembershipBillingInterval,
  type MembershipRenewalCardResult,
  type MembershipRenewalPlanOption,
  type MembershipRenewalPreview,
} from '../api/memberships';
import { loadStripePublishableKey } from '../api/practicePublicConfig';

type Props = {
  token: string;
  preview: MembershipRenewalPreview;
  money: (value: number | null) => string;
  formatDay: (iso: string) => string;
  extractErr: (error: unknown) => string;
  onSaved: (result: MembershipRenewalCardResult) => void;
};

function available(option: MembershipRenewalPlanOption, interval: MembershipBillingInterval) {
  return interval === 'annual' ? option.annualAvailable : option.monthlyAvailable;
}

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
    if (!selected || available(selected, interval)) return;
    const other: MembershipBillingInterval = interval === 'annual' ? 'monthly' : 'annual';
    if (available(selected, other)) setBillingInterval(other);
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
  const canSubmit = cardReady && !submitting && selected != null && available(selected, interval);

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

      <fieldset className="renewal-review__plans">
        <legend>Plan for next year</legend>
        {options.map((option) => {
          const optionPrice = interval === 'annual' ? option.annualPrice : option.monthlyPrice;
          const offered = option.monthlyAvailable || option.annualAvailable;
          return (
            <label
              key={option.packageId}
              className={`renewal-review__plan${
                option.packageId === selected?.packageId ? ' is-selected' : ''
              }`}
            >
              <input
                type="radio"
                name="renewal-plan"
                value={option.packageId}
                checked={option.packageId === selected?.packageId}
                disabled={!offered}
                onChange={() => setPackageId(option.packageId)}
              />
              <span>
                <strong>{option.name}</strong>
                {option.recommended ? (
                  <span className="renewal-review__badge">Recommended</span>
                ) : null}
                {option.summary ? (
                  <span className="renewal-review__muted renewal-review__plan-summary">
                    {option.summary}
                  </span>
                ) : null}
              </span>
              <span className="renewal-review__plan-price">
                {available(option, interval) && money(optionPrice)
                  ? `${money(optionPrice)} / ${interval === 'annual' ? 'year' : 'month'}`
                  : '—'}
              </span>
            </label>
          );
        })}
      </fieldset>

      <div className="renewal-review__interval" role="radiogroup" aria-label="Billing">
        {(['monthly', 'annual'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={interval === value}
            className={interval === value ? 'is-selected' : ''}
            disabled={!selected || !available(selected, value)}
            onClick={() => setBillingInterval(value)}
          >
            {value === 'annual' ? 'Pay yearly' : 'Pay monthly'}
          </button>
        ))}
      </div>

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
