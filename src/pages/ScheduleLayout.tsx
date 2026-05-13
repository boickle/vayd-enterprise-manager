import { NavLink, Outlet, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import {
  getVisibleScoutTabs,
  getFirstScoutSegment,
  SCHEDULE_OUTLET_EXTRA_SEGMENTS,
  SHOW_MY_WEEK_SCOUT_TAB,
  scoutTabPermissionOk,
} from '../scout-tabs';
import { listTasks } from '../api/tasks';
import ScheduleTasksPanel from '../components/schedule/ScheduleTasksPanel';
import './ScheduleLayout.css';

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

type QueueRow = { label: string; count: number; to?: string; title?: string };

const WORK_QUEUE_ROWS: QueueRow[] = [
  { label: 'Refill Requests', count: 4, title: 'Coming soon' },
  { label: 'Pending SOAPs', count: 3, title: 'Coming soon' },
  { label: 'Pending Checkout', count: 2, title: 'Coming soon' },
  { label: 'Lab Reviews', count: 1, title: 'Coming soon' },
  { label: 'Pending Count Reviews', count: 2, title: 'Coming soon' },
  { label: 'Expiring Inventory', count: 4, to: '/schedule/inventory' },
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

  const showAdminTab = useMemo(
    () => roles.includes('admin') || roles.includes('superadmin'),
    [roles]
  );

  const [tasksDrawerOpen, setTasksDrawerOpen] = useState(false);
  const [taskTotal, setTaskTotal] = useState<number | null>(null);
  const [taskRefresh, setTaskRefresh] = useState(0);

  const refreshTaskCount = useCallback(() => {
    void listTasks({ includeDone: false, limit: 1, offset: 0 })
      .then((res) => setTaskTotal(res.total))
      .catch(() => setTaskTotal(null));
  }, []);

  useEffect(() => {
    refreshTaskCount();
  }, [refreshTaskCount, location.pathname]);

  useEffect(() => {
    if (!tasksDrawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTasksDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tasksDrawerOpen]);

  const openTasksDrawer = useCallback(() => {
    setTaskRefresh((k) => k + 1);
    refreshTaskCount();
    setTasksDrawerOpen(true);
  }, [refreshTaskCount]);

  const appointmentHref = useMemo(
    () => (scoutTabPermissionOk('canSeeRouting', abilities) ? '/schedule/routing' : '/schedule/home'),
    [abilities]
  );

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

  const outletFlush = useMemo(
    () =>
      location.pathname === '/schedule/home' ||
      location.pathname === '/schedule/scheduler' ||
      location.pathname.startsWith('/schedule/scheduler/'),
    [location.pathname]
  );

  if (tabs.length === 0) {
    return <Navigate to="/tools" replace />;
  }

  return (
    <div className="schedule-app">
      <aside className="schedule-app__rail" aria-label="Quick actions and work queues">
        <h2 className="schedule-app__rail-title">Quick actions</h2>
        <nav className="schedule-app__quick" aria-label="Quick actions">
          <NavLink to={appointmentHref} className="schedule-app__quick-link schedule-app__quick-link--primary">
            + Appointment
          </NavLink>
          <NavLink to="/schedule/clients" className="schedule-app__quick-link">
            New Client
          </NavLink>
          <NavLink to="/schedule/room-loader" className="schedule-app__quick-link">
            Send Room Loader
          </NavLink>
          <NavLink to="/schedule/inventory" className="schedule-app__quick-link">
            Restock Location
          </NavLink>
          <NavLink to="/schedule/tasks" className="schedule-app__quick-link">
            New Task
          </NavLink>
        </nav>

        {schedulingTabs.length > 0 ? (
          <>
            <h2 className="schedule-app__rail-title schedule-app__rail-title--second">Scheduling</h2>
            <nav className="schedule-app__quick schedule-app__quick--sub" aria-label="Scheduling tools">
              {schedulingTabs.map((tab) => (
                <NavLink key={tab.path} to={`/schedule/${tab.path}`} className="schedule-app__quick-link schedule-app__quick-link--sub">
                  {tab.label}
                </NavLink>
              ))}
              {!SHOW_MY_WEEK_SCOUT_TAB && scoutTabPermissionOk('canSeeDoctorDay', abilities) ? (
                <NavLink to="/schedule/scheduler" className="schedule-app__quick-link schedule-app__quick-link--sub">
                  Practice calendar
                </NavLink>
              ) : null}
            </nav>
          </>
        ) : null}

        <div className="schedule-app__rail-divider" role="presentation" />

        <h2 className="schedule-app__rail-title">Work queues</h2>
        <ul className="schedule-app__queues">
          {WORK_QUEUE_ROWS.map((row) => (
            <li key={row.label}>
              {row.to ? (
                <NavLink to={row.to} className="schedule-app__queue-link">
                  <span>{row.label}</span>
                  <span className="schedule-app__queue-count">({row.count})</span>
                </NavLink>
              ) : (
                <span className="schedule-app__queue-muted" title={row.title}>
                  <span>{row.label}</span>
                  <span className="schedule-app__queue-count">({row.count})</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      </aside>

      <div className="schedule-app__main">
        <nav className="schedule-app__tabs" aria-label="Schedule sections">
          <div className="schedule-app__tabs-start">
            {homeTab ? (
              <NavLink
                to={`/schedule/${homeTab.path}`}
                end
                className={({ isActive }) => {
                  const active =
                    isActive ||
                    location.pathname === '/schedule/scheduler' ||
                    location.pathname.startsWith('/schedule/scheduler/');
                  return `schedule-app__tab${active ? ' schedule-app__tab--active' : ''}`;
                }}
              >
                Home
              </NavLink>
            ) : null}
            <NavLink
              to="/schedule/clients"
              className={({ isActive }) => `schedule-app__tab${isActive ? ' schedule-app__tab--active' : ''}`}
            >
              Clients
            </NavLink>
            <NavLink
              to="/schedule/patients"
              className={({ isActive }) => `schedule-app__tab${isActive ? ' schedule-app__tab--active' : ''}`}
            >
              Patients
            </NavLink>
            <NavLink
              to="/schedule/inventory"
              className={({ isActive }) => `schedule-app__tab${isActive ? ' schedule-app__tab--active' : ''}`}
            >
              Inventory
            </NavLink>
            <NavLink
              to="/schedule/tasks"
              className={({ isActive }) => `schedule-app__tab${isActive ? ' schedule-app__tab--active' : ''}`}
            >
              Tasks
            </NavLink>
            {showAdminTab ? (
              <NavLink
                to="/schedule/admin"
                className={({ isActive }) => `schedule-app__tab${isActive ? ' schedule-app__tab--active' : ''}`}
              >
                Admin
              </NavLink>
            ) : null}
          </div>
          <div className="schedule-app__tabs-end">
            <button type="button" className="schedule-app__tasks-chip" onClick={openTasksDrawer}>
              Tasks{taskTotal != null ? ` (${taskTotal})` : ''}
            </button>
          </div>
        </nav>
        <div className={`schedule-app__outlet${outletFlush ? ' schedule-app__outlet--flush' : ''}`}>
          <Outlet context={{ schedulingToolsLinkPrefix: '/schedule/scheduling-tools' }} />
        </div>
      </div>

      {tasksDrawerOpen ? (
        <div className="schedule-tasks-drawer-root" role="presentation">
          <button
            type="button"
            className="schedule-tasks-drawer-backdrop"
            aria-label="Close tasks panel"
            onClick={() => setTasksDrawerOpen(false)}
          />
          <aside className="schedule-tasks-drawer" role="dialog" aria-modal="true" aria-labelledby="schedule-tasks-drawer-title">
            <div className="schedule-tasks-drawer-head">
              <h2 id="schedule-tasks-drawer-title" className="schedule-tasks-drawer-title">
                Tasks
              </h2>
              <button type="button" className="schedule-tasks-drawer-close" onClick={() => setTasksDrawerOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="schedule-tasks-drawer-body">
              <ScheduleTasksPanel refreshKey={taskRefresh} className="schedule-tasks-panel--drawer" />
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
