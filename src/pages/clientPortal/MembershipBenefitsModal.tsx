import { useEffect, useMemo, useState } from 'react';
import {
  listMyPatientMemberships,
  type MembershipBenefit,
  type MembershipGroup,
  type PatientMembership,
} from '../../api/memberships';
import MembershipCardUpdate from '../../components/MembershipCardUpdate';
import { Icon, PortalModal } from './PortalPrimitives';
import { fmtMembershipShortDate, possessive, type MembershipView, type PetWithWellness } from './portalShared';

/** Perks every plan carries that aren't tracked as countable benefits. */
export function membershipPerkLines(m: PatientMembership | null | undefined): string[] {
  const examOff = m?.outOfPlanDiscount != null && Number(m.outOfPlanDiscount) > 0 ? Number(m.outOfPlanDiscount) : 50;
  const storeOff = m?.onlineStoreDiscount != null && Number(m.onlineStoreDiscount) > 0 ? Number(m.onlineStoreDiscount) : 10;
  return [
    `${examOff}% off exam fees on visits outside your plan`,
    `${storeOff}% member pricing in our online store`,
    'After-hours chat with our team',
    'Priority scheduling with your One-Team',
    '7-day support from VAYD staff',
  ];
}

function isUnlimited(n: number) {
  return n < 0;
}

function BenefitRow({ b, groupMode }: { b: MembershipBenefit; groupMode: MembershipGroup['selectionMode'] }) {
  const included = b.includedQuantity;
  const used = Math.max(0, b.usedQuantity || 0);
  const remaining = b.remainingQuantity;
  const unlimited = isUnlimited(included) || isUnlimited(remaining);
  const allUsed = !unlimited && remaining <= 0 && included > 0;
  const pct = unlimited || included <= 0 ? 0 : Math.min(100, Math.round((used / included) * 100));
  const discountOnly = b.coverage === 'percent_off' || (b.percentOff != null && b.percentOff > 0 && included === 0);

  return (
    <li className={`pp-benefit${allUsed ? ' pp-benefit--used' : ''}`}>
      <span className={`pp-benefit-check${allUsed ? ' is-used' : remaining !== 0 ? ' is-open' : ''}`} aria-hidden>
        {allUsed ? <Icon name="check" size={13} /> : null}
      </span>
      <div className="pp-benefit-main">
        <div className="pp-benefit-name">{b.name}</div>
        <div className="pp-benefit-sub">
          {discountOnly
            ? `${b.percentOff}% off`
            : unlimited
            ? 'Included · unlimited'
            : included === 0
            ? 'Included'
            : allUsed
            ? `Used ${used} of ${included}`
            : `${remaining} of ${included} left`}
          {groupMode === 'choice' && !discountOnly ? ' · pick from this group' : ''}
        </div>
        {!unlimited && included > 0 && !discountOnly ? (
          <div className="pp-benefit-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${pct}%` }} />
          </div>
        ) : null}
      </div>
    </li>
  );
}

