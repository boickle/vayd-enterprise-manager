// src/App.tsx
import {
  NavLink,
  Route,
  Routes,
  useNavigate,
  Navigate,
  useLocation,
  useOutlet,
} from 'react-router-dom';
import { useEffect, useMemo, useRef } from 'react';
import LoginPage from './pages/Login';
import RequestReset from './pages/RequestReset';
import ResetPass from './pages/ResetPass';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { useAuth } from './auth/useAuth';
import Home from './pages/Home';
import AppTabs from './components/AppTabs';
import UserMenu from './components/UserMenu';
import { getAccessiblePages } from './app-pages';
import CreateClientUser from './pages/CreateClientUser';
import ClientPortal from './pages/ClientPortal';
import MembershipSignup from './pages/MembershipSignup';
import MembershipPayment from './pages/MembershipPayment';
import MembershipUpgrade from './pages/MembershipUpgrade';
import AppointmentRequestForm from './pages/AppointmentRequestForm';
import PublicRoomLoaderForm from './pages/PublicRoomLoaderForm';
import { usePageTracking } from './hooks/usePageTracking';

/**
 * RouteGuard - Checks if user has access to a route and redirects appropriately
 * - Not logged in → /login
 * - Logged in but no access → /client-portal (clients) or /routing (employees)
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
  const publicRoutes = ['/login', '/create-client', '/request-reset', '/reset-password', '/resetpass', '/auth/request-reset', '/requestreset'];
  if (publicRoutes.includes(path)) {
    return <Navigate to={isClient ? '/client-portal' : '/routing'} replace />;
  }

  // Check if this is a client portal route
  if (path.startsWith('/client-portal')) {
    // Clients can access, employees cannot
    if (!isClient) {
      return <Navigate to="/routing" replace />;
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
    '/routing',
    '/doctor',
    '/doctormonth',
    '/users/create',
    '/analytics/payments',
    '/analytics/ops',
    '/analytics/revenue/doctor',
    '/audit',
    '/simulation',
    '/schedule-loader',
    '/settings',
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

      // Route exists but user doesn't have access - redirect to routing
      return <Navigate to="/routing" replace />;
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
 * - Pass a list of base paths you want to keep alive (e.g. /home and
 *   any tab paths). Subpaths (/page/x) are also kept alive.
 * ------------------------------------------------------------------ */
function KeepAliveOutlet({ keepPaths }: { keepPaths: string[] }) {
  const location = useLocation();
  const outlet = useOutlet();
  const cacheRef = useRef(new Map<string, React.ReactNode>());

  const path = location.pathname;
  const shouldKeep = keepPaths.some((p) => path === p || path.startsWith(p + '/'));

  // Cache current outlet if path should be kept alive
  if (outlet && shouldKeep) {
    cacheRef.current.set(path, outlet);
  }

  return (
    <>
      {[...cacheRef.current.entries()].map(([p, element]) => (
        <div key={p} style={{ display: p === path ? 'block' : 'none' }}>
          {element}
        </div>
      ))}
      {/* If current path isn't in keep list, render it normally (not cached) */}
      {!shouldKeep && outlet}
    </>
  );
}

export default function App() {
  const { token, logout, userEmail, abilities, role } = useAuth() as any;
  const nav = useNavigate();
  const location = useLocation();

  // Track page views on route changes
  usePageTracking();

  // Normalize roles
  const roles = useMemo<string[]>(
    () =>
      (Array.isArray(role) ? role : role ? [String(role)] : []).map((r) => String(r).toLowerCase()),
    [role]
  );
  const isClient = roles.includes('client');

  // Compute employee pages if NOT a client
  const pages = useMemo(
    () => (isClient ? [] : getAccessiblePages(abilities, roles)),
    [abilities, roles, isClient]
  );

  // If a client lands on "/" or "/home", redirect to client portal
  useEffect(() => {
    if (!token) return;
    if (isClient && (location.pathname === '/' || location.pathname === '/home')) {
      nav('/client-portal', { replace: true });
    }
  }, [token, isClient, location.pathname, nav]);

  // Keep-alive list for employee tabs (home + all page paths)
  const keepAlivePaths = useMemo(() => ['/home', ...pages.map((p: any) => p.path)], [pages]);

  return (
    <div>
      {/* Hide navbar on client portal, login page, create-client page, reset password, and public room loader form */}
      {!(isClient && location.pathname.startsWith('/client-portal')) &&
        location.pathname !== '/login' &&
        location.pathname !== '/create-client' &&
        location.pathname !== '/reset-password' &&
        location.pathname !== '/request-reset' &&
        !location.pathname.startsWith('/public/room-loader') && (
        <header className="navbar">
          <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <img
              src="/final_thick_lines_cropped.jpeg"
              alt="VAYD Scout Logo"
              style={{
                height: '60px',
                width: 'auto',
                opacity: 0.9,
                mixBlendMode: 'multiply',
              }}
            />
            <span style={{
              fontFamily: "'Libre Baskerville', 'Times New Roman', serif",
              fontWeight: 400,
              fontSize: '30px',
              color: '#2c1810',
              lineHeight: '60px',
              display: 'flex',
              alignItems: 'center',
            }}>
              Scout<sup style={{ fontSize: '9px', verticalAlign: 'super', marginLeft: '2px', lineHeight: 0, position: 'relative', top: '-8px' }}>TM</sup>
            </span>
          </div>

          {/* Tabs only for employees - hidden on mobile, shown in UserMenu */}
          {token && !isClient && <AppTabs pages={pages} />}

          <div className="spacer" />
          {token && <UserMenu pages={isClient ? [] : pages} />}
        </header>
      )}

      <main
        className={isClient && location.pathname.startsWith('/client-portal') ? '' : 'container'}
      >
        <Routes>
          {/* Root redirect: client -> client-portal, else -> routing */}
          <Route
            path="/"
            element={
              token ? (
                isClient ? (
                  <Navigate to="/client-portal" replace />
                ) : (
                  <Navigate to="/routing" replace />
                )
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />

          {/* Public auth */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/create-client" element={<CreateClientUser />} />
          <Route path="/request-reset" element={<RequestReset />} />
          <Route path="/auth/request-reset" element={<Navigate to="/request-reset" replace />} />
          <Route path="/requestreset" element={<Navigate to="/request-reset" replace />} />
          <Route path="/reset-password" element={<ResetPass />} />
          <Route path="/resetpass" element={<ResetPass />} />

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
          <Route
            path="/client-portal/request-appointment"
            element={<AppointmentRequestForm />}
          />

          {/* Public room loader form (no authentication required) */}
          <Route
            path="/public/room-loader/form"
            element={<PublicRoomLoaderForm />}
          />

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
              <Route path="/home" element={<Home pages={pages} />} />
              {pages.map((p: any) => (
                <Route key={p.path} path={p.path} element={p.element} />
              ))}
            </Route>
          )}

          {/* For clients hitting /home directly, redirect to client-portal */}
          {isClient && <Route path="/home" element={<Navigate to="/client-portal" replace />} />}

          {/* Fallback - Check access and redirect appropriately */}
          <Route
            path="*"
            element={<RouteGuard />}
          />
        </Routes>
      </main>
    </div>
  );
}
