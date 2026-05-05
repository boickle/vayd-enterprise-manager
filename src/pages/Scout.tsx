import { NavLink, Outlet, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import { useAuth } from '../auth/useAuth';
import { getVisibleScoutTabs, getFirstScoutSegment } from '../scout-tabs';
import './Settings.css';

/** Default child under `/scout` — first tab the user may access. */
export function ScoutIndexRedirect() {
  const { abilities, role } = useAuth() as { abilities?: string[]; role?: string | string[] };
  const roles = useMemo(() => {
    if (!role) return [];
    const arr = Array.isArray(role) ? role : [role];
    return arr.map((r) => String(r).toLowerCase().trim()).filter(Boolean);
  }, [role]);
  const seg = getFirstScoutSegment(abilities, roles);
  return <Navigate to={`/scout/${seg}`} replace />;
}

export default function Scout() {
  const { abilities, role } = useAuth() as { abilities?: string[]; role?: string | string[] };
  const location = useLocation();
  const navigate = useNavigate();

  const roles = useMemo(() => {
    if (!role) return [];
    const arr = Array.isArray(role) ? role : [role];
    return arr.map((r) => String(r).toLowerCase().trim()).filter(Boolean);
  }, [role]);

  const tabs = useMemo(() => getVisibleScoutTabs(abilities, roles), [abilities, roles]);

  useEffect(() => {
    if (tabs.length === 0) return;
    const prefix = '/scout/';
    if (!location.pathname.startsWith(prefix)) return;
    const rest = location.pathname.slice(prefix.length);
    const segment = rest.split('/')[0];
    const allowed = new Set(tabs.map((t) => t.path));
    if (segment && !allowed.has(segment)) {
      navigate(`/scout/${getFirstScoutSegment(abilities, roles)}`, { replace: true });
    }
  }, [tabs, location.pathname, navigate, abilities, roles]);

  if (tabs.length === 0) {
    return <Navigate to="/tools" replace />;
  }

  return (
    <div className="container">
      <div className="settings-page">
        <h1 className="settings-title">Scout</h1>
        <p className="settings-section-description" style={{ marginBottom: 24 }}>
          Routing, schedules, room loader, and day-to-day tools in one place.
        </p>
        <div className="settings-tabs">
          {tabs.map((tab) => (
            <NavLink
              key={tab.path}
              to={`/scout/${tab.path}`}
              className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
            >
              {tab.label}
            </NavLink>
          ))}
        </div>
        <Outlet context={{ schedulingToolsLinkPrefix: '/scout/scheduling-tools' }} />
      </div>
    </div>
  );
}
