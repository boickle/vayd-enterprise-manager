import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { buildStoreMemberPromo } from '../../utils/storeMemberPromo';
import { useMembershipSavings } from '../../api/membershipSavings';
import { petDbId, useStoreMemberPricing } from './useStoreMemberPricing';

/** Dismissal is per sign-up pitch, so members still see their applied-discount note. */
const DISMISS_KEY = 'vayd_store_member_promo_dismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export default function StoreMemberPromo() {
  const { loggedIn, loading, pets, discounts } = useStoreMemberPricing();
  const savings = useMembershipSavings();
  const [dismissed, setDismissed] = useState(readDismissed);

  const promo = useMemo(
    () =>
      buildStoreMemberPromo({
        loggedIn,
        pets: pets
          .map((pet) => ({ id: petDbId(pet) ?? NaN, name: pet.name || '' }))
          .filter((pet) => Number.isFinite(pet.id)),
        discounts,
        advertised: savings?.storePercentOff ?? null,
      }),
    [discounts, loggedIn, pets, savings]
  );

  // A household that joins later should get the reassurance line even after dismissing.
  useEffect(() => {
    if (promo?.kind === 'member' && dismissed) setDismissed(false);
  }, [dismissed, promo?.kind]);

  // Waiting on the household avoids flashing "become a member" at an existing member.
  if (loggedIn && loading) return null;
  if (!promo) return null;
  if (dismissed && promo.kind !== 'member') return null;

  return (
    <aside
      className={`vayd-store__member-promo vayd-store__member-promo--${promo.kind}`}
      aria-label="Membership savings"
    >
      <span className="vayd-store__member-promo-badge" aria-hidden>
        {promo.percent}%
      </span>
      <div className="vayd-store__member-promo-text">
        <strong>{promo.headline}</strong>
        <span>
          {promo.body}
          {promo.showPortalLink ? (
            <>
              {' '}
              <Link className="vayd-store__member-promo-link" to="/client-portal">
                See your client portal
              </Link>
            </>
          ) : null}
        </span>
      </div>
      {promo.kind === 'member' ? null : (
        <button
          type="button"
          className="vayd-store__member-promo-close"
          aria-label="Dismiss membership savings message"
          onClick={() => {
            setDismissed(true);
            try {
              localStorage.setItem(DISMISS_KEY, '1');
            } catch {
              /* dismissal is a nicety; ignore storage failures */
            }
          }}
        >
          ×
        </button>
      )}
    </aside>
  );
}
