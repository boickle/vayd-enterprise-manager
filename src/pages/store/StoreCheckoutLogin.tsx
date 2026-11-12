import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../../auth/useAuth';
import { isCreateClientEnabled } from '../../utils/env';

export default function StoreCheckoutLogin() {
  const nav = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await login(email.trim(), password);
      if (res.redirecting) return;
      if (res?.resetRequired) {
        if (res.resetCode) {
          nav('/reset-password', {
            replace: true,
            state: { email: email.trim(), code: res.resetCode, reason: 'temp-password' },
          });
        } else {
          nav('/request-reset', { replace: true, state: { email: email.trim(), reason: 'temp-password' } });
        }
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } }; message?: string };
      setError(axiosErr.response?.data?.message || axiosErr.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vayd-store__note vayd-store__checkout-login">
      <strong>Log in to check out</strong>
      <p>
        Same email and password as the client portal. You can keep shopping without an account;
        we only need a login to place the order.
      </p>
      <form className="vayd-store__checkout-login-form" onSubmit={(e) => void onSubmit(e)}>
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error ? (
          <p className="vayd-store__err" role="alert">
            {error}
          </p>
        ) : null}
        <div className="vayd-store__actions">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Signing in…' : 'Log in and continue'}
          </button>
          <Link to="/request-reset">Forgot password?</Link>
        </div>
      </form>
      {isCreateClientEnabled() ? (
        <p className="vayd-store__checkout-login-create">
          No portal account yet?{' '}
          <Link to="/create-client">Create one with the email we have on file</Link>.
        </p>
      ) : null}
    </div>
  );
}
