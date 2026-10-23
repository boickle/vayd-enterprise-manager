import { useEffect, useMemo, useState } from 'react';
import {
  chooseMembershipRenewalPlan,
  type MembershipBillingInterval,
  type MembershipRenewalPreview,
} from '../api/memberships';
import RenewalPlanPicker, { intervalAvailable } from './RenewalPlanPicker';

type Props = {
  token: string;
  preview: MembershipRenewalPreview;
  money: (value: number | null) => string;
  formatDay: (iso: string) => string;
  extractErr: (error: unknown) => string;
  onSaved: () => void;
  onClose: () => void;
};

/** Members already on Stripe: choose a different plan starting at renewal. */
export default function MembershipRenewalPlanChoice({
  token,
  preview,
  money,
  formatDay,
  extractErr,
  onSaved,
  onClose,
}: Props) {
  const options = preview.planOptions;
  const [packageId, setPackageId] = useState<number>(preview.nextPackageId);
  const [interval, setBillingInterval] = useState<MembershipBillingInterval>(
    preview.billingInterval ?? 'monthly'
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => options.find((o) => o.packageId === packageId) ?? options[0] ?? null,
    [options, packageId]
  );

  useEffect(() => {
    if (!selected || intervalAvailable(selected, interval)) return;
    const other: MembershipBillingInterval = interval === 'annual' ? 'monthly' : 'annual';
    if (intervalAvailable(selected, other)) setBillingInterval(other);
  }, [selected, interval]);

  const unchanged =
    selected?.packageId === preview.nextPackageId && interval === preview.billingInterval;

  async function onSave() {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      await chooseMembershipRenewalPlan(token, {
        packageId: selected.packageId,
        billingInterval: interval,
      });
      onSaved();
    } catch (err) {
      setError(extractErr(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="renewal-review__move">
      <h2>Choose a plan for next year</h2>
      <p className="renewal-review__muted">
        Your current plan stays the same until {formatDay(preview.termEnd)}. The plan you pick here
        starts on that date, at its price.
      </p>
      <RenewalPlanPicker
        options={options}
        selected={selected}
        interval={interval}
        onSelect={setPackageId}
        onInterval={setBillingInterval}
        money={money}
      />
      {error ? <p className="renewal-review__error">{error}</p> : null}
      <div className="renewal-review__actions">
        <button type="button" onClick={onClose}>
          Keep what I have
        </button>
        <button
          type="button"
          className="renewal-review__primary"
          disabled={submitting || unchanged || !selected || !intervalAvailable(selected, interval)}
          onClick={() => void onSave()}
        >
          {submitting ? 'Saving…' : 'Save my choice'}
        </button>
      </div>
    </section>
  );
}
