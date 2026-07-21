// src/pages/PublicReferAFriend.tsx
/** Standalone public "share / refer a friend" page at /share (legacy /refer-a-friend redirects here). */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { submitPublicReferral } from '../api/publicReferral';
import './ReferAFriend.css';

const VAYD_LOGO_SRC = '/vayd-logo-referral.webp';

const HERO_IMAGE_SRC = '/refer-a-friend-hero.jpg';
const WHY_SHARE_IMAGE_SRC = '/refer-a-friend-why-share.png';

const REASONS_TO_SHARE = [
  'Because pets are often calmer at home.',
  'Because relationships matter.',
  'Because veterinary care should feel personal.',
  'Because someone you care about deserves to experience something better.',
];

const TESTIMONIALS = [
  'I never realized how much less stressful veterinary visits could be until Vet at Your Door came to our home.',
  "The amount of time and attention they gave our dog was unlike anything we'd experienced before.",
  'Our pets are calmer and we finally feel like we have a veterinary team that truly knows them.',
];

function hideBrokenImage(e: React.SyntheticEvent<HTMLImageElement>) {
  (e.target as HTMLImageElement).style.display = 'none';
}

export default function PublicReferAFriend() {
  const [referrerName, setReferrerName] = useState('');
  const [referrerEmail, setReferrerEmail] = useState('');
  const [friendName, setFriendName] = useState('');
  const [friendEmail, setFriendEmail] = useState('');
  const [referralSubmitting, setReferralSubmitting] = useState(false);
  const [referralError, setReferralError] = useState<string | null>(null);
  const [referralSuccess, setReferralSuccess] = useState(false);

  const handleReferralSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const refEmail = referrerEmail.trim();
    const refName = referrerName.trim();
    const fEmail = friendEmail.trim();
    const fName = friendName.trim();
    if (!refName) {
      setReferralError('Please enter your name.');
      return;
    }
    if (!refEmail) {
      setReferralError('Please enter your email so we can credit your account.');
      return;
    }
    if (!fName) {
      setReferralError("Please enter your friend's name.");
      return;
    }
    if (!fEmail) {
      setReferralError("Please enter your friend's email.");
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

  return (
    <div className="raf-page">
      <section className="raf-hero">
        <div className="raf-hero-media" aria-hidden="true">
          <img src={HERO_IMAGE_SRC} alt="" onError={hideBrokenImage} />
        </div>
        <div className="raf-hero-scrim" aria-hidden="true" />
        <div className="raf-hero-inner">
          <div className="raf-hero-copy">
            <span className="raf-eyebrow">Refer a Friend</span>
            <h1 className="raf-heading">Share the Vet at Your Door Difference</h1>
            <p className="raf-lead">
              Do you know someone who would appreciate veterinary care that comes to them? Introduce them to Vet at
              Your Door and <strong>we&apos;ll waive their first trip visit fee</strong> so they can experience the
              difference firsthand.
            </p>
          </div>
        </div>
      </section>

      <div className="raf-card-wrap">
        <div className="raf-card">
          {referralSuccess ? (
            <div className="raf-success">
              <h2>Thank you!</h2>
              <p>Your referral has been sent successfully. We&apos;ll reach out to your friend directly.</p>
              <p>No pressure. Simply introduce someone you care about to a different kind of veterinary experience.</p>
              <Link to="/client-portal" className="raf-link">
                Open client portal
              </Link>
            </div>
          ) : (
            <form className="raf-form" onSubmit={handleReferralSubmit}>
              <label className="raf-field">
                <span className="raf-label">Your Name</span>
                <input
                  type="text"
                  className="raf-input"
                  value={referrerName}
                  onChange={(e) => setReferrerName(e.target.value)}
                  autoComplete="name"
                  placeholder="Your full name"
                  disabled={referralSubmitting}
                  required
                />
              </label>

              <label className="raf-field">
                <span className="raf-label">Your Email</span>
                <span className="raf-hint">(Use the email associated with your Vet at Your Door account)</span>
                <input
                  type="email"
                  className="raf-input"
                  value={referrerEmail}
                  onChange={(e) => setReferrerEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="you@example.com"
                  disabled={referralSubmitting}
                  required
                />
              </label>

              <label className="raf-field">
                <span className="raf-label">Friend&apos;s Name</span>
                <input
                  type="text"
                  className="raf-input"
                  value={friendName}
                  onChange={(e) => setFriendName(e.target.value)}
                  autoComplete="off"
                  placeholder="Friend's full name"
                  disabled={referralSubmitting}
                  required
                />
              </label>

              <label className="raf-field">
                <span className="raf-label">Friend&apos;s Email</span>
                <input
                  type="email"
                  className="raf-input"
                  value={friendEmail}
                  onChange={(e) => setFriendEmail(e.target.value)}
                  autoComplete="off"
                  placeholder="friend@example.com"
                  disabled={referralSubmitting}
                  required
                />
              </label>

              {referralError && <p className="raf-error">{referralError}</p>}

              <button type="submit" className="raf-submit-btn" disabled={referralSubmitting}>
                {referralSubmitting ? 'Sending…' : 'Submit Referral'}
              </button>

              <p className="raf-reassurance">
                No pressure. Simply introduce someone you care about to a different kind of veterinary experience.
              </p>
            </form>
          )}
        </div>
      </div>

      <section className="raf-why">
        <div className="raf-why-media" aria-hidden="true">
          <img src={WHY_SHARE_IMAGE_SRC} alt="" onError={hideBrokenImage} />
        </div>
        <div className="raf-why-copy">
          <h2>Why Clients Share Vet at Your Door</h2>
          <ul className="raf-why-list">
            {REASONS_TO_SHARE.map((reason) => (
              <li key={reason}>
                <span className="raf-why-check" aria-hidden="true">
                  ✓
                </span>
                {reason}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="raf-testimonials">
        <span className="raf-testimonials-label">What Pet Families Say</span>
        <div className="raf-testimonials-grid">
          {TESTIMONIALS.map((quote) => (
            <blockquote key={quote}>&ldquo;{quote}&rdquo;</blockquote>
          ))}
        </div>
      </section>

      <footer className="raf-footer">
        <img src={VAYD_LOGO_SRC} alt="Vet At Your Door" className="raf-footer-logo" onError={hideBrokenImage} />
      </footer>
    </div>
  );
}
