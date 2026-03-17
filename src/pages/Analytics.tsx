import { Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
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
  const isAdmin = normalizedRoles.some((r) => ['admin', 'superadmin'].includes(r));

  const visibleTabs = getAnalyticsTabPages().filter((tab) => matchesRole(tab.role, normalizedRoles));
  const canSeePayments = visibleTabs.some((t) => t.path === 'payments');
  const canSeeSquareReconciliation = visibleTabs.some((t) => t.path === 'square-reconciliation');

  // When pathname changes, render only spinner first so it paints before the heavy child mounts.
  const pathnameRef = useRef(location.pathname);
  const pathJustChanged =
    location.pathname.startsWith('/analytics') && location.pathname !== pathnameRef.current;
  if (pathJustChanged) pathnameRef.current = location.pathname;
  const showOutlet = !pathJustChanged;

  const [, setOutletTick] = useState(0);
  useEffect(() => {
    if (pathJustChanged) {
      const id = requestAnimationFrame(() => setOutletTick((t) => t + 1));
      return () => cancelAnimationFrame(id);
    }
  }, [pathJustChanged]);

  // Analytics is admin-only: redirect non-admins away
  useEffect(() => {
    if (!isAdmin) {
      navigate('/routing', { replace: true });
      return;
    }
    if (location.pathname === '/analytics/payments' && !canSeePayments) {
      navigate('/analytics/vsd', { replace: true });
    }
    if (location.pathname === '/analytics/square-reconciliation' && !canSeeSquareReconciliation) {
      navigate('/analytics/payments', { replace: true });
    }
  }, [isAdmin, location.pathname, canSeePayments, canSeeSquareReconciliation, navigate]);

  if (!isAdmin) {
    return null;
  }

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
        ) : showOutlet ? (
          <Box sx={{ position: 'relative', minHeight: 320 }}>
            <Suspense
              fallback={
                <Box
                  sx={{
                    minHeight: 320,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <CircularProgress />
                </Box>
              }
            >
              <Outlet />
            </Suspense>
          </Box>
        ) : (
          <Box
            sx={{
              minHeight: 320,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'background.paper',
            }}
          >
            <CircularProgress />
          </Box>
        )}
      </div>
    </div>
  );
}
