import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { useAuth } from '../auth/useAuth';
import { getVisibleScoutTabs } from '../scout-tabs';
import '../pages/ScheduleLayout.css';

const SCHED_NAV_GAP_PX = 6;
/** Reserve width for “More” summary (tab padding + label + chevron) */
const SCHED_NAV_MORE_RESERVE_PX = 96;

type SchedNavItemKey = 'home' | 'clients' | 'patients' | 'inventory' | 'tasks' | 'settings' | 'admin';

const MEASURE_LABEL: Record<SchedNavItemKey, string> = {
  home: 'Home',
  clients: 'Clients',
  patients: 'Patients',
  inventory: 'Inventory',
  tasks: 'Tasks',
  settings: 'Settings',
  admin: 'Admin',
};

function SettingsSubmenuLinks({
  onNavigate,
  settingsTabFromLocation,
}: {
  onNavigate: () => void;
  settingsTabFromLocation: string | null;
}) {
  const location = useLocation();
  return (
    <>
      <Link
        to="/schedule/settings"
        className={`schedule-app__settings-link${
          location.pathname.startsWith('/schedule/settings') &&
          (!settingsTabFromLocation || settingsTabFromLocation === 'appointment-types')
            ? ' schedule-app__settings-link--active'
            : ''
        }`}
        role="menuitem"
        onClick={onNavigate}
      >
        All settings
      </Link>
      <Link
        to={{ pathname: '/schedule/settings', search: '?tab=employee-directory' }}
        className={`schedule-app__settings-link${
          settingsTabFromLocation === 'employee-directory' ? ' schedule-app__settings-link--active' : ''
        }`}
        role="menuitem"
        onClick={onNavigate}
      >
        Employees
      </Link>
      <Link
        to={{ pathname: '/schedule/settings', search: '?tab=reminders' }}
        className={`schedule-app__settings-link${
          settingsTabFromLocation === 'reminders' ? ' schedule-app__settings-link--active' : ''
        }`}
        role="menuitem"
        onClick={onNavigate}
      >
        Reminders
      </Link>
      <Link
        to={{ pathname: '/schedule/settings', search: '?tab=employee-schedule' }}
        className={`schedule-app__settings-link${
          settingsTabFromLocation === 'employee-schedule' ? ' schedule-app__settings-link--active' : ''
        }`}
        role="menuitem"
        onClick={onNavigate}
      >
        Employee schedule
      </Link>
      <Link
        to={{ pathname: '/schedule/settings', search: '?tab=employee-zones' }}
        className={`schedule-app__settings-link${
          settingsTabFromLocation === 'employee-zones' ? ' schedule-app__settings-link--active' : ''
        }`}
        role="menuitem"
        onClick={onNavigate}
      >
        Employee zones
      </Link>
      <Link
        to={{ pathname: '/schedule/settings', search: '?tab=employee-types' }}
        className={`schedule-app__settings-link${
          settingsTabFromLocation === 'employee-types' ? ' schedule-app__settings-link--active' : ''
        }`}
        role="menuitem"
        onClick={onNavigate}
      >
        Employee appointment types
      </Link>
    </>
  );
}

