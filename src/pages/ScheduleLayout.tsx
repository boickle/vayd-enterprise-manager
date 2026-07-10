import { NavLink, Outlet, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  CalendarPlus,
  CalendarClock,
  ClipboardPlus,
  DoorOpen,
  FlaskConical,
  LineChart,
  ListChecks,
  Mail,
  Package,
  PackageSearch,
  PanelLeft,
  PanelLeftClose,
  Pill,
  Send,
  ShoppingCart,
  Calculator,
  UserPlus,
} from 'lucide-react';
import { useAuth } from '../auth/useAuth';
import {
  getVisibleScoutTabs,
  getFirstScoutSegment,
  SCHEDULE_OUTLET_EXTRA_SEGMENTS,
  scoutTabPermissionOk,
} from '../scout-tabs';
import { isAnalyticsAdmin, isEmployeeAnalyticsRestricted } from '../utils/analyticsAccess';
import {
  useRoutingCalendarPreviewActive,
  useRoutingCalendarPreviewNavigationGuard,
} from '../utils/routingCalendarPreviewGuard';
import {
  FORWARD_BOOKING_NAVIGATION_BLOCKED_MESSAGE,
  FORWARD_BOOKING_ROUTE_PATH,
  hasActiveForwardBookingWorkspaceLock,
  useForwardBookingWorkspaceLockActive,
  useForwardBookingWorkspaceNavigationGuard,
} from '../utils/forwardBookingWorkspaceGuard';
import { markSchedulerHandoffPreferRoutingDoctor } from '../utils/schedulerCalendarHandoff';
import { evetCreateClientLink } from '../utils/evet';
import { useGmailInboxAccess } from '../hooks/useGmailInboxAccess';
import './ScheduleLayout.css';

const SCHEDULE_RAIL_COLLAPSED_KEY = 'vayd-schedule-rail-collapsed';

/** Sidebar quick actions / queues hidden until flows are ready. */
const SHOW_RAIL_RESTOCK_LOCATION = false;
const SHOW_RAIL_WORK_QUEUES = false;

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

type QueueRow = {
  label: string;
  count: number;
  to?: string;
  title?: string;
  icon: LucideIcon;
};

