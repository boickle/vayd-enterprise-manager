import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { listMyUpcomingRenewals, type UpcomingMembershipRenewal } from '../../api/memberships';

const DISMISS_KEY = 'vayd_renewal_banner_dismissed';

function formatDay(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T12:00:00Z`));
}

function money(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function dismissedKeys(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(DISMISS_KEY) || '[]');
  } catch {
    return [];
  }
}

function message(r: UpcomingMembershipRenewal): { text: string; action: string } {
  const day = formatDay(r.termEnd);
  if (r.alreadyCanceling) {
    return { text: `${r.petName}'s membership ends on ${day}.`, action: 'Review' };
  }
  if (r.needsCard) {
    return {
      text: `${r.petName}'s membership renews on ${day}. Please add your card so benefits continue without a break.`,
      action: 'Add card',
    };
  }
  const c = r.comparison;
  if (c && r.nextPlanName === c.toPlanName) {
    const per = c.billingInterval === 'annual' ? 'year' : 'month';
    const diff =
      c.priceDifference && c.priceDifference !== 0
        ? ` (${c.priceDifference > 0 ? '+' : '−'}${money(Math.abs(c.priceDifference))}/${per})`
        : '';
    return {
      text: `${r.petName} moves from ${c.fromPlanName} to ${c.toPlanName} on ${day}${diff}.`,
      action: 'See what changes',
    };
  }
  return {
    text: `${r.petName}'s membership renews on ${day} as ${r.nextPlanName}.`,
    action: 'Review',
  };
}

export default function RenewalBanner() {
  const [rows, setRows] = useState<UpcomingMembershipRenewal[]>([]);
  const [dismissed, setDismissed] = useState<string[]>(dismissedKeys);

  useEffect(() => {
    let alive = true;
    listMyUpcomingRenewals()
      .then((data) => {
        if (alive) setRows(data);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const visible = rows.filter((r) => !dismissed.includes(`${r.wellnessPlanId}:${r.termEnd}`));
  if (!visible.length) return null;

  const dismiss = (key: string) => {
    const next = [...dismissed, key];
    setDismissed(next);
    try {
      sessionStorage.setItem(DISMISS_KEY, JSON.stringify(next));
    } catch {}
  };

  return (
    <div className="pp-renewal-banners">
      {visible.map((r) => {
        const key = `${r.wellnessPlanId}:${r.termEnd}`;
        const { text, action } = message(r);
        return (
          <div key={key} className="pp-renewal-banner" role="status">
            <span className="pp-renewal-banner__text">{text}</span>
            <Link
              className="pp-btn pp-btn--primary pp-btn--sm"
              to={`/membership/renewal?token=${encodeURIComponent(r.reviewToken)}`}
            >
              {action}
            </Link>
            <button
              type="button"
              className="pp-renewal-banner__close"
              aria-label="Dismiss"
              onClick={() => dismiss(key)}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
