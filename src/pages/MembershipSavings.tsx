import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { fetchMyMembershipSavings, type ClientPortalPetSavings } from '../api/membershipSavings';
import {
  BRAND,
  MULTI_PET_CREDIT_USD,
  PetSavingsCard,
  cardStyle,
  formatUsd,
  primaryButton,
} from '../components/MembershipSavingsCard';
import { trackEvent } from '../utils/analytics';

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
