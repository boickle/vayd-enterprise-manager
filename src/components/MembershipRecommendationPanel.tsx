import type { CSSProperties } from 'react';
import type { RoomLoaderSimulateBillPublicResponse } from '../api/roomLoader';

export type RoomLoaderPlanForDisplay = { planId: string; planName: string; tagLine: string };
export type RoomLoaderPlansForPetForDisplay = {
  patientId: number;
  patientName: string;
  plans: RoomLoaderPlanForDisplay[];
  /** Resolved dog/cat for catalog Stripe names and optional simulate hint (mirrors client portal). */
  membershipSpeciesKind?: 'dog' | 'cat' | null;
  /** Golden tier eligibility (same threshold as MembershipSignup / `MEMBERSHIP_GOLDEN_MIN_AGE_YEARS`). */
  meetsGolden: boolean;
};

type Props = {
  pets: RoomLoaderPlansForPetForDisplay[];
  membershipPanelByPatientId: Record<
    number,
    { monthly: RoomLoaderSimulateBillPublicResponse | null; annual: RoomLoaderSimulateBillPublicResponse | null }
  >;
  membershipPanelLoading: boolean;
  summaryLineItems: Array<{
    name: string;
    quantity: number;
    price: number;
    patientId?: number;
    category?: string;
  }>;
  firstPatientId: number;
  allPatients: any[];
  membershipPlanDisplayName: Record<string, string>;
  formatPrice: (n: number) => string;
  /** Primary pet name for CTA (first pet in list). */
  enrollPrimaryPetName: string;
  hasMultiplePetsOnForm: boolean;
  onOpenMembershipEnrollment: () => void;
  normalizePlanBaseId: (id: string) => string;
  getRecommendedWellnessPlanFromList: (
    plans: RoomLoaderPlanForDisplay[],
    meetsGolden: boolean
  ) => RoomLoaderPlanForDisplay | null;
  filterLineItemsForPatientSimulate: <T extends { patientId?: number; category?: string }>(
    items: T[],
    patientId: number,
    firstPatientId: number
  ) => T[];
  normItemName: (n: string) => string;
  patientHasMembershipFlag: (p: any) => boolean;
};

const PANEL_STYLE: CSSProperties = {
  marginTop: '10px',
  width: '100%',
  boxSizing: 'border-box',
  backgroundColor: '#F3FAF6',
  border: '1px solid #c9e3d6',
  borderRadius: '12px',
  padding: '12px 14px 14px',
  overflow: 'auto',
};

/** Matches membership signup plan cards (`cp-recommended-badge` intent). */
const RECOMMENDED_PLAN_BADGE: CSSProperties = {
  display: 'inline-block',
  backgroundColor: '#4FB128',
  color: '#fff',
  fontSize: 11,
  fontWeight: 700,
  padding: '4px 10px',
  borderRadius: 6,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  lineHeight: 1.2,
};

