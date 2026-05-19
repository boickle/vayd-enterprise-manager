// src/App.tsx
import { Route, Routes, useNavigate, Navigate, useLocation, useOutlet } from 'react-router-dom';
import { useEffect, useMemo, useRef } from 'react';
import LoginPage from './pages/Login';
import RequestReset from './pages/RequestReset';
import ResetPass from './pages/ResetPass';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { useAuth } from './auth/useAuth';
import Home from './pages/Home';
import UserMenu from './components/UserMenu';
import NavbarGlobalSearch from './components/NavbarGlobalSearch';
import NavbarScheduleHorizontalNav from './components/NavbarScheduleHorizontalNav';
import { getAccessiblePages } from './app-pages';
import Admin from './pages/Admin';
import { getAdminTabPages } from './admin-tabs';
import { getAnalyticsTabPages } from './analytics-tabs';
import { getToolsTabPages } from './tools-tabs';
import { getSchedulingToolsTabPages } from './scheduling-tools-tabs';
import CreateClientUser from './pages/CreateClientUser';
import ClientPortal from './pages/ClientPortal';
import MembershipSignup from './pages/MembershipSignup';
import MembershipPayment from './pages/MembershipPayment';
import MembershipUpgrade from './pages/MembershipUpgrade';
import AppointmentRequestForm from './pages/AppointmentRequestForm';
import PublicRoomLoaderForm from './pages/PublicRoomLoaderForm';
import RoutingCalendarWorkspace from './pages/RoutingCalendarWorkspace';
import MyDayToggle from './pages/MyDayToggle';
import MyWeek from './pages/MyWeek';
import SchedulingTools from './pages/SchedulingTools';
import RoomLoaderPage from './pages/RoomLoader';
import { ScheduleIndexRedirect } from './pages/ScheduleLayout';
import ScheduleHomePage from './pages/ScheduleHomePage';
import LegacySchedulingToolsRedirect from './components/LegacySchedulingToolsRedirect';
import InventoryManagement from './pages/InventoryManagement';
import PimsPlaceholder from './pages/PimsPlaceholder';
import PimsClientsPage from './pages/PimsClientsPage';
import PimsPatientsPage from './pages/PimsPatientsPage';
import PimsTasksPage from './pages/PimsTasksPage';
import Settings from './pages/Settings';
import Scheduler from './pages/Scheduler';
import Analytics from './pages/Analytics';
import PostAppointmentSurvey from './pages/PostAppointmentSurvey';
import PublicReferAFriend from './pages/PublicReferAFriend';
import ErrorPage from './pages/ErrorPage';
import { usePageTracking } from './hooks/usePageTracking';
import { isCreateClientEnabled, isProduction } from './utils/env';

/** + Appointment in global navbar when viewing /schedule/* */
function NavbarScheduleAddAppointment() {
  const { abilities } = useAuth() as { abilities?: string[] };
  const location = useLocation();
  const navigate = useNavigate();
  if (!location.pathname.startsWith('/schedule')) return null;
  const toRouting = !abilities || abilities.includes('canSeeRouting');
  return (
    <button
      type="button"
      className="navbar-appointment-btn"
      onClick={() => navigate(toRouting ? '/schedule/routing' : '/schedule/home')}
    >
      + Appointment
    </button>
  );
}

/** Old `/scout/*` URLs → `/schedule/*` */
function ScoutLegacyRedirect() {
  const { pathname, search, hash } = useLocation();
  return <Navigate to={`${pathname.replace(/^\/scout/, '/schedule')}${search}${hash}`} replace />;
}

/**
 * RouteGuard - Checks if user has access to a route and redirects appropriately
 * - Not logged in → /login
 * - Logged in but no access → /client-portal (clients) or /schedule (employees)
 */
