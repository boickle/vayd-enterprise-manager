// src/pages/CreateClientUser.tsx
import { FormEvent, useEffect, useState } from 'react';
import { http } from '../api/http';
import { Field } from '../components/Field';

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
        setError('We couldn’t find that email. Please use the email on file with our clinic.');
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

  if (screen === 'status') {
    return (
      <div style={{ maxWidth: 560, margin: '30px auto' }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Check your email</h2>
          <p className="muted">
            If <strong>{submittedEmail}</strong> matches a client profile, we’ve sent instructions
            to finish setting up your portal access.
          </p>

          <div style={{ marginTop: 16 }}>
            <h3 style={{ margin: '0 0 8px' }}>What happens next</h3>
            <ol style={{ paddingLeft: 18, margin: 0 }}>
              <li>Open the message from our clinic and follow the link to set your password.</li>
              <li>Return to the portal and sign in with your email and new password.</li>
            </ol>
          </div>

          <div style={{ marginTop: 16 }}>
            <h3 style={{ margin: '16px 0 8px' }}>Didn’t get an email?</h3>
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              <li>Check your spam or junk folder.</li>
              <li>
                Make sure you entered the same email you use with our clinic. If you’re not sure,
                contact us and we’ll help.
              </li>
            </ul>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
            <a className="btn" href="/login">
              Go to Sign In
            </a>
            <button
              className="btn outline"
              onClick={() => {
                setScreen('form');
                setError(null);
              }}
            >
              Use a different email
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Default: form screen
  return (
    <div style={{ maxWidth: 520, margin: '30px auto' }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Create Your Client Portal Account</h2>
        <p className="muted" style={{ marginBottom: 16 }}>
          Enter the email address we have on file for your account.
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
              placeholder="you@example.com"
            />
          </Field>

          {error && (
            <div className="danger" role="alert">
              {error}
            </div>
          )}

          <button className="btn" type="submit" disabled={pending}>
            {pending ? 'Submitting…' : 'Send Setup Link'}
          </button>
        </form>

        <p className="muted" style={{ marginTop: 12 }}>
          We’ll email you a secure link to complete your setup.
        </p>
      </div>
    </div>
  );
}
