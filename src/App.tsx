// src/App.tsx
import { NavLink, Route, Routes, useNavigate, Navigate } from 'react-router-dom';
import LoginPage from './pages/Login';
import CreateUser from './pages/CreateUser';
import RequestReset from './pages/RequestReset';
import ResetPass from './pages/ResetPass';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { useAuth } from './auth/useAuth';
import Home from './pages/Home';
import AppTabs from './components/AppTabs';
import { getAccessiblePages } from './app-pages';

export default function App() {
  const { token, logout, userEmail, abilities } = useAuth() as any; // abilities optional
  const nav = useNavigate();

  // Pages the current user can see (fallback built-in if abilities undefined)
  const pages = getAccessiblePages(abilities);

  return (
    <div>
      <header className="navbar">
        <div className="brand">🐾 VAYD Scout</div>
        {/* Show tabs only when signed in */}
        {token ? (
          <AppTabs pages={pages} />
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

      <main className="container">
        <Routes>
          {/* Root: go to home if authenticated */}
          <Route
            path="/"
            element={token ? <Navigate to="/home" replace /> : <Navigate to="/login" replace />}
          />

          {/* Public auth routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/create" element={<CreateUser />} />
          <Route path="/requestreset" element={<RequestReset />} />
          <Route path="/resetpass" element={<ResetPass />} />

          {/* Home hub (tabs visible above) */}
          <Route
            path="/home"
            element={
              <ProtectedRoute>
                <Home pages={pages} />
              </ProtectedRoute>
            }
          />

          {/* Protected pages (generated from config for convenience) */}
          {pages.map((p) => (
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
