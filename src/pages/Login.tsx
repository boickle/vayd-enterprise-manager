// src/pages/Login.tsx
import { FormEvent, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nav = useNavigate();
  const location = useLocation() as any;
  const { login } = useAuth();
  const from = location.state?.from?.pathname ?? '/';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await login(email, password); // { token, user, resetRequired, resetCode }

      if (res?.resetRequired) {
        if (res.resetCode) {
          nav('/reset-password', {
            replace: true,
            state: { email, code: res.resetCode, reason: 'temp-password' },
          });
        } else {
          nav('/request-reset', { replace: true, state: { email, reason: 'temp-password' } });
        }
        return;
      }

      // ------ NEW: role-aware redirect ------
      const roles: string[] = Array.isArray(res?.user?.role)
        ? res.user.role
        : res?.user?.role
          ? [String(res.user.role)]
          : Array.isArray(res?.user?.roles)
            ? res.user.roles
            : [];

      const isClient = roles.includes('client');

      if (isClient) {
        // Clients always land on the standalone client portal
        nav('/client-portal', { replace: true });
        return;
      }

      // Employees: go back to where they came from, or /home
      const fallback = from && from !== '/' && from !== '/login' ? from : '/home';
      nav(fallback, { replace: true });
      // --------------------------------------
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  const layoutStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)',
    alignItems: 'flex-start',
    gap: 0,
    padding: 'min(4vh, 40px) min(8vw, 96px) min(4vh, 40px)',
    minHeight: '100vh',
    background: 'radial-gradient(1000px 600px at 20% -10%, #ecfff8 0%, transparent 60%), #f6fbf9',
  };

  const headingStyle: CSSProperties = {
    margin: '0',
    fontFamily: '"Libre Baskerville", Georgia, serif',
    fontSize: 'clamp(20px, 2.8vw, 36px)',
    lineHeight: 1.4,
    color: '#0f172a',
    textAlign: 'center',
    whiteSpace: 'nowrap',
  };

  const introStyle: CSSProperties = {
    marginTop: '0',
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
    marginTop: '0',
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

  const loginButtonStyle: CSSProperties = {
    width: '100%',
    background: '#4FB128',
    color: '#fff',
    borderRadius: 999,
    padding: '14px 24px',
    fontSize: 24,
    fontWeight: 700,
    border: 'none',
    cursor: submitting ? 'progress' : 'pointer',
    boxShadow: '0 10px 25px -15px rgba(79, 177, 40, 0.5)',
  };

  const secondaryButtonStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    borderRadius: 999,
    border: '2px solid #4FB128',
    background: '#ffffff',
    color: '#4FB128',
    fontWeight: 700,
    fontSize: 24,
    padding: '12px 32px',
    cursor: 'pointer',
    textDecoration: 'none',
  };

  const logoContainerStyle: CSSProperties = {
    gridColumn: '1 / -1',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '0',
    width: '100%',
    paddingBottom: '32px',
  };

  const logoStyle: CSSProperties = {
    width: 'min(320px, 60vw)',
    maxWidth: 360,
    height: 'auto',
    mixBlendMode: 'multiply',
    marginBottom: '24px',
    objectFit: 'contain',
  };

  const logoTextStyle: CSSProperties = {
    fontSize: 'clamp(28px, 5vw, 36px)',
    fontWeight: 700,
    color: '#4FB128',
    margin: 0,
    textAlign: 'center',
  };

  const taglineStyle: CSSProperties = {
    fontSize: 'clamp(16px, 3vw, 20px)',
    color: '#1f2937',
    margin: '8px 0 0 0',
    textAlign: 'center',
    fontWeight: 400,
  };

  const responsiveStyles = `
    .login-page .auth-hero {
      display: flex;
      flex-direction: column;
      gap: 32px;
    }
    .login-page .auth-panel form {
      width: 100%;
    }
    .login-page button[type="submit"],
    .login-page .auth-panel a {
      transition: background-color 0.2s ease, color 0.2s ease, border 0.2s ease !important;
    }
    .login-page button[type="submit"]:hover:not(:disabled) {
      background: #ffffff !important;
      color: #4FB128 !important;
      border: 2px solid #4FB128 !important;
    }
    .login-page .auth-panel a:hover {
      background: #4FB128 !important;
      color: #ffffff !important;
      border: 2px solid #4FB128 !important;
    }
    @media (max-height: 860px) {
      .login-page {
        grid-template-columns: 1fr !important;
        padding: 40px 56px 40px !important;
        gap: 48px !important;
        text-align: center;
      }
      .login-page .auth-hero {
        align-items: center;
        max-width: 100%;
        width: 100%;
        padding-top: 40px !important;
      }
      .login-page .auth-hero h1 {
        padding-top: 50px !important;
      }
    .login-page .auth-logo {
        margin-bottom: -100px !important;
      }
      .login-page .auth-logo img {
        width: min(280px, 50vw) !important;
        max-width: 320px !important;
      }
      .login-page .auth-logo h1,
      .login-page .auth-logo p {
        text-align: center !important;
      }
      .login-page .auth-panel {
        margin-left: 0 !important;
        margin-right: 0 !important;
        margin: 0 auto !important;
        width: min(480px, 100%) !important;
        max-width: 480px;
      }
    }
    @media (max-width: 1024px) {
      .login-page {
        grid-template-columns: 1fr !important;
        padding: 40px 56px 40px !important;
        gap: 48px !important;
        text-align: center;
      }
      .login-page .auth-hero {
        align-items: center;
        max-width: 100%;
        width: 100%;
        padding-top: 40px !important;
      }
      .login-page .auth-hero h1 {
        padding-top: 50px !important;
      }
    .login-page .auth-logo {
        margin-bottom: -100px !important;
      }
      .login-page .auth-logo img {
        width: min(280px, 50vw) !important;
        max-width: 320px !important;
      }
      .login-page .auth-logo h1,
      .login-page .auth-logo p {
        text-align: center !important;
      }
      .login-page .auth-panel {
        margin-left: 0 !important;
        margin-right: 0 !important;
        margin: 0 auto !important;
        width: min(480px, 100%) !important;
        max-width: 480px;
      }
    }
    @media (max-width: 768px) {
      .login-page {
        padding: 32px 24px 32px !important;
        gap: 40px !important;
      }
      .login-page .auth-hero {
        align-items: center;
        width: 100%;
        padding-top: 40px !important;
      }
      .login-page .auth-hero h1 {
        padding-top: 50px !important;
      }
      .login-page .auth-panel {
        width: min(420px, 100%) !important;
        max-width: 420px;
      }
      .login-page .auth-logo {
        margin-bottom: -80px !important;
      }
      .login-page .auth-logo img {
        width: min(240px, 45vw) !important;
        max-width: 280px !important;
      }
    }
    @media (max-width: 480px) {
      .login-page {
        padding: 24px 16px 32px !important;
        gap: 32px !important;
      }
      .login-page .auth-hero {
        padding-top: 40px !important;
      }
      .login-page .auth-hero h1 {
        padding-top: 50px !important;
      }
      .login-page .auth-panel {
        width: 100% !important;
        max-width: 100%;
      }
      .login-page .auth-logo {
        margin-bottom: -60px !important;
      }
      .login-page .auth-logo img {
        width: min(200px, 40vw) !important;
        max-width: 240px !important;
      }
    }
  `;

  return (
    <div className="login-page" style={layoutStyle}>
      <style>{responsiveStyles}</style>
      <div className="auth-logo" style={logoContainerStyle}>
        <img style={logoStyle} src="/final_thick_lines_cropped.jpeg" alt="Vet At Your Door logo" />
        <h1 style={headingStyle}>
          The Best Veterinary Care, at Home
        </h1>
        <hr style={{ width: '80%', border: 'none', borderTop: '1px solid #0f172a', margin: '24px 0 0 0' }} />
      </div>
      <section className="auth-hero">
        <p style={introStyle}>
          Welcome to your Vet At Your Door Membership experience where proactive care
          means the best care for your furry loved one. The simplicity of a plan with the benefits
          of membership.
        </p>
        <div style={{ fontSize: 18, color: '#475569', maxWidth: 560 }}>
          <div><strong>New to Vet At Your Door</strong>?</div>
          <div style={{ marginTop: '8px' }}>
            To become a client and unlock membership options,{' '}
            <a 
              href="https://form.jotform.com/221585880190157" 
              style={{ color: '#052940', textDecoration: 'underline', cursor: 'pointer' }}
            >
              click here
            </a>{' '}
            to request your first appointment.
          </div>
        </div>
      </section>

      <section className="auth-panel" style={panelStyle}>
        <div style={{ marginTop: '0' }}>
          <div style={labelStyle}><strong>Log in to your portal.</strong></div>
          <form
            onSubmit={onSubmit}
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
            aria-label="Login form"
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
                autoComplete="username"
              />
            </div>
            <div style={{ width: '100%' }}>
              <input
                style={inputStyle}
                className="input"
                placeholder="Password"
                aria-label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            {error && (
              <div className="danger" style={{ textAlign: 'center' }}>
                {error}
              </div>
            )}
            <button style={loginButtonStyle} type="submit" disabled={submitting}>
              {submitting ? 'Logging in…' : 'Login'}
            </button>
            <div style={{ fontSize: 16, color: '#475569', textAlign: 'left', marginTop: '4px' }}>
              <Link to="/request-reset" state={{ email }} style={{ color: '#052940' }}>
                Forgot password?
              </Link>
            </div>
          </form>
        </div>

        <div style={{ fontSize: 20, lineHeight: 1.4 }}>
          <div><strong>Existing Vet At Your Door client</strong>?</div>
          <div style={{ marginTop: '8px' }}>
            If you&apos;ve already had an appointment with us or have one scheduled, create your portal account here using the email we have on file.
          </div>
          <div style={{ marginTop: '8px' }}>
            Your client portal is the first step to enrolling in a membership.
          </div>
        </div>

        <Link to="/create-client" style={secondaryButtonStyle}>
          Create User
        </Link>
      </section>
    </div>
  );
}