function RouteGuard() {
  const { token, role, abilities } = useAuth() as any;
  const location = useLocation();

  // Normalize roles
  const roles = useMemo<string[]>(() => {
    if (!role) return [];
    const roleArray = Array.isArray(role) ? role : [role];
    return roleArray.map((r) => String(r).toLowerCase().trim()).filter((r) => r.length > 0);
  }, [role]);

  const isClient = roles.includes('client');
  const path = location.pathname; // pathname doesn't include query params, which is what we want

  // Not logged in - redirect to login
  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Check if this is a public route (login, reset password, etc.)
  // If logged in user tries to access these, redirect to their home
  const publicRoutes = [
    '/login',
    '/create-client',
    '/request-reset',
    '/reset-password',
    '/resetpass',
    '/auth/request-reset',
    '/requestreset',
  ];
  if (publicRoutes.includes(path)) {
    return <Navigate to={isClient ? '/client-portal' : '/schedule'} replace />;
  }

  // Check if this is a client portal route
  if (path.startsWith('/client-portal')) {
    // Clients can access, employees cannot
    if (!isClient) {
      return <Navigate to="/schedule" replace />;
    }
    // If it's a client portal route and user is a client, but route doesn't exist
    // This shouldn't happen as client portal routes are defined above, but just in case
    return (
      <div className="container">
        <p>Not found</p>
      </div>
    );
  }

  // For employee routes, check if this route exists in the system
  // Get all possible pages (not filtered by user access) to check if route exists
  const allPages = [
    '/schedule',
    '/scout',
    '/doctormonth',
    '/admin',
    '/analytics',
    '/schedule-loader',
    '/survey/responses',
    '/tools',
    '/pims',
    '/settings',
    '/users/create',
    '/home',
  ];

  const routeExists = allPages.some((pagePath) => {
    return path === pagePath || path.startsWith(pagePath + '/');
  });

  if (!isClient) {
    // Employee trying to access a route
    if (routeExists) {
      // Route exists - check if user has access
      const accessiblePages = getAccessiblePages(abilities, roles);
      const hasAccess = accessiblePages.some((p: any) => {
        return p.path === path || path.startsWith(p.path + '/');
      });

      // Also allow /home for employees
      if (path === '/home' || hasAccess) {
        // User has access but route wasn't matched - this shouldn't happen
        // but show not found as fallback
        return (
          <div className="container">
            <p>Not found</p>
          </div>
        );
      }

      // Route exists but user doesn't have access - redirect to schedule hub
      return <Navigate to="/schedule" replace />;
    } else {
      // Route doesn't exist - show not found
      return (
        <div className="container">
          <p>Not found</p>
        </div>
      );
    }
  }

  // Client trying to access employee route - redirect to client portal
  if (routeExists) {
    return <Navigate to="/client-portal" replace />;
  }

  // Unknown route - show not found
  return (
    <div className="container">
      <p>Not found</p>
    </div>
  );
}

/** ------------------------------------------------------------------
 * KeepAliveOutlet
 * - Caches matched child routes and toggles their visibility instead
 *   of unmounting, so component state persists across tab switches.
 * - Uses the matching base path from keepPaths as the cache key (not the
 *   full path), so e.g. /admin/survey/results and /admin/analytics/payments
 *   share one Admin instance and tab switching works on first load.
 * ------------------------------------------------------------------ */
function KeepAliveOutlet({ keepPaths }: { keepPaths: string[] }) {
  const location = useLocation();
  const outlet = useOutlet();
  const cacheRef = useRef(new Map<string, React.ReactNode>());

  const path = location.pathname;
  const matchingKeepPath = keepPaths.find((p) => path === p || path.startsWith(p + '/'));
  const shouldKeep = matchingKeepPath !== undefined;

  // Cache current outlet by base path so sub-routes (e.g. admin tabs) share one instance
  if (outlet && matchingKeepPath !== undefined) {
    cacheRef.current.set(matchingKeepPath, outlet);
  }

  return (
    <>
      {[...cacheRef.current.entries()].map(([basePath, element]) => {
        const visible = path === basePath || path.startsWith(basePath + '/');
        return (
          <div
            key={basePath}
            style={{
              display: visible ? 'flex' : 'none',
              flexDirection: 'column',
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              width: '100%',
            }}
          >
            {element}
          </div>
        );
      })}
      {/* If current path isn't in keep list, render it normally (not cached) */}
      {!shouldKeep && outlet}
    </>
  );
}

