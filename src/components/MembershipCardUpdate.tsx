import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getMembershipCard,
  updateMembershipCard,
  type MembershipBillingCard,
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

/**
 * Shows the card a membership is billed on and lets staff (or the owner, with
 * `mine`) switch that one membership to a new card.
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
  const [saved, setSaved] = useState(false);
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

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const create = createRef.current;
      if (!create) throw new Error('The card form is still loading.');
      const paymentMethodId = await create();
      const membership = await updateMembershipCard(membershipId, paymentMethodId, { mine });
      setEditing(false);
      setSaved(true);
      await load();
      onSaved?.(membership);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (loadError) return <p className="mcu-muted">{loadError}</p>;
  if (!info) return <p className="mcu-muted">Loading billing card…</p>;

  return (
    <div className="mcu">
      <div className="mcu-row">
        <div>
          <div className="mcu-label">Billing card</div>
          <div className="mcu-value">
            {info.card ? cardLabel(info.card) : info.canUpdate ? 'No card on file' : '—'}
          </div>
        </div>
        {info.canUpdate && !editing ? (
          <button
            type="button"
            className={buttonClassName}
            onClick={() => {
              setSaved(false);
              setError(null);
              setEditing(true);
            }}
          >
            Change card
          </button>
        ) : null}
      </div>
      {!info.canUpdate && info.reason ? <p className="mcu-muted">{info.reason}</p> : null}
      {saved ? (
        <p className="mcu-ok" role="status">
          Saved. Membership payments now go on this card.
        </p>
      ) : null}
      {editing ? (
        <div className="mcu-edit">
          <PostVisitCardEntry name={nameOnCard} onReady={onReady} />
          <p className="mcu-muted">
            Only this membership moves to the new card. Other memberships and saved cards stay as
            they are.
          </p>
          {error ? <p className="pvms-form-error">{error}</p> : null}
          <div className="mcu-actions">
            <button
              type="button"
              className={buttonClassName}
              disabled={saving}
              onClick={() => setEditing(false)}
            >
              Keep current card
            </button>
            <button type="button" className={buttonClassName} disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Use this card for the membership'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
