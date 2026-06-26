import { Children, Fragment, isValidElement, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useOutletContext } from 'react-router-dom';
import {
  SCHEDULING_TOOL_OUTREACH_TABS,
  SCHEDULING_TOOL_WORKFLOW_TABS,
  isSchedulingToolTabActive,
  type SchedulingToolTab,
} from '../scheduling-tools-nav';
import {
  notifySchedulingToolsPageRefresh,
  useSchedulingToolsNavCounts,
} from '../hooks/useSchedulingToolsNavCounts';
import './Settings.css';

type SchedulingToolsOutletContext = {
  schedulingToolsLinkPrefix?: string;
};

type TabBadgeVariant = 'default' | 'hold' | 'urgent' | 'follow-up' | 'review';

function TabBadge({
  count,
  variant = 'default',
  title,
}: {
  count: number;
  variant?: TabBadgeVariant;
  title: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      className={`scheduling-tools-nav__badge scheduling-tools-nav__badge--${variant}`}
      title={title}
      aria-label={title}
    >
      {count}
    </span>
  );
}

function hasVisibleBadges(children: ReactNode): boolean {
  let found = false;
  Children.forEach(children, (child) => {
    if (found || child == null || child === false) return;
    if (isValidElement(child) && child.type === Fragment) {
      if (hasVisibleBadges(child.props.children)) found = true;
    } else {
      found = true;
    }
  });
  return found;
}

function TabBadges({ children }: { children: ReactNode }) {
  if (!hasVisibleBadges(children)) return null;
  return <span className="scheduling-tools-nav__badges">{children}</span>;
}

function tabBadgesForPath(
  path: string,
  counts: ReturnType<typeof useSchedulingToolsNavCounts>['counts'],
): ReactNode {
  switch (path) {
    case 'care-outreach':
      return (
        <TabBadge
          count={counts.careOutreachPriority}
          variant="default"
          title={`${counts.careOutreachPriority} in queue`}
        />
      );
    case 'forward-booking':
      return (
        <TabBadge
          count={counts.forwardBookingPending}
          variant="default"
          title={`${counts.forwardBookingPending} in queue`}
        />
      );
    case 'on-hold':
      return (
        <>
          {counts.onHoldOver24 > 0 && counts.onHoldOver24 < counts.onHold ? (
            <TabBadge
              count={counts.onHold - counts.onHoldOver24}
              variant="hold"
              title={`${counts.onHold - counts.onHoldOver24} on hold under 24 hours`}
            />
          ) : null}
          {counts.onHoldOver24 > 0 ? (
            <TabBadge
              count={counts.onHoldOver24}
              variant="urgent"
              title={`${counts.onHoldOver24} on hold over 24 hours`}
            />
          ) : (
            <TabBadge count={counts.onHold} variant="hold" title={`${counts.onHold} on hold`} />
          )}
        </>
      );
    case 'booked':
      return null;
    case 'texted-offers':
      return (
        <>
          <TabBadge
            count={counts.textedOffersNeedsFollowUp}
            variant="follow-up"
            title={`${counts.textedOffersNeedsFollowUp} need follow-up`}
          />
          <TabBadge
            count={counts.textedOffersToConfirm}
            variant="review"
            title={`${counts.textedOffersToConfirm} waiting for staff review`}
          />
        </>
      );
    default:
      return null;
  }
}

function SchedulingToolTabLink({
  tab,
  base,
  pathname,
  search,
  showBadges,
  counts,
}: {
  tab: SchedulingToolTab;
  base: string;
  pathname: string;
  search: string;
  showBadges: boolean;
  counts: ReturnType<typeof useSchedulingToolsNavCounts>['counts'];
}) {
  return (
    <NavLink
      key={tab.path}
      to={`${base}/${tab.path}`}
      end={false}
      className={({ isActive }) =>
        `settings-tab scheduling-tools-nav__tab${
          isActive || isSchedulingToolTabActive(pathname, tab.path, search) ? ' active' : ''
        }`
      }
    >
      <span>{tab.label}</span>
      {showBadges ? <TabBadges>{tabBadgesForPath(tab.path, counts)}</TabBadges> : null}
    </NavLink>
  );
}

export default function SchedulingTools() {
  const location = useLocation();
  const ctx = useOutletContext<SchedulingToolsOutletContext | undefined>();
  const base = (ctx?.schedulingToolsLinkPrefix ?? '/scheduling-tools').replace(/\/$/, '');
  const { counts, loading: countsLoading, refresh } = useSchedulingToolsNavCounts(true);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refresh();
      notifySchedulingToolsPageRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const showBadges = !countsLoading;

  return (
    <div className="container">
      <div className="settings-page">
        <h1 className="settings-title">Scheduling Tools</h1>

        <nav className="scheduling-tools-nav" aria-label="Scheduling tools">
          <div className="scheduling-tools-nav__tabs" role="tablist">
            {SCHEDULING_TOOL_OUTREACH_TABS.map((tab) => (
              <SchedulingToolTabLink
                key={tab.path}
                tab={tab}
                base={base}
                pathname={location.pathname}
                search={location.search}
                showBadges={showBadges}
                counts={counts}
              />
            ))}
            <span className="scheduling-tools-nav__divider" aria-hidden />
            {SCHEDULING_TOOL_WORKFLOW_TABS.map((tab) => (
              <SchedulingToolTabLink
                key={tab.path}
                tab={tab}
                base={base}
                pathname={location.pathname}
                search={location.search}
                showBadges={showBadges}
                counts={counts}
              />
            ))}
          </div>
          <button
            type="button"
            className="btn secondary scheduling-tools-nav__refresh"
            disabled={refreshing || countsLoading}
            onClick={() => void handleRefresh()}
            title="Refresh tab counts and reload the current list"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </nav>

        <Outlet />
      </div>
    </div>
  );
}