export default function MembershipRecommendationPanel({
  pets,
  membershipPanelByPatientId,
  membershipPanelLoading,
  summaryLineItems,
  firstPatientId,
  allPatients,
  membershipPlanDisplayName,
  formatPrice,
  enrollPrimaryPetName,
  hasMultiplePetsOnForm,
  onOpenMembershipEnrollment,
  normalizePlanBaseId,
  getRecommendedWellnessPlanFromList,
  filterLineItemsForPatientSimulate,
  normItemName,
  patientHasMembershipFlag,
}: Props) {
  return (
    <div id="membership-bill-explainer-panel" role="region" aria-labelledby="membership-bill-explainer-trigger" style={PANEL_STYLE}>
      {membershipPanelLoading && Object.keys(membershipPanelByPatientId).length === 0 && (
        <p style={{ margin: 0, fontSize: '14px', color: '#3d5347' }}>Loading your membership estimate…</p>
      )}
      {pets.map((petPlans) => {
        const rec = getRecommendedWellnessPlanFromList(petPlans.plans, petPlans.meetsGolden);
        if (!rec) return null;
        const petName = petPlans.patientName || 'your pet';
        const monthly = membershipPanelByPatientId[petPlans.patientId]?.monthly;
        const planDisplayName = rec.planName || membershipPlanDisplayName[rec.planId] || rec.planId;
        const planBase = normalizePlanBaseId(rec.planId);
        const planShortLabel =
          planBase === 'golden' ? 'Golden' : planDisplayName.replace(/\s+Plan$/i, '').replace(/\s+Care$/i, '').trim();
        const filteredLines = filterLineItemsForPatientSimulate(summaryLineItems, petPlans.patientId, firstPatientId);
        const adjustments = monthly?.lineItemAdjustments ?? [];
        const usedAdj = new Set<number>();

        const coverageRows = filteredLines.map((line) => {
          const matchIdx = adjustments.findIndex(
            (a, i) =>
              !usedAdj.has(i) &&
              a.patientId === petPlans.patientId &&
              normItemName(a.name) === normItemName(line.name)
          );
          let right: string;
          let covered: boolean;
          if (matchIdx >= 0) {
            usedAdj.add(matchIdx);
            const a = adjustments[matchIdx];
            if (a.adjustedPrice === 0) {
              right = `✔ Covered by ${planShortLabel} Plan`;
              covered = true;
            } else if (a.adjustedPrice < a.originalPrice) {
              right = `✔ Member pricing (${formatPrice(a.adjustedPrice)})`;
              covered = true;
            } else {
              right = 'Not included in membership';
              covered = false;
            }
          } else {
            right = 'Not included in membership';
            covered = false;
          }
          return { left: line.name, right, covered };
        });

        const todayTotal = monthly?.originalTotal ?? null;
        const coveredEst =
          monthly != null ? Math.max(0, monthly.originalVisitSubtotal - monthly.withMembershipVisitSubtotal) : null;
        /** Visit services only at member pricing; monthly membership is shown separately below. */
        const dueAtVisit =
          monthly != null ? monthly.withMembershipVisitSubtotal : null;
        const monthlyFee = monthly?.monthlyCharge ?? monthly?.monthlyMembershipFee ?? monthly?.membershipFee;

        const otherPets = allPatients.filter((p: any) => {
          const pid = Number(p?.patientId ?? p?.patient?.id ?? p?.id);
          return !Number.isNaN(pid) && pid !== petPlans.patientId;
        });
        const otherNames = otherPets.map((p: any) => p.patientName ?? p.patient?.name ?? p.name).filter(Boolean) as string[];
        const otherMembers = otherPets.filter((p: any) => patientHasMembershipFlag(p));
        const otherMemberNames = otherMembers.map((p: any) => p.patientName ?? p.patient?.name ?? p.name).filter(Boolean) as string[];
        const formatNames = (names: string[]) =>
          names.length <= 1 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
        const currentPatient = allPatients.find(
          (p: any) => Number(p?.patientId ?? p?.patient?.id ?? p?.id) === petPlans.patientId
        );
        const thisPetIsMember = currentPatient ? patientHasMembershipFlag(currentPatient) : false;

        const subtext =
          planBase === 'golden' || planBase === 'foundations' ? (
            <>
              We recommend the <strong>{planDisplayName}</strong> Membership Plan for {petName}. It covers the core wellness care we recommend each year and supports ongoing care with{' '}
              {petName}&apos;s dedicated Vet At Your Door One-Team.
            </>
          ) : planBase === 'comfort-care' ? (
            <>
              We recommend the <strong>{planDisplayName}</strong> Membership Plan for {petName}. Membership makes it simple to get ongoing care with {petName}&apos;s dedicated Vet At Your Door One-Team.
            </>
          ) : (
            <>
              We recommend the <strong>{planDisplayName}</strong> Membership Plan for {petName}.
            </>
          );

        const showPlus = petPlans.plans.some((p) => normalizePlanBaseId(p.planId) === 'plus-addon');

        return (
          <div
            key={petPlans.patientId}
            style={{
              marginBottom: pets.length > 1 ? '16px' : 0,
              paddingBottom: pets.length > 1 ? '14px' : 0,
              borderBottom: pets.length > 1 ? '1px solid #c9e3d6' : 'none',
            }}
          >
            <h3 style={{ margin: '0 0 6px', fontSize: '18px', fontWeight: 700, color: '#14532d', letterSpacing: '-0.01em' }}>
              Recommended Care Option for {petName}
            </h3>
            <p style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 500, color: '#3d5347', lineHeight: 1.45 }}>
              Pets do best when the same veterinary team knows them over time.
            </p>
            <div style={{ marginBottom: '14px' }}>
              <h4 style={{ margin: '0 0 10px', fontSize: '15px', fontWeight: 700, color: '#14532d' }}>
                Why families choose One-Team membership
              </h4>
              <ul style={{ margin: 0, paddingLeft: '20px', color: '#1a2f24', fontSize: '14px', lineHeight: 1.5 }}>
                <li style={{ marginBottom: '6px' }}>✔ Priority access to a dedicated One-Team who knows {petName} over time</li>
                <li style={{ marginBottom: '6px' }}>✔ Preferred booking with your veterinary team</li>
                <li style={{ marginBottom: '6px' }}>✔ After-hours veterinary chat through the VAYD Client Portal</li>
                <li style={{ marginBottom: '6px' }}>✔ Care designed for long-term health, not just sick visits</li>
              </ul>
            </div>
            <p style={{ margin: '0 0 6px', fontSize: '15px', fontWeight: 600, color: '#1e4d2d', lineHeight: 1.45 }}>
              This is the care we recommend for {petName} each year.
              <br />
              Membership covers this care and supports ongoing care with {petName}&apos;s dedicated Vet At Your Door One-Team.
            </p>
            <p style={{ margin: '0 0 12px', fontSize: '14px', color: '#3d5347', lineHeight: 1.45 }}>{subtext}</p>

            <h4 style={{ margin: '0 0 8px', fontSize: '15px', fontWeight: 700, color: '#14532d' }}>Care Coverage Comparison</h4>
            <div style={{ marginBottom: '12px' }}>
              <div className="membership-rec-coverage-row membership-rec-coverage-header">
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#5a6b6c', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Today&apos;s Care Plan
                </div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#5a6b6c', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Covered by Membership
                </div>
              </div>
              {coverageRows.map((row, idx) => (
                <div key={idx} className="membership-rec-coverage-row">
                  <div style={{ fontSize: '14px', color: '#1a2f24', padding: '5px 0', borderBottom: '1px solid #e0efe8' }}>{row.left}</div>
                  <div
                    style={{
                      fontSize: '14px',
                      padding: '5px 0',
                      borderBottom: '1px solid #e0efe8',
                      color: row.covered ? '#0f5132' : '#6c757d',
                      fontWeight: row.covered ? 600 : 400,
                    }}
                  >
                    {row.right}
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                marginBottom: '12px',
                padding: '10px 12px',
                background: 'rgba(255,255,255,0.75)',
                border: '1px solid #b8d9c8',
                borderRadius: '8px',
              }}
            >
              <div style={{ fontSize: '14px', color: '#3d5347', marginBottom: '6px' }}>Today&apos;s estimated visit total</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#14532d', marginBottom: '12px' }}>
                {todayTotal != null ? formatPrice(todayTotal) : '—'}
              </div>
              <div
                style={{
                  fontSize: '14px',
                  color: '#3d5347',
                  marginBottom: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <span>Estimated covered by {planShortLabel} Plan</span>
                <span style={RECOMMENDED_PLAN_BADGE}>Recommended</span>
              </div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#0f5132', marginBottom: '12px' }}>
                {coveredEst != null ? formatPrice(coveredEst) : '—'}
              </div>
              <div style={{ fontSize: '14px', color: '#3d5347', marginBottom: '6px' }}>Estimated due at visit after membership signup</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#14532d' }}>{dueAtVisit != null ? formatPrice(dueAtVisit) : '—'}</div>
              {monthlyFee != null && monthlyFee > 0 && (
                <div style={{ marginTop: '10px', fontSize: '13px', color: '#5a6b6c', fontStyle: 'normal' }}>
                  {planBase === 'golden' ? 'Golden Membership' : planDisplayName} · {formatPrice(monthlyFee)}/month · 12-month membership
                </div>
              )}
            </div>

            {showPlus && (
              <div
                style={{
                  marginBottom: '16px',
                  padding: '14px 16px',
                  background: '#fff',
                  border: '1px solid #c9e3d6',
                  borderRadius: '8px',
                }}
              >
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#14532d', marginBottom: '8px' }}>Optional: PLUS Care Add-on</div>
                <p style={{ margin: '0 0 10px', fontSize: '13px', color: '#3d5347', lineHeight: 1.5 }}>
                  Designed for pets who may need additional visits or closer monitoring.
                </p>
                <div style={{ fontSize: '16px', fontWeight: 700, color: '#1a2f24', marginBottom: '8px' }}>$49/month</div>
                <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', color: '#3d5347', lineHeight: 1.45 }}>
                  <li>50% off additional exams</li>
                  <li>10% off labs, services, and medications</li>
                  <li>One complimentary nail trim per year</li>
                </ul>
              </div>
            )}

            {!thisPetIsMember && otherMembers.length >= 1 && (
              <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#3d5347', lineHeight: 1.5 }}>
                Since {formatNames(otherMemberNames)} {otherMemberNames.length === 1 ? 'is' : 'are'} already signed up for membership, you will receive a $75 multi-pet membership credit for use at a future Vet At Your Door visit. This never expires!
              </p>
            )}
            {!thisPetIsMember && otherMembers.length === 0 && otherNames.length >= 1 && (
              <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#3d5347', lineHeight: 1.5 }}>
                You can also sign up {formatNames(otherNames)} and get a $75 multi-pet membership credit for each additional pet, applied to a future Vet At Your Door visit. This never expires!
              </p>
            )}
          </div>
        );
      })}

      <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #c9e3d6' }}>
        <button
          type="button"
          onClick={onOpenMembershipEnrollment}
          style={{
            display: 'block',
            width: '100%',
            maxWidth: '420px',
            padding: '16px 22px',
            fontSize: '17px',
            fontWeight: 700,
            color: '#fff',
            backgroundColor: '#0f766e',
            border: 'none',
            borderRadius: '10px',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(15, 118, 110, 0.35)',
          }}
        >
          {hasMultiplePetsOnForm
            ? 'Enroll your pets in Membership'
            : `Enroll ${enrollPrimaryPetName} in Membership`}
        </button>
        <p style={{ margin: '12px 0 0', fontSize: '13px', color: '#5a6b6c', lineHeight: 1.5, maxWidth: '480px' }}>
          {hasMultiplePetsOnForm
            ? 'You will return here to finish submitting your visit information after enrollment.'
            : `You will return here to finish submitting ${enrollPrimaryPetName}'s visit information after enrollment.`}
        </p>
      </div>
    </div>
  );
}
