import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  fetchMyMembershipSavings,
  type ClientPortalPetSavings,
  type MembershipPlanExtras,
  type MembershipSavingsLineItem,
  type PetMembershipSavingsEstimate,
} from '../api/membershipSavings';
import { trackEvent } from '../utils/analytics';

const BRAND = '#0f766e';
const GREEN = '#4FB128';
const MULTI_PET_CREDIT_USD = 75;

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const formatUsd = (n: number) => usd.format(n);

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

const cardStyle: CSSProperties = {
  background: '#fff',
  border: '1px solid #d8e8df',
  borderRadius: 14,
  padding: '20px 22px',
  boxShadow: '0 1px 4px rgba(15, 61, 36, 0.06)',
  scrollMarginTop: 56,
};

const primaryButton: CSSProperties = {
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

function PetSavingsCard({
  pet,
  highlighted,
  onJoin,
}: {
  pet: ClientPortalPetSavings;
  highlighted: boolean;
  onJoin: (pet: ClientPortalPetSavings) => void;
}) {
  const e = pet.estimate;
  const outline: CSSProperties = highlighted
    ? { borderColor: BRAND, boxShadow: '0 6px 18px rgba(15,118,110,0.18)' }
    : {};

  if (!e) {
    const planShort = planShortName(pet.recommendedPlanName);
    return (
      <div id={`pet-savings-${pet.portalPetId}`} style={{ ...cardStyle, ...outline }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 20, color: '#14532d' }}>{pet.petName}</h2>
        <p style={{ margin: 0, fontSize: 16, color: '#3d5347', lineHeight: 1.5 }}>
          We don&apos;t have a recent wellness visit with vaccines for {pet.petName} to compare yet.
          {pet.planExtras
            ? ` Here is what ${pet.recommendedPlanName} would include.`
            : ' Membership covers the annual wellness exam and trip fee, recommended vaccines, and annual lab work, plus priority scheduling with your dedicated One-Team.'}
        </p>
        {pet.planExtras && (
          <PlanExtras
            extras={pet.planExtras}
            petName={pet.petName}
            planShort={planShort}
            hasVisit={false}
          />
        )}
        <div style={{ marginTop: 18 }}>
          <button type="button" style={primaryButton} onClick={() => onJoin(pet)}>
            {pet.planExtras
              ? `Join ${planShort} for ${pet.petName}`
              : `Explore membership for ${pet.petName}`}
          </button>
        </div>
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

      {pet.planExtras && pet.planExtras.includedValue > 0 && (
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
            <span>Care included over the year</span>
            <span>Up to {formatUsd(e.coveredAmount + pet.planExtras.includedValue)}</span>
          </div>
          <div style={{ fontSize: 14, opacity: 0.9 }}>
            {formatUsd(e.coveredAmount)} on this visit plus up to{' '}
            {formatUsd(pet.planExtras.includedValue)} more
            {e.annualPrice != null
              ? `, for ${formatUsd(e.annualPrice)} a year paid annually`
              : e.monthlyPrice != null
                ? `, for ${formatUsd(e.monthlyPrice)} a month`
                : ''}
            .
          </div>
        </div>
      )}

      <div
        style={{ marginTop: 18, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}
      >
        <button type="button" style={primaryButton} onClick={() => onJoin(pet)}>
          Join {planShort} for {pet.petName}
        </button>
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

export default function MembershipSavings() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focusPetId = searchParams.get('petId')?.trim() || null;
  const [pets, setPets] = useState<ClientPortalPetSavings[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrolled = useRef(false);

  useEffect(() => {
    let alive = true;
    fetchMyMembershipSavings()
      .then((rows) => {
        if (!alive) return;
        setPets(rows);
        trackEvent('membership_savings_viewed', {
          pet_count: rows.length,
          pets_with_estimate: rows.filter((r) => r.estimate).length,
          focus_pet_id: focusPetId,
        });
      })
      .catch(() => {
        if (alive)
          setError("We couldn't load your membership savings. Please try again or contact us.");
      });
    return () => {
      alive = false;
    };
  }, [focusPetId]);

  const ordered = useMemo(() => {
    if (!pets) return [];
    const withEstimate = pets.filter((p) => p.estimate);
    const without = pets.filter((p) => !p.estimate);
    const all = [...withEstimate, ...without];
    if (!focusPetId) return all;
    const focus = all.filter(
      (p) => p.portalPetId === focusPetId || String(p.patientId) === focusPetId
    );
    return [...focus, ...all.filter((p) => !focus.includes(p))];
  }, [pets, focusPetId]);

  useEffect(() => {
    if (!focusPetId || scrolled.current || ordered.length === 0) return;
    scrolled.current = true;
    const match = ordered.find(
      (p) => p.portalPetId === focusPetId || String(p.patientId) === focusPetId
    );
    if (match)
      document
        .getElementById(`pet-savings-${match.portalPetId}`)
        ?.scrollIntoView({ block: 'start' });
  }, [ordered, focusPetId]);

  const handleJoin = (pet: ClientPortalPetSavings) => {
    trackEvent('membership_savings_join_clicked', {
      pet_id: pet.portalPetId,
      plan: pet.estimate?.planId ?? null,
      covered_amount: pet.estimate?.coveredAmount ?? null,
    });
    navigate(`/client-portal/membership-signup?petId=${encodeURIComponent(pet.portalPetId)}`, {
      state: { petId: pet.portalPetId },
    });
  };

  const totalCovered = (pets ?? []).reduce((sum, p) => sum + (p.estimate?.coveredAmount ?? 0), 0);

  return (
    <div
      className="cp-wrap"
      style={{ maxWidth: 880, margin: '32px auto', padding: '0 16px', fontSize: 16 }}
    >
      <button
        type="button"
        onClick={() => navigate('/client-portal')}
        style={{
          background: 'none',
          border: 'none',
          color: BRAND,
          fontSize: 15,
          fontWeight: 600,
          cursor: 'pointer',
          padding: 0,
        }}
      >
        ← Back to your portal
      </button>
      <h1 style={{ margin: '14px 0 6px', fontSize: 28, color: '#14532d' }}>
        Your One-Team Membership savings
      </h1>
      <p style={{ margin: '0 0 22px', color: '#3d5347', lineHeight: 1.5 }}>
        Here is what membership would cover, item by item, based on each pet&apos;s wellness care.
        Membership also includes priority scheduling with your dedicated One-Team, priority 7-day
        support through the Client Portal, 50% off exams on additional visits, and member pricing in
        our online store.
      </p>

      {error && <div style={{ color: '#b00020', marginBottom: 16 }}>{error}</div>}
      {!error && pets == null && <div className="cp-muted">Loading your savings…</div>}
      {pets != null && pets.length === 0 && (
        <div style={cardStyle}>
          <p style={{ margin: '0 0 16px' }}>
            All of your pets are already members, or we don&apos;t have any pets on file yet.
          </p>
          <button type="button" style={primaryButton} onClick={() => navigate('/client-portal')}>
            Back to your portal
          </button>
        </div>
      )}

      {pets != null && pets.length > 0 && (
        <>
          {totalCovered > 0 && ordered.filter((p) => p.estimate).length > 1 && (
            <div
              style={{
                ...cardStyle,
                background: '#F3FAF6',
                borderColor: '#c9e3d6',
                marginBottom: 16,
                fontSize: 17,
                fontWeight: 600,
                color: '#14532d',
              }}
            >
              Together, membership would cover {formatUsd(totalCovered)} of these visits.
            </div>
          )}
          {pets.length > 1 && (
            <p
              style={{
                margin: '0 0 16px',
                padding: '10px 12px',
                fontSize: 15,
                color: '#166534',
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: 8,
                lineHeight: 1.5,
              }}
            >
              Have more than one pet? Each additional pet you enroll gets a ${MULTI_PET_CREDIT_USD}{' '}
              multi-pet credit toward a future Vet At Your Door visit. It never expires.
            </p>
          )}
          <div style={{ display: 'grid', gap: 18 }}>
            {ordered.map((pet) => (
              <PetSavingsCard
                key={pet.patientId}
                pet={pet}
                highlighted={
                  focusPetId != null &&
                  (pet.portalPetId === focusPetId || String(pet.patientId) === focusPetId)
                }
                onJoin={handleJoin}
              />
            ))}
          </div>
          <p style={{ margin: '22px 0 0', fontSize: 14, color: '#5a6b6c', lineHeight: 1.5 }}>
            Estimates use current prices and may differ from your final bill. Questions? Contact us
            at info@vetatyourdoor.com or (207) 536-8387.
          </p>
        </>
      )}
    </div>
  );
}
