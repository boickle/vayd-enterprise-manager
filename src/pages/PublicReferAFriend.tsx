// src/pages/PublicReferAFriend.tsx
/** Standalone public “refer a friend” at a static URL (no survey token, no login). */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { submitPublicReferral } from '../api/publicReferral';
import './PostAppointmentSurvey.css';

export default function PublicReferAFriend() {
  const [referrerName, setReferrerName] = useState('');
  const [referrerEmail, setReferrerEmail] = useState('');
  const [friendEmail, setFriendEmail] = useState('');
  const [friendName, setFriendName] = useState('');
  const [referralSubmitting, setReferralSubmitting] = useState(false);
  const [referralError, setReferralError] = useState<string | null>(null);
  const [referralSuccess, setReferralSuccess] = useState(false);

  const handleReferralSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const refEmail = referrerEmail.trim();
    const refName = referrerName.trim();
    const fEmail = friendEmail.trim();
    const fName = friendName.trim();
    if (!refEmail) {
      setReferralError('Please enter your email so we can credit your account.');
      return;
    }
    if (!refName) {
      setReferralError('Please enter your name.');
      return;
    }
    if (!fEmail) {
      setReferralError("Please enter your friend's email.");
      return;
    }
    if (!fName) {
      setReferralError("Please enter your friend's name.");
      return;
    }
    setReferralError(null);
    setReferralSubmitting(true);
    try {
      await submitPublicReferral({
        referrerEmail: refEmail,
        referrerName: refName,
        email: fEmail,
        name: fName,
      });
      setReferralSuccess(true);
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string; error?: string } } })?.response?.data?.message ??
        (err as { response?: { data?: { message?: string; error?: string } } })?.response?.data?.error ??
        (err as { message?: string })?.message;
      setReferralError(typeof message === 'string' ? message : 'Something went wrong. Please try again.');
    } finally {
      setReferralSubmitting(false);
    }
  };

  if (referralSuccess) {
    return (
      <div className="survey-page">
        <div className="survey-card survey-success">
          <h1>Thank you!</h1>
          <p className="survey-referral-success" style={{ marginTop: 12 }}>
            Your referral has been sent successfully.
          </p>
          <p className="survey-success-blurb" style={{ marginTop: 18, lineHeight: 1.5 }}>
            Referring a friend is the highest compliment you can give our team. We are grateful for your trust.
          </p>
          <p className="survey-success-blurb" style={{ marginTop: 12, lineHeight: 1.5 }}>
            We will reach out to your friend directly. You will receive a $50 VAYD credit once their appointment is
            complete, plus an additional $25 credit if they become a member.
          </p>
          <p className="survey-success-blurb" style={{ marginTop: 18 }}>
            <Link to="/client-portal">Open the client portal</Link> for appointments and account details.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="survey-page">
      <div className="survey-card survey-success survey-success-promoter">
        <h1 className="survey-promoter-heading" style={{ textAlign: 'center' }}>
          Refer a friend
        </h1>
        <p className="survey-success-blurb survey-referral-copy" style={{ textAlign: 'center' }}>
          Share Vet At Your Door with a friend and invite them into the Vet At Your Door veterinary experience.
        </p>
        <p className="survey-success-blurb survey-referral-copy" style={{ textAlign: 'center' }}>
          You&apos;ll receive a <strong>$50 VAYD credit</strong> when your referral completes an appointment, and an{' '}
          <strong>additional $25</strong> if they become a member.
        </p>

        <div className="survey-referral-section" style={{ borderTop: 'none', paddingTop: 8 }}>
          <form className="survey-referral-form survey-referral-form-expanded" onSubmit={handleReferralSubmit}>
            <label className="survey-referral-label">
              Your name
              <input
                type="text"
                className="survey-input"
                value={referrerName}
                onChange={(e) => setReferrerName(e.target.value)}
                autoComplete="name"
                placeholder="Your full name"
                disabled={referralSubmitting}
                required
              />
            </label>
            <label className="survey-referral-label">
              Your email
              <span className="survey-referral-hint">Use the address on your account so we can credit you.</span>
              <input
                type="email"
                className="survey-input"
                value={referrerEmail}
                onChange={(e) => setReferrerEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
                disabled={referralSubmitting}
                required
              />
            </label>
            <label className="survey-referral-label">
              Friend&apos;s email
              <input
                type="email"
                className="survey-input"
                value={friendEmail}
                onChange={(e) => setFriendEmail(e.target.value)}
                autoComplete="off"
                placeholder="friend@example.com"
                disabled={referralSubmitting}
                required
              />
            </label>
            <label className="survey-referral-label">
              Friend&apos;s name
              <input
                type="text"
                className="survey-input"
                value={friendName}
                onChange={(e) => setFriendName(e.target.value)}
                autoComplete="name"
                placeholder="Friend's full name"
                disabled={referralSubmitting}
                required
              />
            </label>
            {referralError && <p className="survey-error survey-referral-error">{referralError}</p>}
            <div className="survey-referral-actions">
              <button type="submit" className="btn survey-btn-send-referral" disabled={referralSubmitting}>
                {referralSubmitting ? 'Sending…' : 'Send referral'}
              </button>
              <Link to="/client-portal" className="btn secondary survey-btn-referral-alt">
                Open client portal
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
