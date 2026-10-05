import React, { useState } from 'react';
import { submitReferral } from '../../api/clientPortal';
import { Icon, PortalModal } from './PortalPrimitives';

export default function ReferralModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setEmail('');
    setName('');
    setError(null);
    setSuccess(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const em = email.trim();
    const nm = name.trim();
    if (!em) return setError('Please enter an email address.');
    if (!nm) return setError("Please enter your friend's name.");
    setError(null);
    setSubmitting(true);
    try {
      await submitReferral(em, nm);
      setSuccess(true);
    } catch (err: any) {
      const message =
        err?.response?.data?.message ?? err?.response?.data?.error ?? err?.message ?? 'Something went wrong. Please try again.';
      setError(typeof message === 'string' ? message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PortalModal title="Share the love 🎁" onClose={onClose} labelledBy="pp-referral-title">
      {success ? (
        <>
          <div className="pp-success">Your referral has been sent!</div>
          <p className="pp-small" style={{ margin: 0, lineHeight: 1.55 }}>
            Referring a friend is the highest compliment you can give our team. We&apos;ll reach out to your friend directly — and as a
            warm welcome, <strong>their first trip fee is on us</strong>.
          </p>
          <div className="pp-modal-foot">
            <button type="button" className="pp-btn pp-btn--ghost" onClick={reset}>
              Refer another friend
            </button>
            <button type="button" className="pp-btn pp-btn--primary" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="pp-muted pp-small" style={{ margin: 0, lineHeight: 1.55 }}>
            Know someone whose pet would love a house call? Tell us who, and we&apos;ll waive their first trip fee.
          </p>
          <form onSubmit={(e) => void submit(e)} style={{ display: 'grid', gap: 12 }}>
            <label className="pp-field">
              Friend&apos;s name
              <input className="pp-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jamie Smith" autoFocus />
            </label>
            <label className="pp-field">
              Friend&apos;s email
              <input
                className="pp-input"
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jamie@example.com"
              />
            </label>
            {error ? <div className="pp-error">{error}</div> : null}
            <div className="pp-modal-foot">
              <button type="button" className="pp-btn pp-btn--ghost" onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" className="pp-btn pp-btn--green" disabled={submitting}>
                <Icon name="gift" />
                {submitting ? 'Sending…' : 'Send referral'}
              </button>
            </div>
          </form>
        </>
      )}
    </PortalModal>
  );
}