export default function App() {
  const { token, abilities, role } = useAuth() as any;
  const nav = useNavigate();
  const location = useLocation();

  // Track page views on route changes
  usePageTracking();

  // Normalize roles - handle arrays, single values, and edge cases
  const roles = useMemo<string[]>(() => {
    if (!role) return [];
    const roleArray = Array.isArray(role) ? role : [role];
    return roleArray.map((r) => String(r).toLowerCase().trim()).filter((r) => r.length > 0);
  }, [role]);
  // Check if user is a client - must explicitly have 'client' role
  const isClient = useMemo(() => roles.includes('client'), [roles]);

  // Compute employee pages if NOT a client (all accessible pages for routing)
  const pages = useMemo(
    () => (isClient ? [] : getAccessiblePages(abilities, roles)),
    [abilities, roles, isClient]
  );
  const menuExtras = useMemo(() => {
    if (isClient) return [];
    const paths = new Set(pages.map((p: { path: string }) => p.path));
    const out: { label: string; to: string }[] = [];
    if (paths.has('/analytics')) out.push({ label: 'Analytics', to: '/analytics' });
    if (paths.has('/tools')) out.push({ label: 'Tools', to: '/tools' });
    if (paths.has('/pims')) out.push({ label: 'Appointments', to: '/schedule/routing' });
    return out;
  }, [isClient, pages]);

  // If a client lands on "/" or "/home", redirect to client portal
  useEffect(() => {
    if (!token) return;
    if (isClient && (location.pathname === '/' || location.pathname === '/home')) {
      nav('/client-portal', { replace: true });
    }
  }, [token, isClient, location.pathname, nav]);

  // Keep-alive list for employee tabs (home + all page paths)
  const keepAlivePaths = useMemo(() => ['/home', ...pages.map((p: any) => p.path)], [pages]);

  const isProd = isProduction();

  const mainClassName = useMemo(() => {
    if (isClient && location.pathname.startsWith('/client-portal')) return '';
    const path = location.pathname;
    if (path.startsWith('/pims')) return 'pims-main-wrapper';
    if (path.startsWith('/schedule')) return 'schedule-main-wrapper';
    return 'container';
  }, [isClient, location.pathname]);

  return (
    <div>
      {!isProd && (
        <div
          role="banner"
          aria-live="polite"
          style={{
            background: 'linear-gradient(90deg, #b45309 0%, #d97706 100%)',
            color: '#fff',
            textAlign: 'center',
            padding: '6px 12px',
            fontSize: '13px',
            fontWeight: 600,
            letterSpacing: '0.02em',
            boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
          }}
        >
          Not production — you are using a development or staging environment
        </div>
      )}
      {/* Hide navbar on client portal, login page, create-client page, reset password, and public room loader form */}
      {!(isClient && location.pathname.startsWith('/client-portal')) &&
        location.pathname !== '/login' &&
        location.pathname !== '/create-client' &&
        location.pathname !== '/reset-password' &&
        location.pathname !== '/request-reset' &&
        !location.pathname.startsWith('/public/room-loader') &&
        !location.pathname.startsWith('/survey/') &&
        !location.pathname.startsWith('/refer-a-friend') && (
          <header
            className={`navbar${
              token && !isClient && location.pathname.startsWith('/schedule') ? ' navbar--schedule-shell' : ''
            }`}
          >
            <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <img
                src="/final_thick_lines_cropped.jpeg"
                alt="Scout"
                style={{
                  height: '60px',
                  width: 'auto',
                  opacity: 0.9,
                  mixBlendMode: 'multiply',
                }}
              />
              <span
                style={{
                  fontFamily: "'Libre Baskerville', 'Times New Roman', serif",
                  fontWeight: 400,
                  fontSize: '30px',
                  color: '#2c1810',
                  lineHeight: '60px',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                Scout
                <sup
                  style={{
                    fontSize: '9px',
                    verticalAlign: 'super',
                    marginLeft: '2px',
                    lineHeight: 0,
                    position: 'relative',
                    top: '-8px',
                  }}
                >
                  TM
                </sup>
              </span>
            </div>

            {token && !isClient && (
              <div className="navbar__center-block">
                <div className="navbar__mid">
                  <NavbarScheduleHorizontalNav />
                </div>
                <div className="navbar__spacer" aria-hidden="true" />
              </div>
            )}
            {token && !isClient && <NavbarGlobalSearch />}
            {token && !isClient && <NavbarScheduleAddAppointment />}
            {token && <UserMenu menuExtras={isClient ? [] : menuExtras} />}
          </header>
        )}

      <main className={mainClassName}>
        <Routes>
          {/* Root redirect: client -> client-portal, else -> schedule hub */}
          <Route
            path="/"
            element={
              token ? (
                isClient ? (
                  <Navigate to="/client-portal" replace />
                ) : (
                  <Navigate to="/schedule" replace />
                )
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />

          {/* Public auth */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/create-client" element={isCreateClientEnabled() ? <CreateClientUser /> : <Navigate to="/login" replace />} />
          <Route path="/request-reset" element={<RequestReset />} />
          <Route path="/auth/request-reset" element={<Navigate to="/request-reset" replace />} />
          <Route path="/requestreset" element={<Navigate to="/request-reset" replace />} />
          <Route path="/reset-password" element={<ResetPass />} />
          <Route path="/resetpass" element={<ResetPass />} />
          <Route path="/error" element={<ErrorPage />} />

          {/* Client portal (standalone) */}
          <Route
            path="/client-portal"
            element={
              <ProtectedRoute>
                <ClientPortal />
              </ProtectedRoute>
            }
          />
          <Route
            path="/client-portal/membership-signup"
            element={
              <ProtectedRoute>
                <MembershipSignup />
              </ProtectedRoute>
            }
          />
          <Route
            path="/client-portal/membership-payment"
            element={
              <ProtectedRoute>
                <MembershipPayment />
              </ProtectedRoute>
            }
          />
          <Route
            path="/client-portal/membership-upgrade"
            element={
              <ProtectedRoute>
                <MembershipUpgrade />
              </ProtectedRoute>
            }
          />
          <Route path="/client-portal/request-appointment" element={<AppointmentRequestForm />} />
          {/* Public membership signup when started from appointment request (no auth required) */}
          <Route path="/client-portal/request-appointment/membership-signup" element={<MembershipSignup />} />

          {/* Public surveys by slug (no login), e.g. post-appointment, exit-interview; * catches duplicate path in email links */}
          <Route path="/survey/:surveySlug" element={<PostAppointmentSurvey />} />
          <Route path="/survey/:surveySlug/*" element={<PostAppointmentSurvey />} />
          <Route path="/refer-a-friend" element={<PublicReferAFriend />} />
          {/* Public room loader form (no authentication required) */}
          <Route path="/public/room-loader/form" element={<PublicRoomLoaderForm />} />

          {/* Employees only: keep these pages alive across tab switches */}
          {!isClient && (
            <Route
              // Key by token so cache clears on logout/login
              element={
                <ProtectedRoute>
                  <KeepAliveOutlet keepPaths={keepAlivePaths} />
                </ProtectedRoute>
              }
            >
              <Route path="/home" element={<Home />} />
              <Route path="/scout/*" element={<ScoutLegacyRedirect />} />
              <Route path="/routing" element={<Navigate to="/schedule/routing" replace />} />
              <Route path="/doctor" element={<Navigate to="/schedule/my-day" replace />} />
              <Route path="/doctorweek" element={<Navigate to="/schedule/scheduler" replace />} />
              <Route path="/room-loader" element={<Navigate to="/schedule/room-loader" replace />} />
              <Route path="/scheduler" element={<Navigate to="/schedule/scheduler" replace />} />
              <Route path="/scheduling-tools/*" element={<LegacySchedulingToolsRedirect />} />
              <Route
                path="/schedule-loader"
                element={<Navigate to="/schedule/scheduling-tools/schedule-loader" replace />}
              />
              {pages.map((p: any) =>
                p.path === '/admin' ? (
                  <Route key={p.path} path={p.path} element={p.element}>
                    <Route index element={<Navigate to="/admin/survey/results" replace />} />
                    {getAdminTabPages().map((tab) => (
                      <Route key={tab.path} path={tab.path} element={tab.element} />
                    ))}
                  </Route>
                ) : p.path === '/analytics' ? (
                  <Route key={p.path} path={p.path} element={p.element}>
                    <Route index element={<Navigate to="/analytics/payments" replace />} />
                    <Route
                      path="routing"
                      element={<Navigate to="/analytics/appointments" replace />}
                    />
                    {getAnalyticsTabPages().map((tab) => (
                      <Route key={tab.path} path={tab.path} element={tab.element} />
                    ))}
                  </Route>
                ) : p.path === '/schedule' ? (
                  <Route key={p.path} path={p.path} element={p.element}>
                    <Route index element={<ScheduleIndexRedirect />} />
                    <Route path="home" element={<ScheduleHomePage />} />
                    <Route path="routing" element={<RoutingCalendarWorkspace />} />
                    <Route path="my-day" element={<MyDayToggle />} />
                    <Route path="my-week" element={<MyWeek />} />
                    <Route path="scheduling-tools" element={<SchedulingTools />}>
                      <Route
                        index
                        element={<Navigate to="/schedule/scheduling-tools/schedule-loader" replace />}
                      />
                      {getSchedulingToolsTabPages().map((tab) => (
                        <Route key={tab.path} path={tab.path} element={tab.element} />
                      ))}
                    </Route>
                    <Route path="room-loader" element={<RoomLoaderPage />} />
                    <Route path="scheduler" element={<Scheduler />} />
                    <Route path="inventory" element={<InventoryManagement />} />
                    <Route path="tasks" element={<PimsTasksPage />} />
                    <Route path="settings" element={<Settings />} />
                    <Route path="clients" element={<PimsClientsPage />} />
                    <Route path="patients" element={<PimsPatientsPage />} />
                    <Route path="analytics" element={<Analytics basePath="/schedule/analytics" />}>
                      <Route index element={<Navigate to="/schedule/analytics/payments" replace />} />
                      <Route
                        path="routing"
                        element={<Navigate to="/schedule/analytics/appointments" replace />}
                      />
                      {getAnalyticsTabPages().map((tab) => (
                        <Route
                          key={`schedule-analytics-${tab.path}`}
                          path={tab.path}
                          element={tab.element}
                        />
                      ))}
                    </Route>
                    <Route path="admin" element={<Admin basePath="/schedule/admin" />}>
                      <Route index element={<Navigate to="survey/results" replace />} />
                      {getAdminTabPages().map((tab) => (
                        <Route key={`schedule-admin-${tab.path}`} path={tab.path} element={tab.element} />
                      ))}
                    </Route>
                  </Route>
                ) : p.path === '/pims' ? (
                  <Route key={p.path} path={p.path} element={p.element}>
                    <Route index element={<Navigate to="/pims/scheduler" replace />} />
                    <Route path="overview" element={<PimsPlaceholder title="Overview" />} />
                    <Route path="scheduler" element={<Scheduler />} />
                    <Route path="tasks" element={<PimsTasksPage />} />
                    <Route path="clients" element={<PimsClientsPage />} />
                    <Route path="patients" element={<PimsPatientsPage />} />
                    <Route path="labs" element={<PimsPlaceholder title="Labs" />} />
                    <Route path="inventory" element={<InventoryManagement />} />
                    <Route
                      path="reports/summary"
                      element={<PimsPlaceholder title="Reports — Summary" />}
                    />
                    <Route
                      path="reports/activity"
                      element={<PimsPlaceholder title="Reports — Activity" />}
                    />
                    <Route
                      path="settings/practice"
                      element={<PimsPlaceholder title="Settings — Practice" />}
                    />
                    <Route
                      path="settings/users"
                      element={<PimsPlaceholder title="Settings — Users" />}
                    />
                  </Route>
                ) : p.path === '/tools' ? (
                  <Route key={p.path} path={p.path} element={p.element}>
                    <Route
                      path="care-outreach"
                      element={<Navigate to="/schedule/scheduling-tools/care-outreach" replace />}
                    />
                    <Route path="inventory" element={<Navigate to="/pims/inventory" replace />} />
                    <Route index element={<Navigate to="/tools/exit-survey" replace />} />
                    {getToolsTabPages().map((tab) => (
                      <Route key={tab.path} path={tab.path} element={tab.element} />
                    ))}
                  </Route>
                ) : (
                  <Route key={p.path} path={p.path} element={p.element} />
                )
              )}
            </Route>
          )}

          {/* For clients hitting /home directly, redirect to client-portal */}
          {isClient && <Route path="/home" element={<Navigate to="/client-portal" replace />} />}

          {/* Fallback - Check access and redirect appropriately */}
          <Route path="*" element={<RouteGuard />} />
        </Routes>
      </main>
    </div>
  );
}
