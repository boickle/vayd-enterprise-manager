import type { MembershipBillingInterval, MembershipRenewalPlanOption } from '../api/memberships';

export function intervalAvailable(
  option: MembershipRenewalPlanOption,
  interval: MembershipBillingInterval
) {
  return interval === 'annual' ? option.annualAvailable : option.monthlyAvailable;
}

type Props = {
  options: MembershipRenewalPlanOption[];
  selected: MembershipRenewalPlanOption | null;
  interval: MembershipBillingInterval;
  onSelect: (packageId: number) => void;
  onInterval: (interval: MembershipBillingInterval) => void;
  money: (value: number | null) => string;
};

/** Plan list plus monthly/yearly toggle for next membership year. */
export default function RenewalPlanPicker({
  options,
  selected,
  interval,
  onSelect,
  onInterval,
  money,
}: Props) {
  return (
    <>
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
                onChange={() => onSelect(option.packageId)}
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
                {intervalAvailable(option, interval) && money(optionPrice)
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
            disabled={!selected || !intervalAvailable(selected, value)}
            onClick={() => onInterval(value)}
          >
            {value === 'annual' ? 'Pay yearly' : 'Pay monthly'}
          </button>
        ))}
      </div>
    </>
  );
}
