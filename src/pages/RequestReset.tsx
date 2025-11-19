import { FormEvent, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { http } from '../api/http';

export default function RequestReset() {
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
      await http.post('/auth/request-reset', { email });
      setMsg('If this user exists, a reset email has been sent.');
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Request failed');
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
    marginBottom: '20px',
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

  const labelStyle: CSSProperties = {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 6,
    display: 'block',
  };

  const inputStyle: CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 12,
    border: '1px solid #e5e7eb',
    background: '#ffffff',
    color: '#111827',
    fontFamily: 'system-ui, sans-serif',
    fontSize: 16,
  };

  const submitButtonStyle: CSSProperties = {
    width: '100%',
    background: '#10b981',
    color: '#073a2e',
    borderRadius: 12,
    padding: '10px 14px',
    fontSize: 16,
    fontWeight: 700,
    border: 'none',
    cursor: pending ? 'progress' : 'pointer',
    boxShadow: '0 6px 16px rgba(18, 147, 114, 0.15)',
  };

  return (
    <div className="request-reset-page" style={layoutStyle}>
      <div style={logoContainerStyle}>
        <img 
          style={logoStyle} 
          src="/final_thick_lines_cropped.jpeg" 
          alt="Vet At Your Door logo"
        />
      </div>
      <div className="card" style={cardWrapperStyle}>
        <h2 style={{ marginTop: 0 }}>Request Password Reset</h2>
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={labelStyle}>Email</div>
            <input
              style={inputStyle}
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              required
            />
          </div>
          {error && <div className="danger" style={{ textAlign: 'center' }}>{error}</div>}
          {msg && <div className="pill" style={{ textAlign: 'center' }}>{msg}</div>}
          <button style={submitButtonStyle} type="submit" disabled={pending}>
            {pending ? 'Sending…' : 'Send reset email'}
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
