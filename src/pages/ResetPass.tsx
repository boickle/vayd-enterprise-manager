import { FormEvent, useEffect, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Field } from '../components/Field';
import { completePasswordReset, requestPasswordReset } from '../api/users';

export default function ResetPass() {
  const [search] = useSearchParams();
  const location = useLocation() as any;
  const nav = useNavigate();

  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Optional: if you forwarded state like { email, token } when routing to this page
  const forwardedEmail: string | undefined = location?.state?.email;
  const forwardedToken: string | undefined = location?.state?.token;

  useEffect(() => {
    const t = (search.get('token') || forwardedToken || '').trim();
    if (t) setToken(t);
  }, [search, forwardedToken]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setError(null);
    setPending(true);
    try {
      if (!token.trim()) {
        throw new Error('Reset token is required. Check your email link or paste the token.');
      }
      if (password.length < 8) {
        throw new Error('Password must be at least 8 characters.');
      }

      await completePasswordReset(token.trim(), password);
      setMsg('Password updated. You can now sign in.');
      setTimeout(() => nav('/login', { replace: true }), 700);
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Reset failed');
    } finally {
      setPending(false);
    }
  }

  // Convenience: if an email was forwarded (e.g., from a "temp password" flow) let user trigger a link
  // to be sent to that address from here.
  async function sendLinkToEmail() {
    if (!forwardedEmail) return;
    setError(null);
    setMsg(null);
    setPending(true);
    try {
      await requestPasswordReset(forwardedEmail);
      setMsg(`Reset link sent to ${forwardedEmail}. Check your inbox.`);
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Could not send reset link');
    } finally {
      setPending(false);
    }
  }

  const layoutStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: '32px',
    padding: 'min(8vh, 80px) min(8vw, 96px) min(12vh, 120px)',
    minHeight: '100vh',
    background: 'radial-gradient(1000px 600px at 20% -10%, #ecfff8 0%, transparent 60%), #f6fbf9',
  };

  const cardWrapperStyle: CSSProperties = {
    width: 'min(480px, 100%)',
  };

  const logoContainerStyle: CSSProperties = {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    marginBottom: '-40px',
    paddingTop: '20px',
    padding: '20px',
  };

  const logoStyle: CSSProperties = {
    width: 'min(320px, 60vw)',
    maxWidth: 360,
    height: 'auto',
    mixBlendMode: 'multiply',
    display: 'block',
  };

  return (
    <div className="reset-page" style={layoutStyle}>
      <div style={logoContainerStyle}>
        <img 
          style={logoStyle} 
          src="/final_thick_lines_cropped.jpeg" 
          alt="Vet At Your Door logo"
          onError={(e) => {
            console.error('Logo failed to load:', e);
          }}
        />
      </div>
      <div className="card" style={cardWrapperStyle}>
        <h2 style={{ marginTop: 0 }}>Reset Password</h2>

        {forwardedEmail && (
          <div className="pill" style={{ marginBottom: 10 }}>
            You’re resetting the password for <strong>{forwardedEmail}</strong>.
            {!token && (
              <>
                {' '}
                No token?{' '}
                <button
                  type="button"
                  className="link-strong"
                  onClick={sendLinkToEmail}
                  disabled={pending}
                >
                  Email me a reset link
                </button>
                .
              </>
            )}
          </div>
        )}

        <form onSubmit={onSubmit} className="grid" style={{ gap: 12 }}>
          <Field label="Reset token (from your email link)">
            <input
              className="input"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste token or open the link with ?token=..."
              required
            />
          </Field>

          <Field label="New password">
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
            />
          </Field>

          {error && <div className="danger">{error}</div>}
          {msg && <div className="pill">{msg}</div>}

          <button className="btn" type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Update Password'}
          </button>
        </form>

        {!forwardedEmail && (
          <p className="muted" style={{ marginTop: 10 }}>
            Don't have a token? <Link to="/request-reset">Request a reset link</Link>.
          </p>
        )}

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <Link to="/login" style={{ color: '#10b981', textDecoration: 'none', fontSize: 14 }}>
            ← Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
}
