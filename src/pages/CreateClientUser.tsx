// src/pages/CreateClientUser.tsx
import { FormEvent, useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { http } from '../api/http';

const REQUEST_APPOINTMENT_URL = import.meta.env.VITE_APPOINTMENT_REQUEST_URL || '/client-portal/request-appointment';

type Screen = 'form' | 'status';

export default function CreateClientUser() {
  const [email, setEmail] = useState('');
  const [screen, setScreen] = useState<Screen>('form');
  const [pending, setPending] = useState(false);

  // For user-facing errors only (e.g., unrecognized email)
  const [error, setError] = useState<string | null>(null);

  // Persist the email used so we can reference it on the status page.
  const [submittedEmail, setSubmittedEmail] = useState<string>('');

  // Page title: wireframe specifies "Become a One-Team Member"
  useEffect(() => {
    const prev = document.title;
    document.title = 'Become a One-Team Member';
    return () => {
      document.title = prev;
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    try {
      const payload = { email: email.trim().toLowerCase() };
      await http.post('/users/create-client', payload);

      // Keep the email for the status page, then "navigate" to it.
      setSubmittedEmail(payload.email);
      setScreen('status');
    } catch (err: any) {
      const status = err?.response?.status;
      const serverMsg = err?.response?.data?.message;

      // Friendly, client-facing copy only.
      if (status === 401) {
        setError("We couldn't find that email. Please use the email on file with our clinic.");
      } else if (serverMsg) {
        setError(serverMsg);
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setPending(false);
    }
  }

  // Update URL to look like a new page, without requiring router changes.
  useEffect(() => {
    if (screen === 'status') {
      try {
        window.history.pushState({}, '', '/client-portal/account-created');
      } catch {
        // no-op if not allowed
      }
    }
  }, [screen]);

  // Style definitions — wireframe: container 900–1100px, cards equal width, 24–32px padding
  const pageLayoutStyle: CSSProperties = {
    maxWidth: 1100,
    margin: '0 auto',
    padding: 'min(4vh, 40px) min(4vw, 32px) min(4vh, 40px)',
    background: 'radial-gradient(1000px 600px at 20% -10%, #ecfff8 0%, transparent 60%), #f6fbf9',
    minHeight: '100vh',
    width: '100%',
    boxSizing: 'border-box',
  };

  const headingStyle: CSSProperties = {
    margin: '16px 0 0 0',
    fontFamily: '"Libre Baskerville", Georgia, serif',
    fontSize: 'clamp(22px, 2.8vw, 36px)',
    lineHeight: 1.2,
    color: '#0f172a',
    textAlign: 'center',
  };

  const subheadStyle: CSSProperties = {
    marginTop: 16,
    fontSize: 'clamp(16px, 1.8vw, 20px)',
    lineHeight: 1.5,
    color: '#1f2937',
    textAlign: 'center',
    maxWidth: 640,
    marginLeft: 'auto',
    marginRight: 'auto',
  };

  const microTextStyle: CSSProperties = {
    marginTop: 8,
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    fontStyle: 'italic',
  };

  const cardStyle: CSSProperties = {
    padding: '28px 28px 32px',
    background: '#fff',
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  };

  const cardTitleStyle: CSSProperties = {
    fontSize: 18,
    fontWeight: 700,
    color: '#0f172a',
    margin: '0 0 4px 0',
  };

  const cardBodyStyle: CSSProperties = {
    fontSize: 16,
    lineHeight: 1.5,
    color: '#334155',
    margin: 0,
  };

  const inputStyle: CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #0f172a',
    borderRadius: 2,
    padding: '14px 18px',
    fontSize: 18,
    fontFamily: '"Open Sans", system-ui, sans-serif',
    backgroundColor: '#fff',
    minHeight: 48,
    // Prevent zoom on focus on iOS (font-size >= 16px)
  };

  const primaryButtonStyle: CSSProperties = {
    width: '100%',
    background: '#4FB128',
    color: '#fff',
    borderRadius: 999,
    padding: '14px 24px',
    fontSize: 18,
    fontWeight: 700,
    border: 'none',
    cursor: pending ? 'progress' : 'pointer',
    boxShadow: '0 10px 25px -15px rgba(79, 177, 40, 0.5)',
    textAlign: 'center',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textDecoration: 'none',
    minHeight: 48,
    boxSizing: 'border-box',
  };

  const secondaryButtonStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    borderRadius: 999,
    border: '2px solid #cbd5e1',
    background: '#ffffff',
    color: '#475569',
    fontWeight: 600,
    fontSize: 16,
    padding: '12px 24px',
    cursor: 'pointer',
    textDecoration: 'none',
  };

  const logoContainerStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    marginBottom: 8,
  };

  const logoStyle: CSSProperties = {
    width: 'min(280px, 50vw)',
    maxWidth: 320,
    height: 'auto',
    mixBlendMode: 'multiply',
    objectFit: 'contain',
  };

  // Status screen layout (reused)
  const layoutStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)',
    alignItems: 'flex-start',
    gap: 0,
    padding: 'min(4vh, 40px) min(8vw, 96px) min(4vh, 40px)',
    background: 'radial-gradient(1000px 600px at 20% -10%, #ecfff8 0%, transparent 60%), #f6fbf9',
  };

  const introStyle: CSSProperties = {
    marginTop: '32px',
    fontSize: 'clamp(18px, 2.1vw, 28px)',
    lineHeight: 1.4,
    maxWidth: 560,
    color: '#1f2937',
  };

  const panelStyle: CSSProperties = {
    marginLeft: 'auto',
    width: 'min(380px, 100%)',
    display: 'flex',
    flexDirection: 'column',
    gap: '28px',
    color: '#0f172a',
    marginTop: '24px',
  };

  const responsiveStyles = `
    .create-client-page {
      display: flex;
      flex-direction: column;
      align-items: stretch;
    }
    .create-client-page .member-cards {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      margin-top: 32px;
    }
    /* Mobile/tablet: stack cards (inline style would override, so all grid props in CSS) */
    .create-client-page .member-signin {
      margin-top: 32px;
      text-align: center;
    }
    .create-client-page .primary-btn-link:hover {
      background: #3d8f1f !important;
      color: #fff !important;
    }
    .create-client-page button[type="submit"]:hover:not(:disabled) {
      background: #3d8f1f !important;
      color: #fff !important;
    }
    /* Tablet: stack cards */
    @media (max-width: 900px) {
      .create-client-page {
        padding: 24px 20px 32px !important;
      }
      .create-client-page .member-cards {
        grid-template-columns: 1fr !important;
        gap: 20px;
        margin-top: 24px;
      }
      .create-client-page .member-signin {
        margin-top: 28px;
      }
      .create-client-page .member-card {
        padding: 22px 20px 26px !important;
      }
      .create-client-page .member-branding {
        padding: 14px 16px !important;
        margin-top: 20px !important;
      }
      .create-client-page .member-branding .member-branding-title {
        font-size: 15px !important;
      }
      .create-client-page .member-branding .member-branding-desc {
        font-size: 14px !important;
      }
    }
    /* Mobile */
    @media (max-width: 480px) {
      .create-client-page {
        padding: 16px 16px 28px !important;
      }
      .create-client-page .create-client-header {
        padding: 0 4px;
      }
      .create-client-page .create-client-header h1 {
        font-size: clamp(20px, 5.5vw, 28px) !important;
        line-height: 1.25 !important;
        margin-top: 12px !important;
      }
      .create-client-page .create-client-header .create-client-subhead {
        font-size: 15px !important;
        margin-top: 12px !important;
      }
      .create-client-page .create-client-header .create-client-micro {
        font-size: 12px !important;
        margin-top: 6px !important;
        line-height: 1.4 !important;
      }
      .create-client-page .create-client-logo img {
        width: min(200px, 55vw) !important;
        max-width: 240px !important;
      }
      .create-client-page .member-cards {
        gap: 16px;
        margin-top: 20px;
      }
      .create-client-page .member-card {
        padding: 20px 16px 24px !important;
        gap: 16px !important;
      }
      .create-client-page .member-card h2 {
        font-size: 17px !important;
      }
      .create-client-page .member-card p {
        font-size: 15px !important;
        line-height: 1.5 !important;
      }
      .create-client-page .member-branding {
        padding: 12px 14px !important;
        margin-top: 16px !important;
      }
      .create-client-page .member-branding .member-branding-title {
        font-size: 14px !important;
      }
      .create-client-page .member-branding .member-branding-desc {
        font-size: 13px !important;
      }
      .create-client-page .member-signin {
        margin-top: 24px;
      }
      .create-client-page .member-signin p {
        font-size: 15px !important;
      }
      .create-client-page button[type="submit"],
      .create-client-page .primary-btn-link {
        min-height: 48px !important;
        padding: 14px 20px !important;
        font-size: 17px !important;
      }
      .create-client-page .member-signin a {
        min-height: 48px !important;
        padding: 14px 24px !important;
        font-size: 16px !important;
      }
    }
    /* Status screen (check your email) mobile */
    .create-client-page.create-client-status {
      display: grid !important;
    }
    @media (max-width: 768px) {
      .create-client-page.create-client-status {
        grid-template-columns: 1fr !important;
        padding: 24px 20px 32px !important;
        gap: 24px !important;
        text-align: center !important;
      }
      .create-client-page.create-client-status .auth-logo {
        order: 1;
      }
      .create-client-page.create-client-status .auth-hero {
        order: 2;
        align-items: center;
      }
      .create-client-page.create-client-status .auth-hero h1,
      .create-client-page.create-client-status .auth-hero p {
        text-align: center !important;
      }
      .create-client-page.create-client-status .auth-panel {
        order: 3;
        margin-left: 0 !important;
        margin-right: 0 !important;
        width: 100% !important;
        max-width: 100% !important;
      }
      .create-client-page.create-client-status .auth-panel a,
      .create-client-page.create-client-status .auth-panel button {
        min-height: 48px !important;
      }
    }
    @media (max-width: 480px) {
      .create-client-page.create-client-status {
        padding: 16px 16px 28px !important;
        gap: 20px !important;
      }
      .create-client-page.create-client-status .auth-logo img {
        width: min(180px, 50vw) !important;
      }
      .create-client-page.create-client-status .auth-hero p {
        font-size: 16px !important;
      }
      .create-client-page.create-client-status .auth-panel h3 {
        font-size: 18px !important;
      }
      .create-client-page.create-client-status .auth-panel ol,
      .create-client-page.create-client-status .auth-panel ul {
        font-size: 15px !important;
        padding-left: 20px !important;
      }
    }
  `;

  if (screen === 'status') {
    return (
      <div className="create-client-page create-client-status" style={layoutStyle}>
        <style>{responsiveStyles}</style>
        <div className="auth-logo" style={logoContainerStyle}>
          <img
            style={logoStyle}
            src="/final_thick_lines_cropped.jpeg"
            alt="Vet At Your Door logo"
          />
        </div>
        <section className="auth-hero">
          <h1 style={headingStyle}>
            Check
            <br />
            Your Email
          </h1>
          <p style={introStyle}>
            If <strong>{submittedEmail}</strong> matches a client profile, we've sent instructions
            to finish setting up your portal access.
          </p>
        </section>

        <section className="auth-panel" style={panelStyle}>
          <div>
            <h3 style={{ margin: '0 0 16px', fontSize: 24, fontWeight: 600 }}>What happens next</h3>
            <ol style={{ paddingLeft: 24, margin: 0, fontSize: 18, lineHeight: 1.6 }}>
              <li style={{ marginBottom: 12 }}>
                Open the message from our clinic and follow the link to set your password.
              </li>
              <li>Return to the portal and sign in with your email and new password.</li>
            </ol>
          </div>

          <div>
            <h3 style={{ margin: '24px 0 16px', fontSize: 24, fontWeight: 600 }}>
              Didn't get an email?
            </h3>
            <ul style={{ paddingLeft: 24, margin: 0, fontSize: 18, lineHeight: 1.6 }}>
              <li style={{ marginBottom: 12 }}>Check your spam or junk folder.</li>
              <li>
                Make sure you entered the same email you use with our clinic. If you're not sure,
                contact us and we'll help.
              </li>
            </ul>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Link to="/login" style={primaryButtonStyle}>
              Go to Sign In
            </Link>
            <button
              style={secondaryButtonStyle}
              onClick={() => {
                setScreen('form');
                setError(null);
              }}
            >
              Use a different email
            </button>
          </div>
        </section>
      </div>
    );
  }

  // Default: form screen — wireframe: two equal-weight cards, then Sign In (secondary)
  return (
    <div className="create-client-page" style={pageLayoutStyle}>
      <style>{responsiveStyles}</style>

      <header className="create-client-header" style={{ textAlign: 'center' }}>
        <div className="create-client-logo" style={logoContainerStyle}>
          <img
            style={logoStyle}
            src="/final_thick_lines_cropped.jpeg"
            alt="Vet At Your Door logo"
          />
        </div>
        <h1 style={headingStyle}>Become a One-Team Member</h1>
        <p className="create-client-subhead" style={subheadStyle}>
          There are two ways to get started depending on whether you are already a Vet At Your Door client.
        </p>
        <p className="create-client-micro" style={microTextStyle}>
          Current client = past visit or scheduled appointment · New client = request first appointment
        </p>

        {/* Optional micro branding — One-Team Membership context */}
        <div
          className="member-branding"
          style={{
            marginTop: 24,
            padding: '16px 20px',
            background: 'rgba(79, 177, 40, 0.08)',
            borderRadius: 8,
            border: '1px solid rgba(79, 177, 40, 0.2)',
            maxWidth: 560,
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
        >
          <div className="member-branding-title" style={{ fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>One-Team Membership</div>
          <div className="member-branding-desc" style={{ fontSize: 15, lineHeight: 1.5, color: '#334155' }}>
            Relationship-based veterinary care from a dedicated veterinarian, technician, and client liaison who know your pet over time.
          </div>
        </div>
      </header>

      <div className="member-cards">
        {/* Current Clients card */}
        <section className="member-card" style={cardStyle} aria-labelledby="current-clients-title">
          <h2 id="current-clients-title" style={cardTitleStyle}>Current Clients</h2>
          <p style={cardBodyStyle}>
            Already a Vet At Your Door client? (Past visit or upcoming appointment.)
          </p>
          <p style={cardBodyStyle}>
            Enter the email we have on file and we&apos;ll send a secure link to create your Client Portal account and enroll in the One-Team Membership.
          </p>
          <form
            onSubmit={onSubmit}
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
            aria-label="Create account form"
          >
            <input
              style={inputStyle}
              className="input"
              placeholder="Email"
              aria-label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              inputMode="email"
            />
            {error && (
              <div className="danger" style={{ textAlign: 'center', fontSize: 14 }}>
                {error}
              </div>
            )}
            <button style={primaryButtonStyle} type="submit" disabled={pending}>
              {pending ? 'Submitting…' : 'Send My Portal Link'}
            </button>
          </form>
          <div>
            <a
              href="https://www.vetatyourdoor.com/memberships"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#4FB128', fontWeight: 600, textDecoration: 'underline' }}
            >
              Explore One-Team Membership
            </a>
          </div>
        </section>

        {/* New Clients card */}
        <section className="member-card" style={cardStyle} aria-labelledby="new-clients-title">
          <h2 id="new-clients-title" style={cardTitleStyle}>New to Vet At Your Door?</h2>
          <p style={cardBodyStyle}>
            To become a One-Team Member, first request your first appointment. Once scheduled, you&apos;ll be invited to create your Client Portal account and enroll.
          </p>
          {REQUEST_APPOINTMENT_URL.startsWith('http') ? (
            <a
              href={REQUEST_APPOINTMENT_URL}
              style={primaryButtonStyle}
              className="primary-btn-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              Request Your First Appointment
            </a>
          ) : (
            <Link
              to={REQUEST_APPOINTMENT_URL}
              style={primaryButtonStyle}
              className="primary-btn-link"
            >
              Request Your First Appointment
            </Link>
          )}
        </section>
      </div>

      {/* Portal Login — visually secondary */}
      <div className="member-signin" style={{ marginTop: 32, textAlign: 'center' }}>
        <p style={{ fontSize: 16, color: '#475569', marginBottom: 12 }}>
          Already have a Client Portal account?
        </p>
        <Link to="/login" style={secondaryButtonStyle}>
          Sign In
        </Link>
      </div>
    </div>
  );
}
