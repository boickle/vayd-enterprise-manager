import type { MembershipBillingInterval, MembershipRenewalPlanOption } from '../api/memberships';
import { savingsBullets, savingsForPlan, useMembershipSavings } from '../api/membershipSavings';

export function intervalAvailable(
  option: MembershipRenewalPlanOption,
  interval: MembershipBillingInterval
) {
  return interval === 'annual' ? option.annualAvailable : option.monthlyAvailable;
}

type PlanGroup = {
  key: string;
  title: string;
  options: MembershipRenewalPlanOption[];
  recommended: boolean;
};

/** "Membership - Canine Golden - Monthly" and "... - Annual" are one plan billed two ways. */
function baseName(name: string): string {
  return name
    .replace(/\s*[-–—]?\s*\(?(monthly|annual|yearly)\)?\s*$/i, '')
    .trim();
}

function displayTitle(base: string): string {
  return base.replace(/^membership\s*[-–—:]\s*/i, '').trim() || base;
}

function groupPlans(options: MembershipRenewalPlanOption[]): PlanGroup[] {
  const groups = new Map<string, PlanGroup>();
  for (const option of options) {
    const base = baseName(option.name);
    const key = base.toLowerCase();
    const group = groups.get(key) ?? {
      key,
      title: displayTitle(base),
      options: [],
      recommended: false,
    };
    group.options.push(option);
    group.recommended = group.recommended || option.recommended;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => Number(b.recommended) - Number(a.recommended));
}

function optionFor(
  group: PlanGroup,
  interval: MembershipBillingInterval
): MembershipRenewalPlanOption | null {
  return group.options.find((o) => intervalAvailable(o, interval)) ?? null;
}

function priceFor(group: PlanGroup, interval: MembershipBillingInterval): number | null {
  const option = optionFor(group, interval);
  if (!option) return null;
  return interval === 'annual' ? option.annualPrice : option.monthlyPrice;
}

type Props = {
  options: MembershipRenewalPlanOption[];
  selected: MembershipRenewalPlanOption | null;
  interval: MembershipBillingInterval;
  onSelect: (packageId: number) => void;
  onInterval: (interval: MembershipBillingInterval) => void;
  money: (value: number | null) => string;
};

/**
 * Same layout as portal membership signup: one card per plan, and the monthly /
 * yearly choice picks which of that plan's packages is billed.
 */
export default function RenewalPlanPicker({
  options,
  selected,
  interval,
  onSelect,
  onInterval,
  money,
}: Props) {
  const savings = useMembershipSavings();
  const groups = groupPlans(options);
  const selectedGroup = selected
    ? groups.find((g) => g.options.some((o) => o.packageId === selected.packageId)) ?? null
    : null;
  const canBill = (value: MembershipBillingInterval) =>
    selectedGroup ? optionFor(selectedGroup, value) != null : groups.some((g) => optionFor(g, value));

  const chooseInterval = (value: MembershipBillingInterval) => {
    const sibling = selectedGroup ? optionFor(selectedGroup, value) : null;
    if (sibling && sibling.packageId !== selected?.packageId) onSelect(sibling.packageId);
    onInterval(value);
  };

  const chooseGroup = (group: PlanGroup) => {
    const option = optionFor(group, interval) ?? group.options[0];
    if (!option) return;
    onSelect(option.packageId);
    if (!intervalAvailable(option, interval)) {
      onInterval(interval === 'annual' ? 'monthly' : 'annual');
    }
  };

  return (
    <div className="renewal-review__picker">
      <div className="renewal-review__billing">
        <p className="renewal-review__billing-kicker">Billing for next year</p>
        <div className="renewal-review__interval renewal-review__interval--prominent" role="radiogroup" aria-label="Billing">
          <button
            type="button"
            role="radio"
            aria-checked={interval === 'monthly'}
            className={interval === 'monthly' ? 'is-selected' : ''}
            disabled={!canBill('monthly')}
            onClick={() => chooseInterval('monthly')}
          >
            <span className="renewal-review__interval-title">Pay monthly</span>
            <span className="renewal-review__interval-sub">Billed each month</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={interval === 'annual'}
            className={`renewal-review__interval-yearly${interval === 'annual' ? ' is-selected' : ''}`}
            disabled={!canBill('annual')}
            onClick={() => chooseInterval('annual')}
          >
            <span className="renewal-review__save-pill">Save 10%</span>
            <span className="renewal-review__interval-title">Pay yearly</span>
            <span className="renewal-review__interval-sub">One payment per year — 10% off vs monthly</span>
          </button>
        </div>
      </div>

      <fieldset className="renewal-review__plans">
        <legend>Choose a plan</legend>
        <div className="renewal-review__plan-grid">
          {groups.map((group) => {
            const isSelected = group.key === selectedGroup?.key;
            const monthly = priceFor(group, 'monthly');
            const annual = priceFor(group, 'annual');
            const showAnnual = interval === 'annual' ? annual != null : monthly == null;
            const main = showAnnual ? annual : monthly;
            const card = optionFor(group, interval) ?? group.options[0]!;
            const perks = savingsForPlan(savings, card.name);
            const includes = [
              ...(card.cardBullets ?? []),
              ...savingsBullets(perks.exam, perks.store),
            ];
            return (
              <label
                key={group.key}
                className={`cp-card cp-plan-card renewal-plan-card${isSelected ? ' selected' : ''}`}
              >
                <input
                  type="radio"
                  name="renewal-plan"
                  value={group.key}
                  checked={isSelected}
                  onChange={() => chooseGroup(group)}
                />
                {group.recommended ? <span className="cp-recommended-badge">Recommended</span> : null}
                <div className="cp-card-upper">
                  <div className="cp-card-head">
                    <h3>{group.title}</h3>
                    {card.cardTagLine || card.summary ? (
                      <div className="cp-card-sub">{card.cardTagLine || card.summary}</div>
                    ) : null}
                  </div>
                  <div className="cp-card-price">
                    <div className="cp-card-price-main">
                      {main != null ? money(main) : '—'}
                      {main != null ? <span>{showAnnual ? '/year' : '/month'}</span> : null}
                    </div>
                    {!showAnnual && annual != null ? (
                      <div className="cp-card-price-note">or {money(annual)} annually (10% off)</div>
                    ) : null}
                    {showAnnual && monthly != null ? (
                      <div className="cp-card-price-note">or {money(monthly)} monthly</div>
                    ) : null}
                  </div>
                </div>
                {includes.length ? (
                  <div className="cp-card-includes">
                    <strong>Includes:</strong>
                    <ul>
                      {includes.map((item) => (
                        <li key={item}>
                          <span aria-hidden="true">⭐</span>
                          <span className="cp-muted">{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
