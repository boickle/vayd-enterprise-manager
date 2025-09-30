// src/App.tsx
import { NavLink, Route, Routes, useNavigate, Navigate, useLocation } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
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

export default function App() {
  const { token, logout, userEmail, abilities, role } = useAuth() as any;
  const nav = useNavigate();
  const location = useLocation();

  // ✅ Normalize roles (case-insensitive)
  const roles = useMemo<string[]>(
    () =>
      (Array.isArray(role) ? role : role ? [String(role)] : []).map((r) => String(r).toLowerCase()),
    [role]
  );
  const isClient = roles.includes('client');

  // ✅ Only compute employee pages if NOT a client
  const pages = useMemo(
    () => (isClient ? [] : getAccessiblePages(abilities, roles)),
    [abilities, roles, isClient]
  );

  // ✅ Side-effect safety: if a client ever lands on "/" or "/home", go to client portal
  useEffect(() => {
    if (!token) return;
    if (isClient && (location.pathname === '/' || location.pathname === '/home')) {
      nav('/client-portal', { replace: true });
    }
  }, [token, isClient, location.pathname, nav]);

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
          {/* ✅ Root redirect: client -> client-portal, else -> home */}
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
              <ProtectedRoute allowRoles={['client']} redirectTo="/login">
                <ClientPortal />
              </ProtectedRoute>
            }
          />

          {/* ✅ Always register /home, but make clients redirect away */}
          <Route
            path="/home"
            element={
              isClient ? (
                <Navigate to="/client-portal" replace />
              ) : (
                <ProtectedRoute>
                  <Home pages={pages} />
                </ProtectedRoute>
              )
            }
          />

          {/* Employee-only pages (not registered for clients) */}
          {!isClient &&
            pages.map((p) => (
              <Route
                key={p.path}
                path={p.path}
                element={<ProtectedRoute>{p.element}</ProtectedRoute>}
              />
            ))}

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
