import { NavLink, Outlet, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useAuth } from '../auth/useAuth';
import {
  getVisibleScoutTabs,
  getFirstScoutSegment,
  SCHEDULE_OUTLET_EXTRA_SEGMENTS,
  SHOW_MY_WEEK_SCOUT_TAB,
  scoutTabPermissionOk,
  type ScoutTabConfig,
} from '../scout-tabs';
import './ScheduleLayout.css';

function pathUnderScheduleTab(pathname: string, tabPath: string): boolean {
  const base = `/schedule/${tabPath}`;
  return pathname === base || pathname.startsWith(`${base}/`);
}

function isUnderSchedulingTabs(pathname: string, tabs: ScoutTabConfig[]): boolean {
  return tabs.some((t) => pathUnderScheduleTab(pathname, t.path));
}

/** Default child under `/schedule`. */
export function ScheduleIndexRedirect() {
  const { abilities, role } = useAuth() as { abilities?: string[]; role?: string | string[] };
  const roles = useMemo(() => {
    if (!role) return [];
    const arr = Array.isArray(role) ? role : [role];
    return arr.map((r) => String(r).toLowerCase().trim()).filter(Boolean);
  }, [role]);
  const seg = getFirstScoutSegment(abilities, roles);
  return <Navigate to={`/schedule/${seg}`} replace />;
}

const QUICK_ACTIONS: { label: string; to: string }[] = [
  { label: 'Appointments', to: '/schedule/routing' },
  { label: 'Send room loader', to: '/schedule/room-loader' },
  { label: 'New client', to: '/schedule/clients' },
  { label: 'Search inventory', to: '/schedule/inventory' },
  { label: 'Restock location', to: '/schedule/inventory' },
  { label: 'Receive shipment', to: '/schedule/inventory' },
  { label: 'New task', to: '/schedule/tasks' },
];

