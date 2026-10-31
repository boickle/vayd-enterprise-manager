import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { Box, CircularProgress } from '@mui/material';
import { useAuth } from '../auth/useAuth';
import {
  ANALYTICS_CATEGORIES,
  getAnalyticsTabPages,
  type AnalyticsTabPage,
} from '../analytics-tabs';
import { usePermissions } from '../permissions/PermissionContext';
import { AttentionBadge, useInventoryAttention } from '../utils/useInventoryAttention';
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
  const { can, effective, loading: permissionsLoading } = usePermissions();
  const location = useLocation();
  const navigate = useNavigate();
  const normalizedRoles = normalizeAuthRoles(role);
  const isAdmin = isAnalyticsAdmin(normalizedRoles);
  const isEmployeeAnalytics = isEmployeeAnalyticsRestricted(normalizedRoles);
  const canAccessAnalytics = isAdmin || isEmployeeAnalytics;
  const permissionsReady = Boolean(effective) || !permissionsLoading;

  const base = useMemo(() => basePath.replace(/\/$/, ''), [basePath]);

  const allTabs = getAnalyticsTabPages();
  const visibleTabs = allTabs.filter(
    (tab) =>
      matchesRole(tab.role, normalizedRoles) &&
      (!tab.permissions || isAdmin || tab.permissions.some((key) => can(key)))
  );
  const categories = ANALYTICS_CATEGORIES.map((cat) => ({
    ...cat,
    tabs: visibleTabs.filter((t) => t.category === cat.id),
  })).filter((cat) => cat.tabs.length > 0);

  const inventoryTabs = visibleTabs.filter((t) => t.category === 'inventory');
  const sees = (path: string) => inventoryTabs.some((t) => t.path === path);
  const attention = useInventoryAttention(
    canAccessAnalytics && inventoryTabs.some((t) => t.path !== 'inventory/totals')
  );
  const badgeFor = (path: string): { count: number | '!'; title: string } | null => {
    if (path === 'inventory/counts' && sees(path) && attention.flaggedCounts) {
      return {
        count: attention.flaggedCounts,
        title: `${attention.flaggedCounts} flagged count${attention.flaggedCounts === 1 ? '' : 's'} to review`,
      };
    }
    if (path === 'inventory/cost-reviews' && sees(path) && attention.costReviews) {
      return {
        count: attention.costReviews,
        title: `${attention.costReviews} cost review${attention.costReviews === 1 ? '' : 's'} waiting`,
      };
    }
    if (path === 'inventory/shrink' && sees(path) && attention.shrinkAlert) {
      const s = attention.data?.shrink;
      return {
        count: '!',
        title: `Last 30 days: shrink ${s?.shrinkPct ?? '—'}%, accuracy ${s?.accuracyPct ?? '—'}%`,
      };
    }
    return null;
  };
  const inventoryBadgeTotal =
    (sees('inventory/counts') ? attention.flaggedCounts : 0) +
    (sees('inventory/cost-reviews') ? attention.costReviews : 0) +
    (sees('inventory/shrink') && attention.shrinkAlert ? 1 : 0);

  const subPath = location.pathname.startsWith(`${base}/`)
    ? location.pathname.slice(base.length + 1)
    : '';
  const tabFor = (tabs: AnalyticsTabPage[]) =>
    tabs.find((t) => subPath === t.path || subPath.startsWith(`${t.path}/`));
  const activeTab = tabFor(visibleTabs);
  const knownTab = tabFor(allTabs);
  const activeCategory =
    categories.find((c) => c.id === (activeTab ?? knownTab)?.category) ?? categories[0];
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

  // A report this person can't see: send them to the first one they can in the same category.
  const blockedRedirect =
    knownTab && !activeTab && permissionsReady
      ? (activeCategory?.tabs[0]?.path ?? firstVisiblePath)
      : null;

  useEffect(() => {
    if (!canAccessAnalytics) {
      navigate('/schedule/routing', { replace: true });
      return;
    }
    if (blockedRedirect) navigate(`${base}/${blockedRedirect}`, { replace: true });
  }, [base, blockedRedirect, canAccessAnalytics, navigate]);

  if (!canAccessAnalytics) {
    return null;
  }

  return (
    <div className="container">
      <div className="settings-page">
        <h1 className="settings-title">Analytics</h1>
        {isEmployeeAnalytics ? (
          <p className="settings-section-description" style={{ marginBottom: 12 }}>
            Practice-wide totals and metrics for your role; doctor-level detail is limited to
            providers assigned to your account.
          </p>
        ) : null}
        <div className="settings-tabs" role="navigation" aria-label="Report categories">
          {categories.map((cat) => (
            <NavLink
              key={cat.id}
              to={`${base}/${cat.tabs[0].path}`}
              title={cat.description}
              className={() =>
                `settings-tab${cat.id === activeCategory?.id ? ' active' : ''}`
              }
            >
              {cat.label}
              {cat.id === 'inventory' ? (
                <AttentionBadge count={inventoryBadgeTotal} title="Inventory items need attention" />
              ) : null}
            </NavLink>
          ))}
        </div>
        {activeCategory && activeCategory.tabs.length > 1 ? (
          <div
            role="navigation"
            aria-label={`${activeCategory.label} reports`}
            style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '-4px 0 12px' }}
          >
            {activeCategory.tabs.map((tab) => (
              <NavLink
                key={tab.path}
                to={`${base}/${tab.path}`}
                title={tab.description}
                style={({ isActive }) => ({
                  padding: '5px 12px',
                  borderRadius: 999,
                  fontSize: 13,
                  textDecoration: 'none',
                  border: `1px solid ${isActive ? '#0f766e' : '#d0d5dd'}`,
                  background: isActive ? '#0f766e' : '#fff',
                  color: isActive ? '#fff' : '#344054',
                  fontWeight: isActive ? 600 : 500,
                })}
              >
                {tab.label}
                {(() => {
                  const badge = badgeFor(tab.path);
                  return badge ? <AttentionBadge count={badge.count} title={badge.title} /> : null;
                })()}
              </NavLink>
            ))}
          </div>
        ) : null}
        {activeTab?.description ? (
          <p className="settings-muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
            {activeTab.description}
          </p>
        ) : null}
        {visibleTabs.length === 0 ? (
          <p className="settings-muted">You don&apos;t have access to any analytics pages.</p>
        ) : showOutlet && !(knownTab && !activeTab) ? (
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
