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

  const loginButtonStyle: CSSProperties = {
    width: '100%',
    background: '#10b981',
    color: '#fff',
    borderRadius: 999,
    padding: '14px 24px',
    fontSize: 24,
    fontWeight: 700,
    border: 'none',
    cursor: submitting ? 'progress' : 'pointer',
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
    marginBottom: '-20px',
  };

  const logoStyle: CSSProperties = {
    width: 'min(320px, 60vw)',
    maxWidth: 360,
    height: 'auto',
    mixBlendMode: 'multiply',
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
    @media (max-width: 1024px) {
      .login-page {
        grid-template-columns: 1fr !important;
        padding: 96px 56px !important;
        gap: 64px !important;
        text-align: center;
      }
      .login-page .auth-hero {
        align-items: center;
        max-width: 100%;
        width: 100%;
      }
      .login-page .auth-panel {
        margin-left: 0 !important;
        margin-right: 0 !important;
        margin: 0 auto !important;
        width: min(480px, 100%) !important;
        max-width: 480px;
      }
      .login-page .auth-logo {
        margin-bottom: -28px !important;
      }
    }
    @media (max-width: 768px) {
      .login-page {
        padding: 72px 24px !important;
        gap: 52px !important;
      }
      .login-page .auth-hero {
        align-items: center;
        width: 100%;
      }
      .login-page .auth-panel {
        width: min(420px, 100%) !important;
        max-width: 420px;
      }
      .login-page .auth-logo {
        margin-bottom: -24px !important;
      }
    }
    @media (max-width: 480px) {
      .login-page {
        padding: 56px 16px 72px !important;
        gap: 44px !important;
      }
      .login-page .auth-panel {
        width: 100% !important;
        max-width: 100%;
      }
      .login-page .auth-logo {
        margin-bottom: -16px !important;
      }
    }
  `;

  return (
    <div className="login-page" style={layoutStyle}>
      <style>{responsiveStyles}</style>
      <div className="auth-logo" style={logoContainerStyle}>
        <img style={logoStyle} src="/final_thick_lines_cropped.jpeg" alt="Vet At Your Door logo" />
      </div>
      <section className="auth-hero">
        <h1 style={headingStyle}>
          The Best
          <br />
          Veterinary
          <br />
          Care, at Home
        </h1>
        <p style={introStyle}>
          Welcome to the start of your Vet At Your Door Membership experience where proactive care
          means the best care for your furry loved one. The simplicity of a plan with the benefits
          of membership.
        </p>
      </section>

      <section className="auth-panel" style={panelStyle}>
        <div>
          <div style={labelStyle}>Already a member? Login.</div>
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
          </form>
        </div>

        <div style={{ fontSize: 20, lineHeight: 1.4 }}>
          <div>First time? Quickly create an account to view your pets&apos; information and</div>
          <div>select their membership plan:</div>
        </div>

        <Link to="/create-client" style={secondaryButtonStyle}>
          Create User
        </Link>

        <div style={{ fontSize: 16, color: '#475569' }}>
          <Link to="/request-reset" state={{ email }} style={{ color: '#052940' }}>
            Forgot password?
          </Link>
        </div>
      </section>
    </div>
  );
}
