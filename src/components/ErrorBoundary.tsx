import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

type Props = { children: ReactNode };
type State = { hasError: boolean; error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const layoutStyle: React.CSSProperties = {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'flex-start',
      gap: '24px',
      padding: 'min(10vh, 80px) min(8vw, 96px) min(12vh, 120px)',
      minHeight: '100vh',
      background: 'radial-gradient(1000px 600px at 20% -10%, #ecfff8 0%, transparent 60%), #f6fbf9',
    };

    const cardStyle: React.CSSProperties = {
      width: 'min(480px, 100%)',
      padding: '32px 28px',
      borderRadius: 16,
      background: '#fff',
      boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
      border: '1px solid #e5e7eb',
      textAlign: 'center',
    };

    return (
      <div className="error-boundary-page" style={layoutStyle}>
        <div style={cardStyle}>
          <img
            style={{ width: 'min(240px, 50vw)', height: 'auto', mixBlendMode: 'multiply', marginBottom: 8 }}
            src="/final_thick_lines_cropped.jpeg"
            alt="Vet At Your Door"
          />
          <h1 style={{ fontSize: 22, fontWeight: 600, color: '#111827', margin: '0 0 12px' }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 16, color: '#4b5563', lineHeight: 1.5, margin: '0 0 24px' }}>
            We ran into an unexpected error. Please try refreshing the page or go back to login.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
            <button
              type="button"
              className="btn"
              style={{ background: '#4FB128', color: '#fff' }}
              onClick={() => window.location.reload()}
            >
              Refresh page
            </button>
            <Link to="/login" className="btn secondary" style={{ color: '#10b981', textDecoration: 'none' }}>
              Back to Login
            </Link>
          </div>
        </div>
      </div>
    );
  }
}
