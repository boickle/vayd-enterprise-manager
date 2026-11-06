import { useEffect, useState } from 'react';
import { previewMyVisitRefund, type OwnerVisitRefundOutline } from '../../api/memberships';

const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

function visitDay(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

type Props = {
  patientId: number | null;
  petName: string;
  /** Plan slug the owner picked, or the recommended one before they pick. */
  planId: string | null;
  planName?: string;
  /** False while showing the recommended plan, before the owner picks one. */
  planChosen: boolean;
  pricingOption: 'monthly' | 'annual';
  addOns: string[];
  species?: string | null;
};

/**
 * Post-visit signup in the portal (owner request, Oct 30, 2026): before joining, show what the
 * plan re-prices on the recent visit and what comes back. Same numbers as the refund task staff
 * get once the owner joins. Shows nothing when there's no visit in the window.
 */
export default function PostVisitRefundOutline({
  patientId,
  petName,
  planId,
  planName,
  planChosen,
  pricingOption,
  addOns,
  species,
}: Props) {
  const [outline, setOutline] = useState<OwnerVisitRefundOutline | null>(null);
  const [loading, setLoading] = useState(false);
  const addOnKey = addOns.join(',');

  useEffect(() => {
    if (patientId == null || !planId) {
      setOutline(null);
      return;
    }
    let live = true;
    setLoading(true);
    previewMyVisitRefund({
      patientId,
      planId,
      planName,
      pricingOption,
      addOns: addOnKey ? addOnKey.split(',') : [],
      ...(species ? { species } : {}),
    })
      .then((data) => live && setOutline(data))
      .catch(() => live && setOutline(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [patientId, planId, planName, pricingOption, addOnKey, species]);

  if (!outline) return null;
  const day = visitDay(outline.visits[0]?.visitAt ?? null);
  const refund = outline.refundDue > 0.009;

  return (
    <section className="cp-section" aria-live="polite">
      <h2 className="cp-h2">Your recent visit</h2>
      <div className="cp-card" style={{ padding: 20, opacity: loading ? 0.6 : 1 }}>
        <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 17 }}>
          {refund
            ? `Join ${planChosen ? `on ${outline.planName}` : 'now'} and get ${money(outline.refundDue)} back`
            : `${petName}'s recent visit`}
        </p>
        <p className="cp-muted" style={{ margin: '0 0 14px' }}>
          {day ? `${petName}'s visit on ${day}` : `${petName}'s recent visit`} is re-priced at member
          rates
          {planChosen ? '' : ` (showing ${outline.planName}, our recommendation — pick a plan below to see yours)`}.
        </p>

        {outline.lines.length ? (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {outline.lines.map((line, i) => (
              <li
                key={`${line.description}-${i}`}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '8px 0',
                  borderTop: i ? '1px solid #e5ece9' : undefined,
                }}
              >
                <span>
                  <span style={{ fontWeight: 600 }}>
                    {line.description}
                    {line.qty !== 1 ? ` × ${line.qty}` : ''}
                  </span>
                  <span className="cp-muted" style={{ display: 'block', fontSize: 13 }}>
                    {line.note}
                  </span>
                </span>
                <span style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  <s style={{ color: '#94a3b8', marginRight: 8 }}>{money(line.was)}</s>
                  <strong style={{ color: '#0f766e' }}>{line.covered ? 'Included' : money(line.now)}</strong>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="cp-muted" style={{ margin: 0 }}>
            Nothing on this visit is covered by {outline.planName}, so there's no refund on this plan.
          </p>
        )}
        {outline.unchangedCount > 0 && outline.lines.length ? (
          <p className="cp-muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
            {outline.unchangedCount} other item{outline.unchangedCount === 1 ? ' stays' : 's stay'} at the
            same price.
          </p>
        ) : null}

        {refund ? (
          <div
            style={{
              marginTop: 14,
              paddingTop: 12,
              borderTop: '1px solid #d7e5df',
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              rowGap: 4,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <span>You paid</span>
            <span style={{ textAlign: 'right' }}>{money(outline.paidTotal)}</span>
            <span>At member prices</span>
            <span style={{ textAlign: 'right' }}>{money(outline.newTotal)}</span>
            <strong>Refund to your card</strong>
            <strong style={{ textAlign: 'right', color: '#0f766e' }}>{money(outline.refundDue)}</strong>
          </div>
        ) : null}
        {refund ? (
          <p className="cp-muted" style={{ margin: '12px 0 0', fontSize: 13 }}>
            Your membership payment is separate. Once you join, our team refunds this to the card
            you paid with.
          </p>
        ) : null}
      </div>
    </section>
  );
}