export default function NavbarScheduleHorizontalNav() {
  const location = useLocation();
  const { abilities, role } = useAuth() as { abilities?: string[]; role?: string | string[] };

  const roles = useMemo(() => {
    const arr = Array.isArray(role) ? role : role ? [role] : [];
    return arr.map((r) => String(r).toLowerCase().trim()).filter(Boolean);
  }, [role]);

  const tabs = useMemo(() => getVisibleScoutTabs(abilities, roles), [abilities, roles]);
  const homeTab = useMemo(() => tabs.find((t) => t.path === 'home'), [tabs]);

  const showAdminTab = useMemo(
    () => roles.includes('admin') || roles.includes('superadmin'),
    [roles]
  );

  const itemKeys = useMemo((): SchedNavItemKey[] => {
    const keys: SchedNavItemKey[] = [];
    if (homeTab) keys.push('home');
    keys.push('clients', 'patients', 'inventory', 'tasks');
    if (showAdminTab) keys.push('settings', 'admin');
    return keys;
  }, [homeTab, showAdminTab]);

  const settingsMenuRef = useRef<HTMLDetailsElement>(null);
  const moreMenuRef = useRef<HTMLDetailsElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);

  const closeSettingsMenu = useCallback(() => {
    const el = settingsMenuRef.current;
    if (el) el.open = false;
  }, []);

  const closeMoreMenu = useCallback(() => {
    const el = moreMenuRef.current;
    if (el) el.open = false;
  }, []);

  const settingsTabFromLocation = useMemo(() => {
    if (!location.pathname.startsWith('/schedule/settings')) return null;
    return new URLSearchParams(location.search).get('tab');
  }, [location.pathname, location.search]);

  /** First index that moves into “More”; equal to itemKeys.length when everything fits on one row */
  const [splitIndex, setSplitIndex] = useState(() => Number.MAX_SAFE_INTEGER);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const measure = measureRef.current;
    if (!nav || !measure || itemKeys.length === 0) return;

    const compute = () => {
      const cells = measure.querySelectorAll<HTMLElement>('[data-sched-nav-measure]');
      const widths = Array.from(cells).map((el) => el.getBoundingClientRect().width);
      if (widths.length !== itemKeys.length) return;

      const mid = nav.parentElement;
      const avail = Math.max(1, Math.floor(mid?.clientWidth ?? nav.clientWidth));

      let best = 0;

      for (let n = itemKeys.length; n >= 0; n--) {
        let used = 0;
        for (let i = 0; i < n; i++) {
          used += (i > 0 ? SCHED_NAV_GAP_PX : 0) + widths[i]!;
        }
        const needMore = n < itemKeys.length;
        const total = used + (needMore ? SCHED_NAV_GAP_PX + SCHED_NAV_MORE_RESERVE_PX : 0);
        if (total <= avail) {
          best = n;
          break;
        }
      }

      setSplitIndex(best);
    };

    const ro = new ResizeObserver(() => {
      compute();
    });
    ro.observe(nav);
    const mid = nav.parentElement;
    if (mid) ro.observe(mid);
    compute();
    return () => ro.disconnect();
  }, [itemKeys, location.pathname]);

  if (!location.pathname.startsWith('/schedule') || tabs.length === 0) return null;

  const effectiveSplit = Math.min(splitIndex, itemKeys.length);
  const overflowKeys = itemKeys.slice(effectiveSplit);
  const inlineKeys = itemKeys.slice(0, effectiveSplit);
  const needsMore = overflowKeys.length > 0;

  const moreSummaryActive =
    (overflowKeys.includes('settings') && location.pathname.startsWith('/schedule/settings')) ||
    (overflowKeys.includes('admin') && location.pathname.startsWith('/schedule/admin'));

  const renderInlineItem = (key: SchedNavItemKey) => {
    switch (key) {
      case 'home':
        return homeTab ? (
          <NavLink
            key="home"
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
        ) : null;
      case 'clients':
        return (
          <NavLink
            key="clients"
            to="/schedule/clients"
            className={({ isActive }) => `schedule-app__tab${isActive ? ' schedule-app__tab--active' : ''}`}
          >
            Clients
          </NavLink>
        );
      case 'patients':
        return (
          <NavLink
            key="patients"
            to="/schedule/patients"
            className={({ isActive }) => `schedule-app__tab${isActive ? ' schedule-app__tab--active' : ''}`}
          >
            Patients
          </NavLink>
        );
      case 'inventory':
        return (
          <NavLink
            key="inventory"
            to="/schedule/inventory"
            className={({ isActive }) => `schedule-app__tab${isActive ? ' schedule-app__tab--active' : ''}`}
          >
            Inventory
          </NavLink>
        );
      case 'tasks':
        return (
          <NavLink
            key="tasks"
            to="/schedule/tasks"
            className={({ isActive }) => `schedule-app__tab${isActive ? ' schedule-app__tab--active' : ''}`}
          >
            Tasks
          </NavLink>
        );
      case 'settings':
        return (
          <details key="settings" ref={settingsMenuRef} className="schedule-app__settings-menu">
            <summary
              className={`schedule-app__tab schedule-app__settings-summary${
                location.pathname.startsWith('/schedule/settings') ? ' schedule-app__tab--active' : ''
              }`}
              aria-haspopup="menu"
            >
              Settings
            </summary>
            <div className="schedule-app__settings-dropdown" role="menu" aria-label="Practice settings">
              <SettingsSubmenuLinks onNavigate={closeSettingsMenu} settingsTabFromLocation={settingsTabFromLocation} />
            </div>
          </details>
        );
      case 'admin':
        return (
          <NavLink
            key="admin"
            to="/schedule/admin"
            className={({ isActive }) => `schedule-app__tab${isActive ? ' schedule-app__tab--active' : ''}`}
          >
            Admin
          </NavLink>
        );
      default:
        return null;
    }
  };

  return (
    <nav
      ref={navRef}
      className="navbar-schedule-horizontal-nav navbar-schedule-horizontal-nav--collapse"
      aria-label="Schedule sections"
    >
      <div ref={measureRef} className="navbar-schedule-nav-measure" aria-hidden>
        {itemKeys.map((key) => (
          <span key={key} data-sched-nav-measure className="schedule-app__tab">
            {MEASURE_LABEL[key]}
          </span>
        ))}
      </div>
      <div className="navbar-schedule-nav-inline">
        {inlineKeys.map((key) => renderInlineItem(key))}
        {needsMore ? (
          <details ref={moreMenuRef} className="navbar-schedule-more">
            <summary
              className={`schedule-app__tab schedule-app__settings-summary${
                moreSummaryActive ? ' schedule-app__tab--active' : ''
              }`}
              aria-haspopup="menu"
            >
              More
              <ChevronDown className="navbar-schedule-more-chevron" size={16} strokeWidth={2} aria-hidden />
            </summary>
            <div className="navbar-schedule-more-panel" role="menu" aria-label="More schedule sections">
              {overflowKeys.includes('settings') ? (
                <div className="navbar-schedule-more-section">
                  <p className="navbar-schedule-more-section-title">Settings</p>
                  <SettingsSubmenuLinks onNavigate={closeMoreMenu} settingsTabFromLocation={settingsTabFromLocation} />
                </div>
              ) : null}
              {overflowKeys.includes('admin') ? (
                <div className={overflowKeys.includes('settings') ? 'navbar-schedule-more-section' : ''}>
                  <NavLink
                    to="/schedule/admin"
                    className={({ isActive }) =>
                      `navbar-schedule-more-admin${isActive ? ' navbar-schedule-more-admin--active' : ''}`
                    }
                    role="menuitem"
                    onClick={closeMoreMenu}
                  >
                    Admin
                  </NavLink>
                </div>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
    </nav>
  );
}
