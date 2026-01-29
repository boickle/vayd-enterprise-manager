// src/pages/Admin.tsx
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import './Settings.css';

type AdminLink = { path: string; label: string; role: string | string[] };

const ADMIN_LINKS: AdminLink[] = [
  { path: '/settings', label: 'Settings', role: ['admin', 'superadmin'] },
  { path: '/survey/results', label: 'Survey Results', role: ['admin', 'superadmin'] },
  { path: '/users/create', label: 'Create User', role: 'superadmin' },
  { path: '/analytics/payments', label: 'Payments Analytics', role: ['admin', 'superadmin'] },
  { path: '/analytics/ops', label: 'Ops Analytics', role: 'admin' },
  { path: '/analytics/revenue/doctor', label: 'Doctor Revenue Analytics', role: 'admin' },
  { path: '/audit', label: 'Super Admin Audit', role: 'superadmin' },
  { path: '/simulation', label: 'Simulate Routing', role: 'superadmin' },
];

function matchesRole(required: string | string[], userRoles: string[]): boolean {
  if (!userRoles.length) return false;
  if (userRoles.includes('superadmin')) return true;
  const need = Array.isArray(required) ? required : [required];
  return need.some((r) => userRoles.includes(String(r)));
}

export default function Admin() {
  const { role } = useAuth() as { role?: string | string[] };
  const roles = Array.isArray(role) ? role : role ? [String(role)] : [];
  const normalizedRoles = roles.map((r) => String(r).toLowerCase().trim()).filter(Boolean);

  const visibleLinks = ADMIN_LINKS.filter((link) => matchesRole(link.role, normalizedRoles));

  return (
    <div className="container">
      <h1 className="settings-title">Admin</h1>
      <p className="settings-section-description" style={{ marginBottom: 24 }}>
        Manage users, view analytics, and run admin tools.
      </p>
      <div className="admin-links">
        {visibleLinks.map((link) => (
          <Link key={link.path} to={link.path} className="admin-link">
            {link.label}
          </Link>
        ))}
      </div>
      {visibleLinks.length === 0 && (
        <p className="settings-muted">You don’t have access to any admin pages.</p>
      )}
    </div>
  );
}
