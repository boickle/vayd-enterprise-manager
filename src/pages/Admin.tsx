// src/pages/Admin.tsx
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { ADMIN_TAB_PAGES, type AdminTabPage } from '../app-pages';
import './Settings.css';

function matchesRole(required: AdminTabPage['role'], userRoles: string[]): boolean {
  if (!userRoles.length) return false;
  if (userRoles.includes('superadmin')) return true;
  if (!required) return true;
  const need = Array.isArray(required) ? required : [required];
  return need.some((r) => userRoles.includes(String(r)));
}

export default function Admin() {
  const { role } = useAuth() as { role?: string | string[] };
  const roles = Array.isArray(role) ? role : role ? [String(role)] : [];
  const normalizedRoles = roles.map((r) => String(r).toLowerCase().trim()).filter(Boolean);

  const visibleTabs = ADMIN_TAB_PAGES.filter((tab) => matchesRole(tab.role, normalizedRoles));

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
              to={`/admin/${tab.path}`}
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
