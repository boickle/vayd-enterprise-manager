import { FormEvent, useEffect, useState } from 'react';
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

  return (
    <div style={{ maxWidth: 520, margin: '30px auto' }}>
      <div className="card">
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
            Don’t have a token? <Link to="/requestreset">Request a reset link</Link>.
          </p>
        )}
      </div>
    </div>
  );
}
