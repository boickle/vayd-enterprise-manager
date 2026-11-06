// src/pages/PracticeHandoff.tsx
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { apiErrorMessage } from '../api/http';

/** Finishes signing in after login or the practice switcher sent the browser to this practice's host. */
export default function PracticeHandoffPage() {
  const { redeemHandoff } = useAuth();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const code = params.get('code');
    if (!code) {
      setError('This sign-in link is missing its code.');
      return;
    }
    window.history.replaceState(null, '', '/auth/handoff');

    redeemHandoff(code)
      .then((res) => {
        const role = res.user?.role;
        const roles = Array.isArray(role) ? role : role ? [String(role)] : [];
        nav(roles.includes('client') ? '/client-portal' : '/schedule', { replace: true });
      })
      .catch((err) => setError(apiErrorMessage(err)));
  }, [params, redeemHandoff, nav]);

  return (
    <div className="container" style={{ padding: 32, textAlign: 'center' }}>
      {error ? (
        <>
          <p className="danger">{error}</p>
          <Link to="/login">Go to sign in</Link>
        </>
      ) : (
        <p>Signing you in…</p>
      )}
    </div>
  );
}
