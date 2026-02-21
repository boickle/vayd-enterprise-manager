import { useLocation, useNavigate, Link } from 'react-router-dom';
import type { NavigateFunction } from 'react-router-dom';
import type { CSSProperties } from 'react';

export type ErrorPageState = {
  status?: number;
  message?: string;
  /** If true, show "Request a new link" as primary action (e.g. expired reset token). */
  requestNewLink?: boolean;
};

const defaultMessages: Record<number, string> = {
  400: "We couldn't complete your request. The link or information may be invalid or no longer valid.",
  401: "You're not signed in or your session has expired. Please sign in again.",
  403: "You don't have permission to view this page.",
  404: "This page wasn't found.",
  408: "The request took too long. Please try again.",
  409: "This action couldn't be completed—something may have changed. Please refresh and try again.",
  410: "This link has expired or is no longer valid.",
  422: "Something you entered isn't quite right. Please check and try again.",
  500: "Something went wrong on our end. Please try again in a few minutes.",
  502: "We're temporarily unavailable. Please try again in a few minutes.",
  503: "We're temporarily busy. Please try again in a few minutes.",
};

function getDefaultMessage(status: number): string {
  return defaultMessages[status] ?? "Something went wrong. Please try again or go back.";
}

export default function ErrorPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = (location.state as ErrorPageState) ?? {};
  const search = new URLSearchParams(location.search);

  const status = state.status ?? (search.get('status') ? Number(search.get('status')) : undefined);
  const requestNewLink = state.requestNewLink ?? false;
  const rawMessage = state.message ?? search.get('message') ?? undefined;
  const message = rawMessage && rawMessage.trim() ? rawMessage.trim() : (status ? getDefaultMessage(status) : "Something went wrong. Please try again or go back.");

  const layoutStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: '24px',
    padding: 'min(10vh, 80px) min(8vw, 96px) min(12vh, 120px)',
    minHeight: '100vh',
    background: 'radial-gradient(1000px 600px at 20% -10%, #ecfff8 0%, transparent 60%), #f6fbf9',
  };

  const cardStyle: CSSProperties = {
    width: 'min(480px, 100%)',
    padding: '32px 28px',
    borderRadius: 16,
    background: '#fff',
    boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
    border: '1px solid #e5e7eb',
    textAlign: 'center',
  };

  const logoStyle: CSSProperties = {
    width: 'min(240px, 50vw)',
    height: 'auto',
    mixBlendMode: 'multiply',
    marginBottom: 8,
  };

  return (
    <div className="error-page" style={layoutStyle}>
      <div style={cardStyle}>
        <img
          style={logoStyle}
          src="/final_thick_lines_cropped.jpeg"
          alt="Vet At Your Door"
        />
        {status && (
          <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 8 }}>
            Error {status}
          </p>
        )}
        <h1 style={{ fontSize: 22, fontWeight: 600, color: '#111827', margin: '0 0 12px' }}>
          {status === 404 ? "Page not found" : "Something went wrong"}
        </h1>
        <p style={{ fontSize: 16, color: '#4b5563', lineHeight: 1.5, margin: '0 0 24px' }}>
          {message}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
          {requestNewLink && (
            <Link
              to="/request-reset"
              className="btn"
              style={{ background: '#4FB128', color: '#fff', textDecoration: 'none', padding: '10px 20px', borderRadius: 8 }}
            >
              Request a new link
            </Link>
          )}
          <Link
            to="/login"
            className="btn secondary"
            style={{ color: '#10b981', textDecoration: 'none', padding: '10px 20px' }}
          >
            Back to Login
          </Link>
          <button
            type="button"
            className="link-strong"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#6b7280' }}
            onClick={() => navigate(-1)}
          >
            Go back
          </button>
        </div>
      </div>
    </div>
  );
}

/** Navigate to the error page with optional status and message. Use from catch blocks when you get 400/500. */
export function navigateToError(
  navigate: NavigateFunction,
  options: { status?: number; message?: string; requestNewLink?: boolean }
) {
  navigate('/error', { state: options, replace: true });
}
