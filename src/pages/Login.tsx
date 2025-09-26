// src/pages/Login.tsx
import { FormEvent, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { Field } from '../components/Field';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nav = useNavigate();
  const location = useLocation() as any;
  const { login } = useAuth();
  const from = location.state?.from?.pathname ?? '/routing';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await login(email, password); // returns { token, user, resetRequired, resetCode }

      if (res?.resetRequired) {
        // If backend provided a short code (e.g., for temp-password flow), go to code-based reset
        if (res.resetCode) {
          nav('/resetpass', {
            replace: true,
            state: {
              email,
              code: res.resetCode,
              reason: 'temp-password',
            },
          });
        } else {
          // Otherwise, prompt them to request a reset link
          nav('/requestreset', {
            replace: true,
            state: {
              email,
              reason: 'temp-password',
            },
          });
        }
        return;
      }

      // Normal success path
      nav(from, { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: '30px auto' }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Sign in</h2>
        <form onSubmit={onSubmit} className="grid" style={{ gap: 12 }}>
          <Field label="Email">
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
            />
          </Field>
          <Field label="Password">
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </Field>
          {error && <div className="danger">{error}</div>}
          <button className="btn" type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Continue'}
          </button>
        </form>

        <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
          <Link to="/requestreset" state={{ email }}>
            Forgot password?
          </Link>
          <div className="row" style={{ gap: 12 }}>
            <Link to="/create">Create user</Link>
            {/* “Reset with token/code” page — will read state.email/state.code if present */}
            <Link to="/resetpass" state={{ email }}>
              Reset with token
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
