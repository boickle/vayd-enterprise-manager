import { FormEvent, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { Field } from '../components/Field';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();
  const location = useLocation() as any;
  const { login } = useAuth();
  const from = location.state?.from?.pathname ?? '/routing';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
      nav(from, { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Login failed');
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
            />
          </Field>
          <Field label="Password">
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          {error && <div className="danger">{error}</div>}
          <button className="btn" type="submit">
            Continue
          </button>
        </form>
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
          <Link to="/requestreset">Forgot password?</Link>
          <div className="row" style={{ gap: 12 }}>
            <Link to="/create">Create user</Link>
            <Link to="/resetpass">Reset with token</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
