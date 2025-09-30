// src/pages/CreateClientUser.tsx
import { FormEvent, useState } from 'react';
import { http } from '../api/http';
import { Field } from '../components/Field';

export default function CreateClientUser() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setError(null);
    setPending(true);

    try {
      const payload = { email: email.trim().toLowerCase() };
      const { data } = await http.post('/users/create-client', payload);

      // Optional: surface dev details if your API returns them (tempPassword, resetCode)
      const details =
        data?.tempPassword || data?.resetCode ? ` (response shown below for dev)` : '';

      setMsg(`Client account created. Check your email for next steps${details}.`);
      if (data) {
        // Helpful for dev — show raw response beneath the success pill
        console.debug('create-client response:', data);
      }
    } catch (err: any) {
      // 401 means not recognized as a client in your DB
      const serverMsg =
        err?.response?.data?.message ||
        (err?.response?.status === 401
          ? 'This email is not recognized as a client. Please use the email on file.'
          : null);

      setError(serverMsg || err.message || 'Create failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ maxWidth: 520, margin: '30px auto' }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Create Client Account</h2>
        <p className="muted" style={{ marginBottom: 16 }}>
          Enter the email address you use with our clinic. For security, we only allow sign-up if
          your email already exists on your client profile.
        </p>

        <form onSubmit={onSubmit} className="grid" style={{ gap: 12 }}>
          <Field label="Email">
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              inputMode="email"
            />
          </Field>

          {error && <div className="danger">{error}</div>}
          {msg && <div className="pill">{msg}</div>}

          <button className="btn" type="submit" disabled={pending}>
            {pending ? 'Creating…' : 'Create Account'}
          </button>
        </form>

        <p className="muted" style={{ marginTop: 10 }}>
          This calls <code>/users/create-client</code>. In production, the temporary password and/or
          setup link are delivered via email.
        </p>
      </div>
    </div>
  );
}
