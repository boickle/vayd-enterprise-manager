// src/pages/CreateClientUser.tsx
import { FormEvent, useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { http } from '../api/http';

type Screen = 'form' | 'status';

export default function CreateClientUser() {
  const [email, setEmail] = useState('');
  const [screen, setScreen] = useState<Screen>('form');
  const [pending, setPending] = useState(false);

  // For user-facing errors only (e.g., unrecognized email)
  const [error, setError] = useState<string | null>(null);

  // Persist the email used so we can reference it on the status page.
  const [submittedEmail, setSubmittedEmail] = useState<string>('');

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

  // Style definitions
  const layoutStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)',
    alignItems: 'center',
    gap: 'min(8vw, 88px)',
    padding: 'min(12vh, 120px) min(8vw, 96px)',
    minHeight: '100vh',
    background: 'radial-gradient(1000px 600px at 20% -10%, #ecfff8 0%, transparent 60%), #f6fbf9',
  };

  const headingStyle: CSSProperties = {
    margin: 0,
    fontFamily: '"Libre Baskerville", Georgia, serif',
    fontSize: 'clamp(32px, 4.5vw, 64px)',
    lineHeight: 1.08,
    color: '#0f172a',
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
  };

  const labelStyle: CSSProperties = {
    fontSize: 20,
    fontWeight: 600,
    marginBottom: 10,
  };

  const inputStyle: CSSProperties = {
    width: '100%',
    border: '1px solid #0f172a',
    borderRadius: 2,
    padding: '18px 20px',
    fontSize: 20,
    fontStyle: 'italic',
    fontFamily: '"Open Sans", system-ui, sans-serif',
    backgroundColor: '#fff',
  };

  const submitButtonStyle: CSSProperties = {
    width: '100%',
    background: '#10b981',
    color: '#fff',
    borderRadius: 999,
    padding: '14px 24px',
    fontSize: 24,
    fontWeight: 700,
    border: 'none',
    cursor: pending ? 'progress' : 'pointer',
    boxShadow: '0 10px 25px -15px rgba(16, 185, 129, 0.5)',
  };

  const secondaryButtonStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    borderRadius: 999,
    border: '2px solid #10b981',
    background: '#ffffff',
    color: '#10b981',
    fontWeight: 700,
    fontSize: 24,
    padding: '12px 32px',
    cursor: 'pointer',
    textDecoration: 'none',
  };

  const logoContainerStyle: CSSProperties = {
    gridColumn: '1 / -1',
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '-60px',
  };

  const logoStyle: CSSProperties = {
    width: 'min(320px, 60vw)',
    maxWidth: 360,
    height: 'auto',
    mixBlendMode: 'multiply',
  };

  const responsiveStyles = `
    .create-client-page .auth-hero {
      display: flex;
      flex-direction: column;
      gap: 32px;
    }
    .create-client-page .auth-panel form {
      width: 100%;
    }
    @media (max-width: 1024px) {
      .create-client-page {
        grid-template-columns: 1fr !important;
        padding: 96px 56px !important;
        gap: 64px !important;
        text-align: center;
      }
      .create-client-page .auth-hero {
        align-items: center;
        max-width: 100%;
        width: 100%;
      }
      .create-client-page .auth-panel {
        margin-left: 0 !important;
        margin-right: 0 !important;
        margin: 0 auto !important;
        width: min(480px, 100%) !important;
        max-width: 480px;
      }
      .create-client-page .auth-logo {
        margin-bottom: -72px !important;
      }
    }
    @media (max-width: 768px) {
      .create-client-page {
        padding: 72px 24px !important;
        gap: 52px !important;
      }
      .create-client-page .auth-hero {
        align-items: center;
        width: 100%;
      }
      .create-client-page .auth-panel {
        width: min(420px, 100%) !important;
        max-width: 420px;
      }
      .create-client-page .auth-logo {
        margin-bottom: -64px !important;
      }
    }
    @media (max-width: 480px) {
      .create-client-page {
        padding: 56px 16px 72px !important;
        gap: 44px !important;
      }
      .create-client-page .auth-panel {
        width: 100% !important;
        max-width: 100%;
      }
      .create-client-page .auth-logo {
        margin-bottom: -40px !important;
      }
    }
  `;

  if (screen === 'status') {
    return (
      <div className="create-client-page" style={layoutStyle}>
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
            <Link to="/login" style={submitButtonStyle}>
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

  // Default: form screen
  return (
    <div className="create-client-page" style={layoutStyle}>
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
          Create Your
          <br />
          Client Portal
          <br />
          Account
        </h1>
        <p style={introStyle}>
          Get started by entering the email address we have on file for your account. We'll send you
          a secure link to complete your setup and access your pet's information and membership
          plans.
        </p>
      </section>

      <section className="auth-panel" style={panelStyle}>
        <div>
          <div style={labelStyle}>Enter your email to get started</div>
          <form
            onSubmit={onSubmit}
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
            aria-label="Create account form"
          >
            <div style={{ width: '100%' }}>
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
            </div>
            {error && (
              <div className="danger" style={{ textAlign: 'center' }}>
                {error}
              </div>
            )}
            <button style={submitButtonStyle} type="submit" disabled={pending}>
              {pending ? 'Submitting…' : 'Send Setup Link'}
            </button>
          </form>
        </div>

        <div style={{ fontSize: 20, lineHeight: 1.4 }}>
          <div>Already have an account? Sign in to access your portal:</div>
        </div>

        <Link to="/login" style={secondaryButtonStyle}>
          Sign In
        </Link>
      </section>
    </div>
  );
}
