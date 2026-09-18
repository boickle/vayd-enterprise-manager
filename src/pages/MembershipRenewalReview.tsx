import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  fetchMembershipRenewalPreview,
  requestMembershipRenewalCancel,
  type MembershipRenewalPreview,
} from '../api/memberships';
import './MembershipRenewalReview.css';

function money(value: number | null): string {
  if (value == null || !Number.isFinite(Number(value))) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(Number(value));
}

function formatDay(iso: string): string {
  const date = new Date(`${iso}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function extractErr(error: unknown): string {
  const e = error as { response?: { data?: { message?: string | string[] } }; message?: string };
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(' ');
  if (typeof msg === 'string' && msg.trim()) return msg;
  return e?.message || 'Something went wrong.';
}

export default function MembershipRenewalReview() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [preview, setPreview] = useState<MembershipRenewalPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [wantCancel, setWantCancel] = useState(false);
  const [petName, setPetName] = useState('');
  const [phrase, setPhrase] = useState('');
  const [reason, setReason] = useState('');
  const [acknowledge, setAcknowledge] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [canceled, setCanceled] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadError('This review link is missing its token.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchMembershipRenewalPreview(token)
      .then((data) => {
        if (cancelled) return;
        setPreview(data);
        setCanceled(data.alreadyCanceling);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(extractErr(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const priceLine = useMemo(() => {
    if (!preview) return '';
    const amount = money(preview.nextPrice);
    if (!amount) return '';
    const cadence = preview.billingInterval === 'annual' ? 'year' : 'month';
    return `${amount} / ${cadence}`;
  }, [preview]);

  async function onCancel(event: FormEvent) {
    event.preventDefault();
    if (!preview) return;
    setSubmitting(true);
    setCancelError(null);
    try {
      await requestMembershipRenewalCancel(token, {
        petName,
        phrase,
        reason,
        acknowledge,
      });
      setCanceled(true);
      setWantCancel(false);
    } catch (err) {
      setCancelError(extractErr(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="renewal-review">
      <img
        className="renewal-review__logo"
        src="/final_thick_lines_cropped.jpeg"
        alt="Vet At Your Door"
      />

      {loading ? <p className="renewal-review__muted">Loading your membership…</p> : null}
      {loadError ? <p className="renewal-review__error">{loadError}</p> : null}

      {preview && !canceled ? (
        <>
          <h1>Review {preview.petName}&apos;s membership</h1>
          <p>
            Hi {preview.clientFirstName || 'there'}. This membership year ends on{' '}
            <strong>{formatDay(preview.termEnd)}</strong>. Unless you cancel, it renews
            automatically.
          </p>

          <section className="renewal-review__card">
            <dl>
              <div>
                <dt>Current plan</dt>
                <dd>{preview.currentPlanName}</dd>
              </div>
              <div>
                <dt>Renews as</dt>
                <dd>{preview.nextPlanName}</dd>
              </div>
              {priceLine ? (
                <div>
                  <dt>Price at renewal</dt>
                  <dd>{priceLine}</dd>
                </div>
              ) : null}
            </dl>
            {preview.reason === 'aged_out' ? (
              <p className="renewal-review__muted">
                {preview.petName} will be old enough for {preview.nextPlanName}, so we will move
                them to that plan at the new price.
              </p>
            ) : preview.reason === 'successor' ? (
              <p className="renewal-review__muted">
                At renewal {preview.petName} moves from {preview.currentPlanName} to{' '}
                {preview.nextPlanName}.
              </p>
            ) : (
              <p className="renewal-review__muted">
                {preview.petName} stays on {preview.nextPlanName}.
              </p>
            )}
          </section>

          <p className="renewal-review__stay">You do not need to do anything to stay a member.</p>

          {!wantCancel ? (
            <button
              type="button"
              className="renewal-review__cancel-link"
              onClick={() => setWantCancel(true)}
            >
              I want to cancel this membership
            </button>
          ) : (
            <form className="renewal-review__cancel" onSubmit={(e) => void onCancel(e)}>
              <h2>Cancel at the end of this year</h2>
              <p>
                Coverage continues through {formatDay(preview.termEnd)}. After that, {preview.petName}{' '}
                loses included exams, labs, and member pricing. This cannot be undone from this
                page.
              </p>
              <label>
                Type {preview.petName}&apos;s name
                <input value={petName} onChange={(e) => setPetName(e.target.value)} required />
              </label>
              <label>
                Type {preview.cancelPhrase} in all caps
                <input
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  autoComplete="off"
                  required
                />
              </label>
              <label>
                Why are you cancelling?
                <textarea
                  rows={4}
                  minLength={20}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                />
              </label>
              <label className="renewal-review__check">
                <input
                  type="checkbox"
                  checked={acknowledge}
                  onChange={(e) => setAcknowledge(e.target.checked)}
                />
                I understand membership benefits end on {formatDay(preview.termEnd)}.
              </label>
              {cancelError ? <p className="renewal-review__error">{cancelError}</p> : null}
              <div className="renewal-review__actions">
                <button type="button" onClick={() => setWantCancel(false)}>
                  Never mind — keep the membership
                </button>
                <button type="submit" className="is-danger" disabled={submitting || !acknowledge}>
                  {submitting ? 'Submitting…' : 'Cancel at year end'}
                </button>
              </div>
            </form>
          )}
        </>
      ) : null}

      {preview && canceled ? (
        <>
          <h1>Cancellation is scheduled</h1>
          <p>
            {preview.petName}&apos;s membership stays active through{' '}
            <strong>{formatDay(preview.termEnd)}</strong>. After that it will not renew.
          </p>
          <p className="renewal-review__muted">
            If this was a mistake, call Vet At Your Door and we can reverse it before that date.
          </p>
        </>
      ) : null}
    </main>
  );
}
