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
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pending, setPending] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Optional: if you forwarded state like { email, token } when routing to this page
  const forwardedEmail: string | undefined = location?.state?.email;
  const forwardedToken: string | undefined = location?.state?.token;

  useEffect(() => {
    // Debug: Log the full URL and all query parameters
    console.log('ResetPass - Full URL:', window.location.href);
    console.log('ResetPass - Pathname:', location.pathname);
    console.log('ResetPass - Search:', location.search);
    console.log('ResetPass - Hash:', location.hash);
    console.log('ResetPass - All query params:', Object.fromEntries(search.entries()));
    
    // Check for token in multiple possible query parameter names
    // Different endpoints might use different parameter names
    let t = (
      search.get('token') || 
      search.get('resetToken') || 
      search.get('code') || 
      search.get('reset_code') ||
      search.get('resetCode') ||
      search.get('t') ||
      forwardedToken || 
      ''
    ).trim();
    
    // Also check if token is in the URL path (e.g., /reset-password/abc123)
    if (!t && location.pathname) {
      const pathParts = location.pathname.split('/');
      const lastPart = pathParts[pathParts.length - 1];
      // If the last part of the path looks like a token (not 'reset-password'), use it
      if (lastPart && lastPart !== 'reset-password' && lastPart.length > 10) {
        t = lastPart.trim();
        console.log('ResetPass - Found token in path:', t);
      }
    }
    
    // Also check URL hash fragment (e.g., #token=abc123)
    if (!t && location.hash) {
      const hashParams = new URLSearchParams(location.hash.substring(1));
      t = (
        hashParams.get('token') || 
        hashParams.get('resetToken') || 
        hashParams.get('code') || 
        hashParams.get('reset_code') ||
        hashParams.get('resetCode') ||
        ''
      ).trim();
      if (t) console.log('ResetPass - Found token in hash:', t);
    }
    
    // If still no token, try to get ANY query parameter (in case it's named something unexpected)
    if (!t) {
      const allParams = Object.fromEntries(search.entries());
      const paramKeys = Object.keys(allParams);
      if (paramKeys.length > 0) {
        // Use the first parameter value as a fallback
        const firstParamValue = allParams[paramKeys[0]];
        if (firstParamValue && firstParamValue.length > 10) {
          t = firstParamValue.trim();
          console.log('ResetPass - Using first query param as token:', paramKeys[0], t);
        }
      }
    }
    
    console.log('ResetPass - Final token value:', t || '(empty)');
    if (t) setToken(t);
  }, [search, forwardedToken, location.pathname, location.hash]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setError(null);
    setPending(true);
    try {
      if (!token.trim()) {
        // Provide more helpful error message with debug info
        const allParams = Object.fromEntries(search.entries());
        const paramInfo = Object.keys(allParams).length > 0 
          ? ` Found query parameters: ${Object.keys(allParams).join(', ')}`
          : ' No query parameters found in URL.';
        console.error('ResetPass - No token found. URL:', window.location.href, paramInfo);
        throw new Error(`Invalid or missing reset link. Please use the link from your email or request a new one.${paramInfo}`);
      }
      if (password.length < 8) {
        throw new Error('Password must be at least 8 characters.');
      }
      if (password !== confirmPassword) {
        throw new Error('Passwords do not match. Please try again.');
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
        <h2 style={{ marginTop: 0 }}>Create New Password</h2>

        {forwardedEmail && (
          <div className="pill" style={{ marginBottom: 10 }}>
            You're resetting the password for <strong>{forwardedEmail}</strong>.
            {!token && (
              <>
                {' '}
                Missing reset link?{' '}
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

        {!token && !forwardedEmail && (
          <div className="pill" style={{ marginBottom: 10, background: '#fef3c7', color: '#92400e' }}>
            Please use the reset link from your email to access this page.
          </div>
        )}

        <form onSubmit={onSubmit} className="grid" style={{ gap: 12 }}>
          <Field label="New password">
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                // Clear password mismatch error when user starts typing
                if (error && error.includes('do not match')) {
                  setError(null);
                }
              }}
              placeholder="At least 8 characters"
              required
            />
          </Field>

          <Field label="Confirm password">
            <input
              className="input"
              type="password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                // Clear password mismatch error when user starts typing
                if (error && error.includes('do not match')) {
                  setError(null);
                }
              }}
              placeholder="Re-enter your password"
              required
            />
          </Field>

          {password && confirmPassword && password !== confirmPassword && (
            <div className="danger" style={{ fontSize: 14 }}>
              Passwords do not match
            </div>
          )}

          {error && <div className="danger">{error}</div>}
          {msg && <div className="pill">{msg}</div>}

          <button 
            className="btn" 
            type="submit" 
            disabled={pending}
            style={{
              background: '#4FB128',
              color: '#fff',
            }}
          >
            {pending ? 'Saving…' : 'Update Password'}
          </button>
        </form>

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <Link to="/login" style={{ color: '#10b981', textDecoration: 'none', fontSize: 14 }}>
            ← Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
}
