import { FormEvent, useState } from 'react';
import { postWithToken } from '../api/http';
import { Field } from '../components/Field';
import { useNavigate } from 'react-router-dom';

export default function ResetPass() {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const nav = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setError(null);
    setPending(true);
    try {
      setMsg('Password updated. You can now sign in.');
      setTimeout(() => nav('/login', { replace: true }), 600);
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Reset failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ maxWidth: 520, margin: '30px auto' }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Reset Password</h2>
        <form onSubmit={onSubmit} className="grid" style={{ gap: 12 }}>
          <Field label="Reset token (from email)">
            <input
              className="input"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
          </Field>
          <Field label="New password">
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          {error && <div className="danger">{error}</div>}
          {msg && <div className="pill">{msg}</div>}
          <button className="btn" type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Update Password'}
          </button>
        </form>
        <p className="muted" style={{ marginTop: 10 }}>
          This sends <code>Authorization: Bearer &lt;resetToken&gt;</code> to{' '}
          <code>/resetpass</code>.
        </p>
      </div>
    </div>
  );
}
