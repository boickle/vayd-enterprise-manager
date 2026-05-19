import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAuth } from '../auth/useAuth';
import { getAnalyticsTabPages, type AnalyticsTabPage } from '../analytics-tabs';
import { isAnalyticsAdmin, isEmployeeAnalyticsRestricted, normalizeAuthRoles } from '../utils/analyticsAccess';
import './Settings.css';

function matchesRole(required: AnalyticsTabPage['role'], userRoles: string[]): boolean {
  if (!userRoles.length) return false;
  if (userRoles.includes('superadmin')) return true;
  if (!required) return true;
  const need = Array.isArray(required) ? required : [required];
  return need.some((r) => userRoles.includes(String(r)));
}

type AnalyticsProps = {
  /** Default `/analytics`; use `/schedule/analytics` when nested under the schedule app. */
  basePath?: string;
};

export default function Analytics({ basePath = '/analytics' }: AnalyticsProps) {
  const { role } = useAuth() as { role?: string | string[] };
  const location = useLocation();
  const navigate = useNavigate();
  const normalizedRoles = normalizeAuthRoles(role);
  const isAdmin = isAnalyticsAdmin(normalizedRoles);
  const isEmployeeAnalytics = isEmployeeAnalyticsRestricted(normalizedRoles);
  const canAccessAnalytics = isAdmin || isEmployeeAnalytics;

  const base = useMemo(() => basePath.replace(/\/$/, ''), [basePath]);

  const visibleTabs = getAnalyticsTabPages().filter((tab) => matchesRole(tab.role, normalizedRoles));
  const canSeePayments = visibleTabs.some((t) => t.path === 'payments');
  const canSeeSquareReconciliation = visibleTabs.some((t) => t.path === 'square-reconciliation');
  const firstVisiblePath = visibleTabs[0]?.path ?? 'payments';

  // When pathname changes, render only spinner first so it paints before the heavy child mounts.
  const pathnameRef = useRef(location.pathname);
  const pathJustChanged =
    (location.pathname === base || location.pathname.startsWith(`${base}/`)) &&
    location.pathname !== pathnameRef.current;
  if (pathJustChanged) pathnameRef.current = location.pathname;
  const showOutlet = !pathJustChanged;

  const [, setOutletTick] = useState(0);
  useEffect(() => {
    if (pathJustChanged) {
      const id = requestAnimationFrame(() => setOutletTick((t) => t + 1));
      return () => cancelAnimationFrame(id);
    }
  }, [pathJustChanged]);

  useEffect(() => {
    if (!canAccessAnalytics) {
      navigate('/schedule/routing', { replace: true });
      return;
    }
    if (location.pathname === `${base}/payments` && !canSeePayments) {
      navigate(`${base}/vsd`, { replace: true });
    }
    if (location.pathname === `${base}/square-reconciliation` && !canSeeSquareReconciliation) {
      navigate(`${base}/${firstVisiblePath}`, { replace: true });
    }
  }, [
    base,
    canAccessAnalytics,
    firstVisiblePath,
    location.pathname,
    canSeePayments,
    canSeeSquareReconciliation,
    navigate,
  ]);

  if (!canAccessAnalytics) {
    return null;
  }

  return (
    <div className="container">
      <div className="settings-page">
        <h1 className="settings-title">Analytics</h1>
        <p className="settings-section-description" style={{ marginBottom: 24 }}>
          {isEmployeeAnalytics
            ? 'Practice-wide totals and metrics for your role; doctor-level detail is limited to providers assigned to your account.'
            : 'View payments, membership purchases, operations metrics, and OpenPhone receptionist call analytics.'}
        </p>
        <div className="settings-tabs">
          {visibleTabs.map((tab) => (
            <NavLink
              key={tab.path}
              to={`${base}/${tab.path}`}
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