export default function ScheduleLayout() {
  const { abilities, role } = useAuth() as { abilities?: string[]; role?: string | string[] };
  const location = useLocation();
  const navigate = useNavigate();

  const roles = useMemo(() => {
    if (!role) return [];
    const arr = Array.isArray(role) ? role : [role];
    return arr.map((r) => String(r).toLowerCase().trim()).filter(Boolean);
  }, [role]);

  const tabs = useMemo(() => getVisibleScoutTabs(abilities, roles), [abilities, roles]);
  const homeTab = useMemo(() => tabs.find((t) => t.path === 'home'), [tabs]);
  const schedulingTabs = useMemo(() => tabs.filter((t) => t.path !== 'home'), [tabs]);

  /** Scheduling dropdown rows; when the legacy My Week tab is hidden, insert "My week" → practice calendar after My Day. */
  const schedulingMenuRows = useMemo(() => {
    const rows: { key: string; label: string; to: string }[] = [];
    const showMyWeekCalendarLink =
      !SHOW_MY_WEEK_SCOUT_TAB && scoutTabPermissionOk('canSeeDoctorDay', abilities);
    for (const tab of schedulingTabs) {
      rows.push({ key: tab.path, label: tab.label, to: `/schedule/${tab.path}` });
      if (tab.path === 'my-day' && showMyWeekCalendarLink) {
        rows.push({ key: 'my-week-practice-calendar', label: 'My week', to: '/schedule/scheduler' });
      }
    }
    return rows;
  }, [schedulingTabs, abilities]);

  const [schedulingOpen, setSchedulingOpen] = useState(false);
  const schedulingWrapRef = useRef<HTMLDivElement>(null);

  const schedulingSectionActive = useMemo(
    () =>
      isUnderSchedulingTabs(location.pathname, schedulingTabs) ||
      location.pathname === '/schedule/scheduler' ||
      location.pathname.startsWith('/schedule/scheduler/'),
    [location.pathname, schedulingTabs]
  );

  const showAdminTab = useMemo(
    () => roles.includes('admin') || roles.includes('superadmin'),
    [roles]
  );

  useEffect(() => {
    setSchedulingOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!schedulingOpen) return;
    const close = (e: MouseEvent) => {
      const el = schedulingWrapRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) setSchedulingOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSchedulingOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [schedulingOpen]);

  const toggleScheduling = useCallback(() => {
    setSchedulingOpen((o) => !o);
  }, []);

  useEffect(() => {
    if (tabs.length === 0) return;
    const prefix = '/schedule/';
    if (!location.pathname.startsWith(prefix)) return;
    const rest = location.pathname.slice(prefix.length);
    const segment = rest.split('/')[0];
    const allowed = new Set([...tabs.map((t) => t.path), ...SCHEDULE_OUTLET_EXTRA_SEGMENTS]);
    if (segment && !allowed.has(segment)) {
      navigate(`/schedule/${getFirstScoutSegment(abilities, roles)}`, { replace: true });
    }
  }, [tabs, location.pathname, navigate, abilities, roles]);

  if (tabs.length === 0) {
    return <Navigate to="/tools" replace />;
  }

  return (
    <div className="schedule-app">
      <aside className="schedule-app__rail" aria-label="Quick actions">
        <h2 className="schedule-app__rail-title">Quick actions</h2>
        <nav className="schedule-app__quick">
          {QUICK_ACTIONS.map((a) => (
            <NavLink key={a.to + a.label} to={a.to} className="schedule-app__quick-link">
              {a.label}
            </NavLink>
          ))}
        </nav>
        <h2 className="schedule-app__rail-title schedule-app__rail-title--second">Needs attention</h2>
        <ul className="schedule-app__attention">
          <li>
            <NavLink to="/schedule/inventory">Inventory / stock</NavLink>
          </li>
          <li>
            <span className="schedule-app__attention-muted">Low stock / expiring counts — coming soon</span>
          </li>
          <li>
            <span className="schedule-app__attention-muted">Pending count reconciliations — coming soon</span>
          </li>
        </ul>
      </aside>

      <div className="schedule-app__main">
        <nav className="schedule-app__tabs" aria-label="Schedule sections">
          {homeTab && (
            <NavLink
              key={homeTab.path}
              to={`/schedule/${homeTab.path}`}
              end
              className={({ isActive }) => `schedule-app__tab${isActive ? ' schedule-app__tab--active' : ''}`}
            >
              {homeTab.label}
            </NavLink>
          )}
          {schedulingTabs.length > 0 && (
            <div className="schedule-app__scheduling-wrap" ref={schedulingWrapRef}>
              <button
                type="button"
                className={`schedule-app__tab schedule-app__tab--scheduling-trigger${schedulingSectionActive ? ' schedule-app__tab--active' : ''}${schedulingOpen ? ' schedule-app__tab--scheduling-open' : ''}`}
                aria-expanded={schedulingOpen}
                aria-haspopup="menu"
                aria-controls="schedule-scheduling-menu"
                id="schedule-scheduling-trigger"
                onClick={toggleScheduling}
              >
                Scheduling
                <ChevronDown size={16} strokeWidth={2} className="schedule-app__scheduling-chevron" aria-hidden />
              </button>
              {schedulingOpen && (
                <div
                  id="schedule-scheduling-menu"
                  className="schedule-app__scheduling-menu"
                  role="menu"
                  aria-labelledby="schedule-scheduling-trigger"
                >
                  {schedulingMenuRows.map((row) => (
                    <NavLink
                      key={row.key}
                      role="menuitem"
                      to={row.to}
                      className={({ isActive }) =>
                        `schedule-app__scheduling-item${isActive ? ' schedule-app__scheduling-item--active' : ''}`
                      }
                      onClick={() => setSchedulingOpen(false)}
                    >
                      {row.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )}
          <NavLink
            to="/schedule/clients"
            className={({ isActive }) =>
              `schedule-app__tab${isActive ? ' schedule-app__tab--active' : ''}`
            }
          >
            Clients
          </NavLink>
          <NavLink
            to="/schedule/patients"
            className={({ isActive }) =>
              `schedule-app__tab${isActive ? ' schedule-app__tab--active' : ''}`
            }
          >
            Patients
          </NavLink>
          <NavLink
            to="/schedule/inventory"
            className={({ isActive }) =>
              `schedule-app__tab${isActive ? ' schedule-app__tab--active' : ''}`
            }
          >
            Inventory
          </NavLink>
          {showAdminTab && (
            <NavLink
              to="/schedule/admin"
              className={({ isActive }) =>
                `schedule-app__tab${isActive ? ' schedule-app__tab--active' : ''}`
              }
            >
              Admin
            </NavLink>
          )}
        </nav>
        <div className="schedule-app__outlet">
          <Outlet context={{ schedulingToolsLinkPrefix: '/schedule/scheduling-tools' }} />
        </div>
      </div>
    </div>
  );
}
