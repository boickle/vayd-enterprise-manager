import type { CSSProperties } from 'react';
import type {
  ClientPortalPetSavings,
  MembershipPlanExtras,
  MembershipSavingsLineItem,
  PetMembershipSavingsEstimate,
} from '../api/membershipSavings';

export const BRAND = '#0f766e';
const GREEN = '#4FB128';
export const MULTI_PET_CREDIT_USD = 75;

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const formatUsd = (n: number) => usd.format(n);

function formatVisitDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function planShortName(planName: string): string {
  return planName.replace(/\s+Membership$/i, '').trim();
}

function basisSentence(e: PetMembershipSavingsEstimate): string {
  if (e.source === 'room_loader') {
    return `Based on the care selected for ${e.petName}'s upcoming visit.`;
  }
  const date = formatVisitDate(e.visitDate);
  return `Based on ${e.petName}'s last wellness visit${date ? ` on ${date}` : ''}, at today's prices.`;
}

function lineStatusLabel(li: MembershipSavingsLineItem, planShort: string): string {
  if (li.status === 'covered') return `Covered by ${planShort}`;
  if (li.status === 'member_price') return 'Member pricing';
  return 'Not included';
}

export const cardStyle: CSSProperties = {
  background: '#fff',
  border: '1px solid #d8e8df',
  borderRadius: 14,
  padding: '20px 22px',
  boxShadow: '0 1px 4px rgba(15, 61, 36, 0.06)',
  scrollMarginTop: 56,
};

export const primaryButton: CSSProperties = {
  display: 'inline-block',
  padding: '14px 22px',
  fontSize: 16,
  fontWeight: 700,
  color: '#fff',
  backgroundColor: GREEN,
  border: 'none',
  borderRadius: 10,
  cursor: 'pointer',
};

const cellHeader: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: '#5a6b6c',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  padding: '8px 6px',
  borderBottom: '1px solid #c9e3d6',
};

const cell: CSSProperties = {
  fontSize: 15,
  padding: '10px 6px',
  borderBottom: '1px solid #e0efe8',
  color: '#1a2f24',
  verticalAlign: 'top',
};

