// src/pages/Admin.tsx
import { NavLink, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { getAdminTabPages, type AdminTabPage } from '../admin-tabs';
import './Settings.css';

function matchesRole(required: AdminTabPage['role'], userRoles: string[]): boolean {
  if (!userRoles.length) return false;
  if (userRoles.includes('superadmin')) return true;
  if (!required) return true;
  const need = Array.isArray(required) ? required : [required];
  return need.some((r) => userRoles.includes(String(r)));
}

type AdminProps = {
  /** Tab links and routing base, e.g. `/admin` or `/schedule/admin`. */
  basePath?: string;
};

export default function Admin({ basePath = '/admin' }: AdminProps) {
  const { role } = useAuth() as { role?: string | string[] };
  const roles = Array.isArray(role) ? role : role ? [String(role)] : [];
  const normalizedRoles = roles.map((r) => String(r).toLowerCase().trim()).filter(Boolean);

  const canAccessAdmin =
    normalizedRoles.includes('admin') || normalizedRoles.includes('superadmin');
  if (!canAccessAdmin) {
    return <Navigate to="/schedule/home" replace />;
  }

  const base = basePath.replace(/\/$/, '');
  const visibleTabs = getAdminTabPages().filter((tab) => matchesRole(tab.role, normalizedRoles));

  return (
    <div className="container">
      <div className="settings-page">
        <h1 className="settings-title">Admin</h1>
        <p className="settings-section-description" style={{ marginBottom: 24 }}>
          Manage users, view analytics, and configure settings.
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
          <p className="settings-muted">You don&apos;t have access to any admin pages.</p>
        ) : (
          <Outlet />
        )}
      </div>
    </div>
  );
}
