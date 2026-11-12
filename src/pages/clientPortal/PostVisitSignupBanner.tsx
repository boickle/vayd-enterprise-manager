import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { listMyPostVisitWindows, type PostVisitOpenWindow } from '../../api/memberships';

function formatHoursLeft(hours: number): string {
  if (hours < 1.5) return 'less than an hour';
  const whole = Math.max(1, Math.round(hours));
  return `${whole} hour${whole === 1 ? '' : 's'}`;
}

function petList(windows: PostVisitOpenWindow[]): string {
  const names = windows.map((w) => w.patientName);
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

function timeLeft(windows: PostVisitOpenWindow[]): string {
  // Use the smallest window to set urgency
  const min = windows.reduce((a, b) => (a.hoursLeft < b.hoursLeft ? a : b));
  return formatHoursLeft(min.hoursLeft);
}

export default function PostVisitSignupBanner() {
  const [windows, setWindows] = useState<PostVisitOpenWindow[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    listMyPostVisitWindows()
      .then((data) => { if (alive) setWindows(data); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  if (!windows.length || dismissed) return null;

  const multi = windows.length > 1;
  const names = petList(windows);
  const left = timeLeft(windows);

  const goSignUp = (patientId?: number) => {
    const path = '/client-portal/membership-signup';
    if (patientId != null) {
      navigate(`${path}?petId=${encodeURIComponent(patientId)}`);
    } else {
      navigate(path);
    }
  };

  return (
    <div className="pp-pv-banner" role="status" aria-live="polite">
      <div className="pp-pv-banner__body">
        <span className="pp-pv-banner__icon" aria-hidden>⏳</span>
        <div className="pp-pv-banner__text">
          <strong>Your recent visit can be covered.</strong>{' '}
          {multi
            ? `${names} can each have their recent visit re-priced at member rates — but the window closes in ${left}.`
            : `${names} has ${left} left to become a member and have this visit re-priced at member rates.`}
        </div>
        <div className="pp-pv-banner__actions">
          {multi ? (
            windows.map((w) => (
              <button
                key={w.patientId}
                type="button"
                className="pp-btn pp-btn--primary pp-btn--sm"
                onClick={() => goSignUp(w.patientId)}
              >
                Review &amp; join for {w.patientName}
              </button>
            ))
          ) : (
            <button
              type="button"
              className="pp-btn pp-btn--primary pp-btn--sm"
              onClick={() => goSignUp(windows[0]!.patientId)}
            >
              Review &amp; join
            </button>
          )}
        </div>
      </div>
      <button
        type="button"
        className="pp-pv-banner__close"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
      >
        ×
      </button>
    </div>
  );
}