function PlanExtras({
  extras,
  petName,
  planShort,
  hasVisit,
}: {
  extras: MembershipPlanExtras;
  petName: string;
  planShort: string;
  hasVisit: boolean;
}) {
  const { includedItems, includedValue, memberDiscounts } = extras;
  if (includedItems.length === 0 && memberDiscounts.length === 0) return null;
  return (
    <div style={{ marginTop: 20 }}>
      {includedItems.length > 0 && (
        <>
          <h3 style={{ margin: '0 0 4px', fontSize: 17, color: '#14532d' }}>
            {hasVisit
              ? `More care ${planShort} includes for ${petName}`
              : `What ${planShort} includes for ${petName}`}
          </h3>
          <p style={{ margin: '0 0 8px', fontSize: 14, color: '#5a6b6c', lineHeight: 1.45 }}>
            {hasVisit
              ? 'Not part of this visit, but included during the membership year when your veterinarian recommends it.'
              : 'Included during the membership year when your veterinarian recommends it.'}
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {includedItems.map((item, idx) => (
                <tr key={`${item.name}-${idx}`}>
                  <td style={cell}>
                    {item.name}
                    {item.quantity > 1 ? ` × ${item.quantity}` : ''}
                  </td>
                  <td
                    style={{
                      ...cell,
                      textAlign: 'right',
                      color: '#6c757d',
                      textDecoration: 'line-through',
                    }}
                  >
                    {formatUsd(item.regularPrice)}
                  </td>
                  <td
                    style={{
                      ...cell,
                      textAlign: 'right',
                      fontWeight: 600,
                      color: '#0f5132',
                      width: 90,
                    }}
                  >
                    Included
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div
            style={{
              marginTop: 10,
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              fontSize: 16,
              fontWeight: 700,
              color: '#0f5132',
            }}
          >
            <span>{hasVisit ? 'Additional care included' : 'Care included'}</span>
            <span>Up to {formatUsd(includedValue)}</span>
          </div>
        </>
      )}

      {memberDiscounts.length > 0 && (
        <>
          <h3 style={{ margin: '20px 0 4px', fontSize: 17, color: '#14532d' }}>
            Member pricing on other visits
          </h3>
          <p style={{ margin: '0 0 8px', fontSize: 14, color: '#5a6b6c', lineHeight: 1.45 }}>
            If {petName} needs care between wellness visits, members pay less.
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {memberDiscounts.map((d) => (
                <tr key={d.name}>
                  <td style={cell}>
                    {d.name}
                    <div style={{ fontSize: 13, marginTop: 2, color: '#0f5132', fontWeight: 600 }}>
                      Save {formatUsd(d.regularPrice - d.memberPrice)} each
                    </div>
                  </td>
                  <td
                    style={{
                      ...cell,
                      textAlign: 'right',
                      color: '#6c757d',
                      textDecoration: 'line-through',
                    }}
                  >
                    {formatUsd(d.regularPrice)}
                  </td>
                  <td
                    style={{
                      ...cell,
                      textAlign: 'right',
                      fontWeight: 600,
                      color: '#0f5132',
                      width: 90,
                    }}
                  >
                    {formatUsd(d.memberPrice)}
                  </td>
                </tr>
              ))}
              <tr>
                <td style={cell} colSpan={3}>
                  Online store
                  <div style={{ fontSize: 13, marginTop: 2, color: '#0f5132', fontWeight: 600 }}>
                    10% member pricing on food, preventives, and supplies
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function MultiPetCreditRow({ credit, petName }: { credit: number; petName: string }) {
  if (!(credit > 0)) return null;
  return (
    <div
      style={{
        marginTop: 16,
        padding: '12px 14px',
        background: '#f0fdf4',
        border: '1px solid #bbf7d0',
        borderRadius: 8,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 12,
        fontSize: 16,
      }}
    >
      <span>
        <strong style={{ color: '#14532d' }}>Multi-pet credit</strong>
        <span style={{ display: 'block', fontSize: 14, color: '#3d5347' }}>
          Enrolling {petName} as an additional pet adds a credit toward a future visit. It never
          expires.
        </span>
      </span>
      <strong style={{ color: '#0f5132', whiteSpace: 'nowrap' }}>{formatUsd(credit)}</strong>
    </div>
  );
}

/**
 * Yearly value next to the plan price. Hidden when included care and credit add up to less than
 * the plan costs, so the card does not lead with a comparison that looks like a loss.
 */
function YearlyValueBox({
  estimate: e,
  extras,
  credit,
}: {
  estimate: PetMembershipSavingsEstimate;
  extras: MembershipPlanExtras | null;
  credit: number;
}) {
  const extraValue = extras?.includedValue ?? 0;
  if (extraValue <= 0 && credit <= 0) return null;
  const total = e.coveredAmount + extraValue + credit;
  const planCost = e.annualPrice ?? (e.monthlyPrice != null ? e.monthlyPrice * 12 : null);
  if (planCost != null && total < planCost) return null;

  const parts = [`${formatUsd(e.coveredAmount)} on this visit`];
  if (extraValue > 0) parts.push(`up to ${formatUsd(extraValue)} more in included care`);
  if (credit > 0) parts.push(`a ${formatUsd(credit)} multi-pet credit`);
  const joined =
    parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];

  return (
    <div
      style={{
        marginTop: 16,
        padding: '14px 16px',
        background: '#14532d',
        color: '#fff',
        borderRadius: 10,
        fontSize: 16,
        lineHeight: 1.5,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          fontWeight: 700,
          fontSize: 18,
        }}
      >
        <span>Value over the year</span>
        <span>Up to {formatUsd(total)}</span>
      </div>
      <div style={{ fontSize: 14, opacity: 0.9 }}>
        {joined}
        {e.annualPrice != null
          ? `, for ${formatUsd(e.annualPrice)} a year paid annually`
          : e.monthlyPrice != null
            ? `, for ${formatUsd(e.monthlyPrice)} a month`
            : ''}
        .
      </div>
    </div>
  );
}

/** Without `onJoin` (staff view) the join button is omitted; the price line still shows. */
export function PetSavingsCard({
  pet,
  highlighted,
  onJoin,
}: {
  pet: ClientPortalPetSavings;
  highlighted: boolean;
  onJoin?: (pet: ClientPortalPetSavings) => void;
}) {
  const e = pet.estimate;
  const outline: CSSProperties = highlighted
    ? { borderColor: BRAND, boxShadow: '0 6px 18px rgba(15,118,110,0.18)' }
    : {};

  if (!e) {
    const planShort = planShortName(pet.recommendedPlanName);
    const joinLabel = pet.planExtras
      ? `Join ${planShort} for ${pet.petName}`
      : `Explore membership for ${pet.petName}`;
    // Point at the list only when PlanExtras will actually show one; otherwise point at the button.
    const listShown = Boolean(
      pet.planExtras &&
        (pet.planExtras.includedItems.length > 0 || pet.planExtras.memberDiscounts.length > 0)
    );
    let next = '';
    if (listShown) next = ` Here’s what ${pet.recommendedPlanName} includes:`;
    else if (pet.planExtras && onJoin)
      next = ` Tap “${joinLabel}” below to see everything ${pet.recommendedPlanName} includes and its price.`;
    else if (!pet.planExtras)
      next =
        ' Membership covers the annual wellness exam and trip fee, recommended vaccines, and annual lab work, plus priority scheduling with your dedicated One-Team.';
    return (
      <div id={`pet-savings-${pet.portalPetId}`} style={{ ...cardStyle, ...outline }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 20, color: '#14532d' }}>{pet.petName}</h2>
        <p style={{ margin: 0, fontSize: 16, color: '#3d5347', lineHeight: 1.5 }}>
          We can&apos;t show {pet.petName}&apos;s savings yet because we don&apos;t have a recent
          wellness visit with vaccines to compare.
          {next}
        </p>
        {pet.planExtras && (
          <PlanExtras
            extras={pet.planExtras}
            petName={pet.petName}
            planShort={planShort}
            hasVisit={false}
          />
        )}
        <MultiPetCreditRow credit={pet.multiPetCredit} petName={pet.petName} />
        {onJoin && (
          <div style={{ marginTop: 18 }}>
            <button type="button" style={primaryButton} onClick={() => onJoin(pet)}>
              {joinLabel}
            </button>
          </div>
        )}
      </div>
    );
  }

  const planShort = planShortName(e.planName);
  const lines = e.lineItems ?? [];

  return (
    <div id={`pet-savings-${pet.portalPetId}`} style={{ ...cardStyle, ...outline }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 20, color: '#14532d' }}>{pet.petName}</h2>
        <span
          style={{
            backgroundColor: GREEN,
            color: '#fff',
            fontSize: 12,
            fontWeight: 700,
            padding: '4px 10px',
            borderRadius: 6,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Recommended: {e.planName}
        </span>
      </div>
      <p style={{ margin: '6px 0 16px', fontSize: 15, color: '#5a6b6c' }}>{basisSentence(e)}</p>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
          <thead>
            <tr>
              <th style={{ ...cellHeader, textAlign: 'left' }}>Service</th>
              <th style={{ ...cellHeader, textAlign: 'right' }}>Regular price</th>
              <th style={{ ...cellHeader, textAlign: 'right' }}>With {planShort}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((li, idx) => {
              const saved = li.status !== 'not_included';
              return (
                <tr key={`${li.name}-${idx}`}>
                  <td style={cell}>
                    {li.name}
                    {li.quantity > 1 ? ` × ${li.quantity}` : ''}
                    <div
                      style={{
                        fontSize: 13,
                        marginTop: 2,
                        fontWeight: saved ? 600 : 400,
                        color: saved ? '#0f5132' : '#6c757d',
                      }}
                    >
                      {saved ? '✔ ' : ''}
                      {lineStatusLabel(li, planShort)}
                    </div>
                  </td>
                  <td
                    style={{
                      ...cell,
                      textAlign: 'right',
                      color: saved ? '#6c757d' : '#1a2f24',
                      textDecoration: saved ? 'line-through' : 'none',
                    }}
                  >
                    {formatUsd(li.originalPrice)}
                  </td>
                  <td
                    style={{
                      ...cell,
                      textAlign: 'right',
                      fontWeight: 600,
                      color: saved ? '#0f5132' : '#1a2f24',
                    }}
                  >
                    {li.memberPrice === 0 ? 'Included' : formatUsd(li.memberPrice)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div
        style={{
          marginTop: 16,
          padding: '14px 16px',
          background: '#F3FAF6',
          border: '1px solid #c9e3d6',
          borderRadius: 10,
          display: 'grid',
          gap: 8,
          fontSize: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span>Visit total</span>
          <span style={{ fontWeight: 600 }}>{formatUsd(e.visitTotal)}</span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            color: '#0f5132',
            fontWeight: 700,
          }}
        >
          <span>Covered by {e.planName}</span>
          <span>−{formatUsd(e.coveredAmount)}</span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            paddingTop: 8,
            borderTop: '1px solid #c9e3d6',
            fontSize: 18,
            fontWeight: 700,
            color: '#14532d',
          }}
        >
          <span>You would pay at the visit</span>
          <span>{formatUsd(e.memberVisitAmount)}</span>
        </div>
      </div>

      {pet.planExtras && (
        <PlanExtras extras={pet.planExtras} petName={pet.petName} planShort={planShort} hasVisit />
      )}

      <MultiPetCreditRow credit={pet.multiPetCredit} petName={pet.petName} />

      <YearlyValueBox estimate={e} extras={pet.planExtras} credit={pet.multiPetCredit} />

      <div
        style={{ marginTop: 18, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}
      >
        {onJoin && (
          <button type="button" style={primaryButton} onClick={() => onJoin(pet)}>
            Join {planShort} for {pet.petName}
          </button>
        )}
        {e.monthlyPrice != null && (
          <div style={{ fontSize: 15, color: '#3d5347', lineHeight: 1.45 }}>
            <strong style={{ fontSize: 18, color: '#0f3d24' }}>{formatUsd(e.monthlyPrice)}</strong>{' '}
            / month, 12-month membership
            <div style={{ color: '#166534', fontWeight: 600 }}>
              Save {e.annualSavingsPercent}% with annual payment
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
