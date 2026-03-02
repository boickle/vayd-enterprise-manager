import { useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { getAnalyticsTabPages, type AnalyticsTabPage } from '../analytics-tabs';
import './Settings.css';

function matchesRole(required: AnalyticsTabPage['role'], userRoles: string[]): boolean {
  if (!userRoles.length) return false;
  if (userRoles.includes('superadmin')) return true;
  if (!required) return true;
  const need = Array.isArray(required) ? required : [required];
  return need.some((r) => userRoles.includes(String(r)));
}

export default function Analytics() {
  const { role } = useAuth() as { role?: string | string[] };
  const location = useLocation();
  const navigate = useNavigate();
  const roles = Array.isArray(role) ? role : role ? [String(role)] : [];
  const normalizedRoles = roles.map((r) => String(r).toLowerCase().trim()).filter(Boolean);

  const visibleTabs = getAnalyticsTabPages().filter((tab) => matchesRole(tab.role, normalizedRoles));
  const canSeePayments = visibleTabs.some((t) => t.path === 'payments');

  // Redirect employees away from /analytics/payments to VSD
  useEffect(() => {
    if (location.pathname === '/analytics/payments' && !canSeePayments) {
      navigate('/analytics/vsd', { replace: true });
    }
  }, [location.pathname, canSeePayments, navigate]);

  return (
    <div className="container">
      <div className="settings-page">
        <h1 className="settings-title">Analytics</h1>
        <p className="settings-section-description" style={{ marginBottom: 24 }}>
          View payments and veterinary services delivered.
        </p>
        <div className="settings-tabs">
          {visibleTabs.map((tab) => (
            <NavLink
              key={tab.path}
              to={`/analytics/${tab.path}`}
              end={false}
              className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
            >
              {tab.label}
            </NavLink>
          ))}
        </div>
        {visibleTabs.length === 0 ? (
          <p className="settings-muted">You don&apos;t have access to any analytics pages.</p>
        ) : (
          <Outlet />
        )}
      </div>
    </div>
  );
}
