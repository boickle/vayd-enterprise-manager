import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';

function extractRoles(user: Record<string, unknown> | null | undefined): string[] {
  if (!user) return [];
  const roleClaim = user.role ?? user.roles;
  if (Array.isArray(roleClaim)) return roleClaim.map((r) => String(r));
  if (roleClaim) return [String(roleClaim)];
  return [];
}

type ClientLoginFormProps = {
  initialEmail?: string;
  emailReadOnly?: boolean;
  onSuccess?: () => void;
};

export function ClientLoginForm({
  initialEmail = '',
  emailReadOnly = false,
  onSuccess,
}: ClientLoginFormProps) {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialEmail) setEmail(initialEmail);
  }, [initialEmail]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await login(email.trim(), password);

      if (res?.resetRequired) {
        if (res.resetCode) {
          navigate('/reset-password', {
            replace: true,
            state: { email: email.trim(), code: res.resetCode, reason: 'temp-password' },
          });
        } else {
          navigate('/request-reset', { replace: true, state: { email: email.trim(), reason: 'temp-password' } });
        }
        return;
      }

      const roles = extractRoles(res?.user as Record<string, unknown> | undefined);
      if (!roles.includes('client')) {
        setError('Please log in with your client portal account to request an appointment.');
        return;
      }

      onSuccess?.();
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } }; message?: string })?.response?.data
          ?.message ||
        (err as Error)?.message ||
        'Login failed';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div>
        <label
          htmlFor="existing-client-login-email"
          style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 600, color: '#374151' }}
        >
          Email
        </label>
        <input
          id="existing-client-login-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          readOnly={emailReadOnly}
          required
          autoComplete="username"
          style={{
            width: '100%',
            padding: '12px',
            border: '1px solid #d1d5db',
            borderRadius: '8px',
            fontSize: '14px',
            backgroundColor: emailReadOnly ? '#f9fafb' : '#fff',
          }}
        />
      </div>
      <div>
        <label
          htmlFor="existing-client-login-password"
          style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 600, color: '#374151' }}
        >
          Password
        </label>
        <input
          id="existing-client-login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          style={{
            width: '100%',
            padding: '12px',
            border: '1px solid #d1d5db',
            borderRadius: '8px',
            fontSize: '14px',
          }}
        />
      </div>
      {error && (
        <div style={{ fontSize: '14px', color: '#b91c1c', padding: '10px', backgroundColor: '#fef2f2', borderRadius: '8px' }}>
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={submitting}
        style={{
          padding: '12px 20px',
          backgroundColor: submitting ? '#9ca3af' : '#10b981',
          color: '#fff',
          border: 'none',
          borderRadius: '8px',
          fontSize: '14px',
          fontWeight: 600,
          cursor: submitting ? 'not-allowed' : 'pointer',
        }}
      >
        {submitting ? 'Logging in…' : 'Log in'}
      </button>
      <div style={{ fontSize: '13px', color: '#6b7280' }}>
        <Link to="/request-reset" state={{ email: email.trim() }} style={{ color: '#059669' }}>
          Forgot password?
        </Link>
      </div>
    </form>
  );
}
