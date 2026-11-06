import type { MembershipRenewalComparison } from '../api/memberships';

type Props = {
  comparison: MembershipRenewalComparison;
  petName: string;
  termEnd: string;
  /** Plan the membership will actually renew onto (may be the owner's own choice). */
  nextPlanName: string;
  money: (value: number | null) => string;
  formatDay: (iso: string) => string;
  /** Shown as a button when the owner can stay; omitted when a picker is already on the page. */
  onStay?: () => void;
};

export default function RenewalComparison({
  comparison: c,
  petName,
  termEnd,
  nextPlanName,
  money,
  formatDay,
  onStay,
}: Props) {
  const per = c.billingInterval === 'annual' ? 'year' : 'month';
  const diff = c.priceDifference;
  const stayed = nextPlanName === c.fromPlanName;

  return (
    <section className="renewal-review__card renewal-review__comparison">
      <h2>
        {petName} moves to {c.toPlanName} on {formatDay(termEnd)}
      </h2>
      {c.why ? (
        <p>
          <strong>Why {c.toPlanName}:</strong> {c.why}
        </p>
      ) : null}
      {c.added.length ? (
        <>
          <p>
            <strong>What {c.toPlanName} adds:</strong>
          </p>
          <ul>
            {c.added.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      ) : null}
      {c.toPrice != null ? (
        <p>
          {c.toPlanName} is {money(c.toPrice)} per {per}
          {diff != null && diff !== 0 && c.fromPrice != null
            ? `, ${money(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than ${c.fromPlanName} (${money(c.fromPrice)})`
            : ''}
          .
        </p>
      ) : null}
      {stayed ? (
        <p className="renewal-review__stay">
          You chose to stay on {c.fromPlanName}. {petName} will not move to {c.toPlanName}.
        </p>
      ) : (
        <p className="renewal-review__muted">
          If we don&apos;t hear from you, we&apos;ll move {petName} to {c.toPlanName}{' '}
          automatically.
          {c.canStay && !onStay ? ` If you'd rather stay on ${c.fromPlanName}, choose it below.` : ''}
        </p>
      )}
      {c.canStay && onStay && !stayed ? (
        <button type="button" className="renewal-review__change-plan" onClick={onStay}>
          I&apos;d rather stay on {c.fromPlanName}
        </button>
      ) : null}
    </section>
  );
}
