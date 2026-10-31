import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getMembershipCard,
  moveMembershipToStripe,
  updateMembershipCard,
  type MembershipBillingCard,
  type MembershipStripeMoveResult,
  type PatientMembership,
} from '../api/memberships';
import { apiErrorMessage } from '../api/http';
import PostVisitCardEntry from './soap/PostVisitCardEntry';
import './soap/PostVisitMembershipSignup.css';
import './MembershipCardUpdate.css';

function cardLabel(card: NonNullable<MembershipBillingCard['card']>): string {
  const brand = card.brand ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1) : 'Card';
  const exp =
    card.expMonth && card.expYear
      ? ` · expires ${String(card.expMonth).padStart(2, '0')}/${String(card.expYear).slice(-2)}`
      : '';
  return `${brand} ending ${card.last4}${exp}`;
}

function moveSummary(result: MembershipStripeMoveResult): string {
  const when = result.chargedNow
    ? 'Stripe charged the card today.'
    : result.firstChargeDate
      ? `Stripe charges it first on ${new Date(`${result.firstChargeDate}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}, after the period Square already collected.`
      : 'Stripe will bill it from now on.';
  const resumed = result.benefitsResumed ? ' Benefits are back on.' : '';
  const square = result.squareCanceled ? ' The Square subscription was cancelled.' : '';
  return `Billing moved to Stripe. ${when}${resumed}${square}`;
}

/**
 * Shows the card a membership is billed on and lets staff (or the owner, with
 * `mine`) switch that one membership to a new card. For staff, a membership
 * still on Square takes a card here and moves to Stripe.
 */
export default function MembershipCardUpdate({
  membershipId,
  mine = false,
  nameOnCard,
  buttonClassName,
  onSaved,
}: {
  membershipId: number;
  mine?: boolean;
  nameOnCard?: string | null;
  buttonClassName?: string;
  onSaved?: (membership: PatientMembership) => void;
}) {
  const [info, setInfo] = useState<MembershipBillingCard | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [squareWarning, setSquareWarning] = useState<string | null>(null);
  const createRef = useRef<(() => Promise<string>) | null>(null);

  const load = useCallback(async () => {
    try {
      setInfo(await getMembershipCard(membershipId, { mine }));
      setLoadError(null);
    } catch (e) {
      setLoadError(apiErrorMessage(e));
    }
  }, [membershipId, mine]);

  useEffect(() => {
    void load();
  }, [load]);

  const onReady = useCallback((create: () => Promise<string>) => {
    createRef.current = create;
  }, []);

  const moving = Boolean(info?.canMoveToStripe);

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const create = createRef.current;
      if (!create) throw new Error('The card form is still loading.');
      const paymentMethodId = await create();
      if (moving) {
        const result = await moveMembershipToStripe(membershipId, paymentMethodId);
        setSaved(moveSummary(result));
        setSquareWarning(result.squareActionNeeded);
        setEditing(false);
        await load();
        onSaved?.(result.membership);
      } else {
        const membership = await updateMembershipCard(membershipId, paymentMethodId, { mine });
        setSaved('Saved. Membership payments now go on this card.');
        setEditing(false);
        await load();
        onSaved?.(membership);
      }
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (loadError) return <p className="mcu-muted">{loadError}</p>;
  if (!info) return <p className="mcu-muted">Loading billing card…</p>;

  const canEdit = info.canUpdate || moving;

  return (
    <div className="mcu">
      <div className="mcu-row">
        <div>
          <div className="mcu-label">Billing card</div>
          <div className="mcu-value">
            {info.card ? cardLabel(info.card) : moving ? 'Billed through Square' : info.canUpdate ? 'No card on file' : '—'}
          </div>
        </div>
        {canEdit && !editing ? (
          <button
            type="button"
            className={buttonClassName}
            onClick={() => {
              setSaved(null);
              setSquareWarning(null);
              setError(null);
              setEditing(true);
            }}
          >
            {moving ? 'Enter a card' : 'Change card'}
          </button>
        ) : null}
      </div>
      {!info.canUpdate && info.reason && !saved ? <p className="mcu-muted">{info.reason}</p> : null}
      {saved ? (
        <p className="mcu-ok" role="status">
          {saved}
        </p>
      ) : null}
      {squareWarning ? (
        <p className="pvms-form-error" role="alert">
          {squareWarning}
        </p>
      ) : null}
      {editing ? (
        <div className="mcu-edit">
          <PostVisitCardEntry name={nameOnCard} onReady={onReady} />
          <p className="mcu-muted">
            {moving
              ? 'This moves only this membership off Square: Stripe bills this card from now on and Scout cancels the Square subscription. If the card is declined, nothing changes.'
              : 'Only this membership moves to the new card. Other memberships and saved cards stay as they are.'}
          </p>
          {error ? <p className="pvms-form-error">{error}</p> : null}
          <div className="mcu-actions">
            <button
              type="button"
              className={buttonClassName}
              disabled={saving}
              onClick={() => setEditing(false)}
            >
              {moving ? 'Cancel' : 'Keep current card'}
            </button>
            <button type="button" className={buttonClassName} disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : moving ? 'Move billing to Stripe' : 'Use this card for the membership'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
