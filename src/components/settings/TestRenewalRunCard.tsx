import { useEffect, useState } from 'react';
import {
  getTestRenewalAvailability,
  runTestRenewal,
  type TestRenewalAvailability,
  type TestRenewalResult,
} from '../../api/memberships';
import { appConfirm } from '../../utils/appDialog';

function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function errorMessage(err: unknown): string {
  const data = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join(', ');
  if (message) return message;
  return err instanceof Error ? err.message : 'The test run failed.';
}

/** Lower environments only. Production hides this card; the 9 AM job renews there. */
export default function TestRenewalRunCard() {
  const [availability, setAvailability] = useState<TestRenewalAvailability | null>(null);
  const [asOf, setAsOf] = useState(todayIso());
  const [planId, setPlanId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestRenewalResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getTestRenewalAvailability()
      .then((value) => {
        if (!cancelled) setAvailability(value);
      })
      .catch(() => {
        if (!cancelled) setAvailability({ available: false, reason: 'production' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!availability || availability.reason === 'production') return null;

  const run = async () => {
    const trimmed = planId.trim();
    const wellnessPlanId = trimmed ? Number(trimmed) : undefined;
    if (trimmed && (!Number.isInteger(wellnessPlanId) || (wellnessPlanId ?? 0) < 1)) {
      setError('Membership id must be a whole number.');
      return;
    }
    const ok = await appConfirm({
      title: 'Run renewals now?',
      message: wellnessPlanId
        ? `Run renewal for membership ${wellnessPlanId} as if today were ${asOf}. Notices go to MEMBERSHIP_TEST_EMAIL; Stripe changes use the test key.`
        : `Run renewal for every active membership as if today were ${asOf}. Notices go to MEMBERSHIP_TEST_EMAIL; Stripe changes use the test key.`,
      confirmLabel: 'Run renewals',
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await runTestRenewal({ asOf, wellnessPlanId }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-card" style={{ marginBottom: 16 }}>
      <h3 className="settings-card-title">Test renewals</h3>
      <p className="settings-muted" style={{ marginBottom: 12, fontSize: 13 }}>
        Runs the daily renewal job now, as if today were the date you pick: renewal notices first,
        then renewals for any term that has ended. Pick 14 days before a membership’s anniversary to
        see the notice, or the anniversary itself to see it renew. Only on this testing server and
        only with a Stripe test key.
      </p>
      {!availability.available ? (
        <p className="settings-muted">{availability.reason}</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="settings-field" style={{ maxWidth: 200 }}>
              <span className="settings-label">As of</span>
              <input
                className="settings-input"
                type="date"
                value={asOf}
                disabled={busy}
                onChange={(e) => setAsOf(e.target.value)}
              />
            </label>
            <label className="settings-field" style={{ maxWidth: 220 }}>
              <span className="settings-label">Membership id (optional)</span>
              <input
                className="settings-input"
                inputMode="numeric"
                placeholder="All active memberships"
                value={planId}
                disabled={busy}
                onChange={(e) => setPlanId(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn primary"
              disabled={busy || !asOf}
              onClick={() => void run()}
            >
              {busy ? 'Running…' : 'Run renewals now'}
            </button>
          </div>
          {error ? (
            <p className="settings-error-message" style={{ marginTop: 12 }}>
              {error}
            </p>
          ) : null}
          {result ? (
            <p style={{ marginTop: 12, fontSize: 14 }}>
              As of {asOf}: {result.notices.sent} notice{result.notices.sent === 1 ? '' : 's'} sent,{' '}
              {result.renewals.applied} renewed, {result.renewals.canceled} canceled at term end.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