export default function MembershipBenefitsModal({
  pet,
  membership,
  onClose,
}: {
  pet: PetWithWellness;
  membership: MembershipView;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<PatientMembership[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const petDbId = pet.dbId && Number.isFinite(Number(pet.dbId)) ? Number(pet.dbId) : null;

  useEffect(() => {
    let alive = true;
    if (!petDbId) {
      setRows([]);
      return;
    }
    listMyPatientMemberships({ patientId: petDbId })
      .then((r) => {
        if (alive) setRows(r);
      })
      .catch(() => {
        if (alive) {
          setRows([]);
          setError("We couldn't load the benefit details right now — the perks below still apply.");
        }
      });
    return () => {
      alive = false;
    };
  }, [petDbId]);

  const current = useMemo(() => {
    if (!rows?.length) return null;
    return rows.find((r) => r.status === 'active') ?? rows[0];
  }, [rows]);

  const groups = useMemo(() => {
    if (!current) return [];
    return [...current.groups]
      .map((g) => ({ ...g, benefits: g.benefits.filter((b) => !b.isRemoved) }))
      .filter((g) => g.benefits.length > 0)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [current]);

  const totals = useMemo(() => {
    let included = 0;
    let used = 0;
    for (const g of groups) {
      if (g.selectionMode === 'choice') {
        if (!isUnlimited(g.allowedQuantity)) {
          included += g.allowedQuantity;
          used += Math.min(g.allowedQuantity, Math.max(0, g.usedQuantity));
        }
        continue;
      }
      for (const b of g.benefits) {
        if (isUnlimited(b.includedQuantity) || b.includedQuantity <= 0) continue;
        included += b.includedQuantity;
        used += Math.min(b.includedQuantity, Math.max(0, b.usedQuantity));
      }
    }
    return { included, used, left: Math.max(0, included - used) };
  }, [groups]);

  const planName = (current?.planName || membership.planText || 'Membership').replace(/^\s*membership\s*[-–—:]\s*/i, '').trim();
  // Staff-facing group names ("Added for this patient") read oddly to an owner.
  const groupLabel = (name: string) => (/added for this patient|custom/i.test(name) ? 'Included in your plan' : name);
  const perks = membershipPerkLines(current);

  return (
    <PortalModal
      title={
        <>
          {possessive(pet.name)} membership
          <span className="pp-modal-title-sub">{planName}</span>
        </>
      }
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="pp-btn pp-btn--ghost" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      {error ? <div className="pp-error">{error}</div> : null}

      {rows === null ? (
        <div className="pp-skeleton" style={{ height: 180 }} />
      ) : (
        <>
          {current ? (
            <div className="pp-benefit-summary">
              <div>
                <div className="pp-benefit-summary-k">
                  {totals.included > 0 ? `${totals.left} of ${totals.included} included services left` : 'All included services'}
                </div>
                <div className="pp-muted pp-small">
                  {current.startDate ? `Started ${fmtMembershipShortDate(current.startDate)}` : 'Active'}
                  {current.expirationDate ? ` · renews ${fmtMembershipShortDate(current.expirationDate)}` : ''}
                  {current.billingInterval ? ` · billed ${current.billingInterval}` : ''}
                </div>
              </div>
              {totals.included > 0 ? (
                <div className="pp-benefit-ring" style={{ ['--pct' as string]: `${Math.round((totals.used / totals.included) * 100)}%` }}>
                  <span>{Math.round((totals.used / totals.included) * 100)}%</span>
                  <small>used</small>
                </div>
              ) : null}
            </div>
          ) : null}

          {groups.length > 0 ? (
            <div className="pp-benefit-groups">
              {groups.map((g) => (
                <section key={g.id} className="pp-benefit-group">
                  <header className="pp-benefit-group-head">
                    <h3>{groupLabel(g.name)}</h3>
                    {g.selectionMode === 'choice' && !isUnlimited(g.allowedQuantity) ? (
                      <span className="pp-tag pp-tag--ok">
                        {Math.max(0, g.remainingQuantity)} of {g.allowedQuantity} left
                      </span>
                    ) : null}
                  </header>
                  <ul className="pp-benefits">
                    {g.benefits.map((b) => (
                      <BenefitRow key={b.id} b={b} groupMode={g.selectionMode} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <p className="pp-muted" style={{ margin: 0 }}>
              {current
                ? 'This plan doesn’t track individual services — your perks are listed below.'
                : `We don’t have an itemized breakdown for ${possessive(pet.name)} plan yet. Here’s what membership includes — call or chat and we’ll walk you through what’s been used.`}
            </p>
          )}

          <section className="pp-benefit-group">
            <header className="pp-benefit-group-head">
              <h3>Always-on perks</h3>
            </header>
            <ul className="pp-perks">
              {perks.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </section>

          {current && current.status !== 'inactive' ? (
            <section className="pp-benefit-group">
              <MembershipCardUpdate membershipId={current.id} mine buttonClassName="pp-btn pp-btn--ghost" />
            </section>
          ) : null}
        </>
      )}
    </PortalModal>
  );
}