const WORK_QUEUE_ROWS: QueueRow[] = [
  { label: 'Refill Requests', count: 4, title: 'Coming soon', icon: Pill },
  { label: 'Pending SOAPs', count: 3, title: 'Coming soon', icon: ListChecks },
  { label: 'Pending Checkout', count: 2, title: 'Coming soon', icon: ShoppingCart },
  { label: 'Lab Reviews', count: 1, title: 'Coming soon', icon: FlaskConical },
  { label: 'Pending Count Reviews', count: 2, title: 'Coming soon', icon: Calculator },
  { label: 'Expiring Inventory', count: 4, to: '/schedule/inventory', icon: PackageSearch },
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

  const canAccessScheduleAnalytics = useMemo(
    () => isAnalyticsAdmin(roles) || isEmployeeAnalyticsRestricted(roles),
    [roles],
  );

  const { allowed: canAccessGmailInbox } = useGmailInboxAccess();

  const [railWideEnough, setRailWideEnough] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 901px)').matches : true
  );
  const [railCollapsed, setRailCollapsed] = useState(() => {
    try {
      return typeof window !== 'undefined' && localStorage.getItem(SCHEDULE_RAIL_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  const routingCalendarPreviewActive = useRoutingCalendarPreviewActive();
  useRoutingCalendarPreviewNavigationGuard(routingCalendarPreviewActive);

  const forwardBookingWorkspaceLockActive = useForwardBookingWorkspaceLockActive();
  useForwardBookingWorkspaceNavigationGuard(forwardBookingWorkspaceLockActive);

  useEffect(() => {
    if (!hasActiveForwardBookingWorkspaceLock()) return;
    if (!location.pathname.startsWith('/schedule')) return;
    if (location.pathname === FORWARD_BOOKING_ROUTE_PATH) return;
    window.alert(FORWARD_BOOKING_NAVIGATION_BLOCKED_MESSAGE);
    navigate(FORWARD_BOOKING_ROUTE_PATH, { replace: true });
  }, [location.pathname, navigate]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 901px)');
    const onChange = () => setRailWideEnough(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SCHEDULE_RAIL_COLLAPSED_KEY, railCollapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [railCollapsed]);

  const railCollapsedEffective = railCollapsed && railWideEnough;

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
      location.pathname === '/schedule/email' ||
      location.pathname === '/schedule/scheduler' ||
      location.pathname.startsWith('/schedule/scheduler/') ||
      location.pathname === '/schedule/routing',
    [location.pathname]
  );

  /** Practice calendar (and home) can grow vertically; scroll inside outlet so toolbar/date chrome scrolls away. Routing split stays overflow-hidden. */
  const outletFlushVerticallyScrollable = useMemo(
    () => outletFlush && !location.pathname.startsWith('/schedule/routing'),
    [outletFlush, location.pathname]
  );

  /** Lets practice week/day `position: sticky` stick to the outlet (see ScheduleLayout.css). */
  const scheduleMainStickyCalendarChain = useMemo(
    () =>
      location.pathname === '/schedule/scheduler' || location.pathname.startsWith('/schedule/scheduler/'),
    [location.pathname]
  );

  /** Practice calendar on mobile: hide the quick-actions rail so the grid gets vertical space. */
  const scheduleAppMobileCompact = scheduleMainStickyCalendarChain;

  useEffect(() => {
    if (location.pathname === '/schedule/routing' && railWideEnough) {
      setRailCollapsed(true);
    }
  }, [location.pathname, railWideEnough]);

  if (tabs.length === 0) {
    return <Navigate to="/tools" replace />;
  }

  return (
    <div
      className={[
        'schedule-app',
        scheduleAppMobileCompact ? 'schedule-app--scheduler-mobile-compact' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <aside
        className={`schedule-app__rail${railCollapsedEffective ? ' schedule-app__rail--collapsed' : ''}`}
        aria-label="Quick actions and work queues"
      >
        {railWideEnough ? (
          <button
            type="button"
            className="schedule-app__rail-toggle"
            onClick={() => setRailCollapsed((c) => !c)}
            aria-expanded={!railCollapsedEffective}
            aria-controls="schedule-app-rail-nav"
            aria-label={railCollapsedEffective ? 'Expand quick actions sidebar' : 'Collapse quick actions sidebar'}
          >
            {railCollapsedEffective ? (
              <PanelLeft size={20} strokeWidth={1.75} aria-hidden />
            ) : (
              <PanelLeftClose size={20} strokeWidth={1.75} aria-hidden />
            )}
          </button>
        ) : null}

        <div id="schedule-app-rail-nav" className="schedule-app__rail-scroll">
          <h2 className="schedule-app__rail-title">Quick actions</h2>
          <nav className="schedule-app__quick" aria-label="Quick actions">
            <NavLink
              to={appointmentHref}
              className="schedule-app__quick-link schedule-app__quick-link--primary"
              title={railCollapsedEffective ? 'New appointment' : undefined}
              onClick={(e) => {
                if (forwardBookingWorkspaceLockActive) {
                  e.preventDefault();
                  window.alert(FORWARD_BOOKING_NAVIGATION_BLOCKED_MESSAGE);
                  return;
                }
                markSchedulerHandoffPreferRoutingDoctor();
              }}
            >
              <span className="schedule-app__quick-link-icon" aria-hidden>
                <CalendarPlus size={18} strokeWidth={1.75} />
              </span>
              <span className="schedule-app__quick-link-label">+ Appointment</span>
            </NavLink>
            <a
              href={evetCreateClientLink()}
              target="_blank"
              rel="noopener noreferrer"
              className="schedule-app__quick-link"
              title={railCollapsedEffective ? 'New Client' : undefined}
            >
              <span className="schedule-app__quick-link-icon" aria-hidden>
                <UserPlus size={18} strokeWidth={1.75} />
              </span>
              <span className="schedule-app__quick-link-label">+ New Client</span>
            </a>
            <NavLink
              to="/schedule/room-loader"
              className="schedule-app__quick-link"
              title={railCollapsedEffective ? 'Send Room Loader' : undefined}
            >
              <span className="schedule-app__quick-link-icon" aria-hidden>
                <Send size={18} strokeWidth={1.75} />
              </span>
              <span className="schedule-app__quick-link-label">Send Room Loader</span>
            </NavLink>
            {SHOW_RAIL_RESTOCK_LOCATION ? (
              <NavLink
                to="/schedule/inventory"
                className="schedule-app__quick-link"
                title={railCollapsedEffective ? 'Restock Location' : undefined}
              >
                <span className="schedule-app__quick-link-icon" aria-hidden>
                  <Package size={18} strokeWidth={1.75} />
                </span>
                <span className="schedule-app__quick-link-label">Restock Location</span>
              </NavLink>
            ) : null}
            <NavLink
              to={{ pathname: '/schedule/tasks', search: '?new=1' }}
              className="schedule-app__quick-link"
              title={railCollapsedEffective ? 'New Task' : undefined}
            >
              <span className="schedule-app__quick-link-icon" aria-hidden>
                <ClipboardPlus size={18} strokeWidth={1.75} />
              </span>
              <span className="schedule-app__quick-link-label">New Task</span>
            </NavLink>
            <NavLink
              to={{ pathname: '/schedule/scheduling-tools/forward-booking', search: '?new=1' }}
              className="schedule-app__quick-link"
              title={railCollapsedEffective ? 'Forward booking' : undefined}
            >
              <span className="schedule-app__quick-link-icon" aria-hidden>
                <CalendarClock size={18} strokeWidth={1.75} />
              </span>
              <span className="schedule-app__quick-link-label">+ Forward Booking</span>
            </NavLink>
            {canAccessScheduleAnalytics ? (
              <NavLink
                to="/schedule/analytics"
                className={({ isActive }) =>
                  `schedule-app__quick-link${isActive ? ' schedule-app__quick-link--active' : ''}`
                }
                title={railCollapsedEffective ? 'Analytics' : undefined}
              >
                <span className="schedule-app__quick-link-icon" aria-hidden>
                  <LineChart size={18} strokeWidth={1.75} />
                </span>
                <span className="schedule-app__quick-link-label">Analytics</span>
              </NavLink>
            ) : null}
            {canAccessGmailInbox ? (
              <NavLink
                to="/schedule/email"
                className={({ isActive }) =>
                  `schedule-app__quick-link${isActive ? ' schedule-app__quick-link--active' : ''}`
                }
                title={railCollapsedEffective ? 'Email' : undefined}
              >
                <span className="schedule-app__quick-link-icon" aria-hidden>
                  <Mail size={18} strokeWidth={1.75} />
                </span>
                <span className="schedule-app__quick-link-label">Email</span>
              </NavLink>
            ) : null}
          </nav>

          {SHOW_RAIL_WORK_QUEUES ? (
            <>
              <div className="schedule-app__rail-divider" role="presentation" />

              <h2 className="schedule-app__rail-title">Work queues</h2>
              <ul className="schedule-app__queues">
                {WORK_QUEUE_ROWS.map((row) => {
              const QIcon = row.icon;
              const countTitle = `${row.label} (${row.count})`;
              return (
                <li key={row.label}>
                  {row.to ? (
                    <NavLink
                      to={row.to}
                      className="schedule-app__queue-link"
                      title={railCollapsedEffective ? countTitle : undefined}
                    >
                      <span className="schedule-app__queue-icon" aria-hidden>
                        <QIcon size={17} strokeWidth={1.75} />
                      </span>
                      <span className="schedule-app__queue-text">{row.label}</span>
                      <span className="schedule-app__queue-count">({row.count})</span>
                    </NavLink>
                  ) : (
                    <span className="schedule-app__queue-muted" title={row.title ?? (railCollapsedEffective ? countTitle : undefined)}>
                      <span className="schedule-app__queue-icon" aria-hidden>
                        <QIcon size={17} strokeWidth={1.75} />
                      </span>
                      <span className="schedule-app__queue-text">{row.label}</span>
                      <span className="schedule-app__queue-count">({row.count})</span>
                    </span>
                  )}
                </li>
              );
            })}
              </ul>
            </>
          ) : null}
        </div>
      </aside>

      <div
        className={`schedule-app__main${
          scheduleMainStickyCalendarChain ? ' schedule-app__main--scheduler-sticky-outlet' : ''
        }`}
      >
        <div
          className={`schedule-app__outlet${outletFlush ? ' schedule-app__outlet--flush' : ''}${
            location.pathname === '/schedule/routing' ? ' schedule-app__outlet--routing-split' : ''
          }${outletFlushVerticallyScrollable ? ' schedule-app__outlet--flush-scroll-y' : ''}${
            scheduleMainStickyCalendarChain ? ' schedule-app__outlet--practice-sticky-x' : ''
          }`}
        >
          <Outlet context={{ schedulingToolsLinkPrefix: '/schedule/scheduling-tools' }} />
        </div>
      </div>
    </div>
  );
}
