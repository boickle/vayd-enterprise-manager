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
import { getAccessiblePages } from './app-pages';
import CreateClientUser from './pages/CreateClientUser';
import ClientPortal from './pages/ClientPortal';

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
      {/* Hide navbar on client portal */}
      {!(isClient && location.pathname.startsWith('/client-portal')) && (
        <header className="navbar">
          <div className="brand">
            <img
              src="/final_thick_lines_cropped.jpeg"
              alt="VAYD Scout Logo"
              style={{ height: '40px', width: 'auto' }}
            />
            <span style={{ marginLeft: '8px', fontWeight: 600 }}>VAYD Scout</span>
          </div>

          {/* Tabs only for employees */}
          {token ? (
            !isClient && <AppTabs pages={pages} />
          ) : (
            <nav className="row" style={{ gap: 16 }}>
              <NavLink to="/login">Login</NavLink>
            </nav>
          )}

          <div className="spacer" />
          {token ? (
            <div className="row">
              <span className="muted">{userEmail ? `Signed in as ${userEmail}` : 'Signed in'}</span>
              <button
                className="btn secondary"
                onClick={() => {
                  logout();
                  nav('/login');
                }}
              >
                Log out
              </button>
            </div>
          ) : (
            <NavLink to="/login" className="btn">
              Log in
            </NavLink>
          )}
        </header>
      )}

      <main
        className={isClient && location.pathname.startsWith('/client-portal') ? '' : 'container'}
      >
        <Routes>
          {/* Root redirect: client -> client-portal, else -> home */}
          <Route
            path="/"
            element={
              token ? (
                isClient ? (
                  <Navigate to="/client-portal" replace />
                ) : (
                  <Navigate to="/home" replace />
                )
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />

          {/* Public auth */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/create-client" element={<CreateClientUser />} />
          <Route path="/requestreset" element={<RequestReset />} />
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

          {/* Fallback */}
          <Route
            path="*"
            element={
              <div className="container">
                <p>Not found</p>
              </div>
            }
          />
        </Routes>
      </main>
    </div>
  );
}
