// src/pages/Admin.tsx
import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router';
import { ChevronDown } from 'lucide-react';
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

type AdminNavItem =
  | { kind: 'tab'; tab: AdminTabPage }
  | { kind: 'group'; label: string; tabs: AdminTabPage[] };

function groupAdminTabs(tabs: AdminTabPage[]): AdminNavItem[] {
  const out: AdminNavItem[] = [];
  const seenGroups = new Set<string>();
  for (const tab of tabs) {
    if (!tab.group) {
      out.push({ kind: 'tab', tab });
      continue;
    }
    if (seenGroups.has(tab.group)) continue;
    seenGroups.add(tab.group);
    out.push({
      kind: 'group',
      label: tab.group,
      tabs: tabs.filter((t) => t.group === tab.group),
    });
  }
  return out;
}

function tabIsActive(pathname: string, base: string, path: string): boolean {
  const href = `${base}/${path}`;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function AdminTabMenu({
  label,
  items,
  base,
}: {
  label: string;
  items: AdminTabPage[];
  base: string;
}) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const groupActive = items.some((item) => tabIsActive(location.pathname, base, item.path));

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="settings-tab-menu" ref={rootRef}>
      <button
        type="button"
        className={`settings-tab settings-tab-menu__trigger${groupActive ? ' active' : ''}${
          open ? ' settings-tab-menu__trigger--open' : ''
        }`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((prev) => !prev)}
      >
        {label}
        <ChevronDown size={14} aria-hidden />
      </button>
      {open ? (
        <div className="settings-tab-menu__panel" role="menu" aria-label={`${label} admin`}>
          {items.map((item) => (
            <NavLink
              key={item.path}
              to={`${base}/${item.path}`}
              role="menuitem"
              className={({ isActive }) =>
                `settings-tab-menu__item${isActive ? ' active' : ''}`
              }
              onClick={() => setOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      ) : null}
    </div>
  );
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
  const navItems = groupAdminTabs(visibleTabs);

  return (
    <div className="container">
      <div className="settings-page">
        <h1 className="settings-title">Admin</h1>
        <p className="settings-section-description" style={{ marginBottom: 24 }}>
          Manage users, view analytics, and configure settings.
        </p>
        <div className="settings-tabs">
          {navItems.map((item) =>
            item.kind === 'group' ? (
              <AdminTabMenu
                key={`group-${item.label}`}
                label={item.label}
                items={item.tabs}
                base={base}
              />
            ) : (
              <NavLink
                key={item.tab.path}
                to={`${base}/${item.tab.path}`}
                end={false}
                className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
              >
                {item.tab.label}
              </NavLink>
            )
          )}
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
