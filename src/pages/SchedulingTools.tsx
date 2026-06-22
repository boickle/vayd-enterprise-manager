import { useState } from 'react';
import { NavLink, Outlet, useLocation, useOutletContext } from 'react-router-dom';
import { SCHEDULING_TOOL_TABS, isSchedulingToolTabActive } from '../scheduling-tools-nav';
import {
  notifySchedulingToolsPageRefresh,
  useSchedulingToolsNavCounts,
} from '../hooks/useSchedulingToolsNavCounts';
import './Settings.css';

type SchedulingToolsOutletContext = {
  schedulingToolsLinkPrefix?: string;
};

function TabCount({ count, loading }: { count: number | undefined; loading: boolean }) {
  if (loading || !count) return null;
  return (
    <span className="scheduling-tools-nav__count" aria-hidden>
      {count}
    </span>
  );
}

export default function SchedulingTools() {
  const location = useLocation();
  const ctx = useOutletContext<SchedulingToolsOutletContext | undefined>();
  const base = (ctx?.schedulingToolsLinkPrefix ?? '/scheduling-tools').replace(/\/$/, '');
  const { counts, loading: countsLoading, refresh } = useSchedulingToolsNavCounts(true, location.pathname);
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

  const countForTab = (path: string): number | undefined => {
    switch (path) {
      case 'care-outreach':
        return counts.careOutreachPriority;
      case 'forward-booking':
        return counts.forwardBookingPending;
      case 'texted-offers':
        return counts.textedOffersActive;
      default:
        return undefined;
    }
  };

  return (
    <div className="container">
      <div className="settings-page">
        <h1 className="settings-title">Scheduling Tools</h1>
        <p className="settings-section-description" style={{ marginBottom: 20 }}>
          Fill open slots on the calendar and follow up on unscheduled care reminders.
        </p>

        <nav className="scheduling-tools-nav" aria-label="Scheduling tools">
          <div className="scheduling-tools-nav__tabs" role="tablist">
            {SCHEDULING_TOOL_TABS.map((tab) => {
              const showOver24 =
                tab.path === 'forward-booking' && !countsLoading && counts.onHoldOver24 > 0;
              const showTextedOffersFollowUp =
                tab.path === 'texted-offers' &&
                !countsLoading &&
                counts.textedOffersNeedsFollowUp > 0;
              const showTextedOffersToConfirm =
                tab.path === 'texted-offers' &&
                !countsLoading &&
                counts.textedOffersToConfirm > 0;
              return (
                <NavLink
                  key={tab.path}
                  to={`${base}/${tab.path}`}
                  end={false}
                  className={({ isActive }) =>
                    `settings-tab scheduling-tools-nav__tab${
                      isActive || isSchedulingToolTabActive(location.pathname, tab.path)
                        ? ' active'
                        : ''
                    }`
                  }
                >
                  <span>{tab.label}</span>
                  <TabCount count={countForTab(tab.path)} loading={countsLoading} />
                  {showOver24 ? (
                    <span
                      className="scheduling-tools-nav__alert"
                      title={`${counts.onHoldOver24} on hold over 24 hours`}
                    >
                      {counts.onHoldOver24} &gt; 24h
                    </span>
                  ) : null}
                  {tab.path === 'texted-offers' &&
                  (showTextedOffersFollowUp || showTextedOffersToConfirm) ? (
                    <span className="scheduling-tools-nav__alerts-stack">
                      {showTextedOffersFollowUp ? (
                        <span
                          className="scheduling-tools-nav__alert scheduling-tools-nav__alert--follow-up"
                          title={`${counts.textedOffersNeedsFollowUp} need follow-up`}
                        >
                          {counts.textedOffersNeedsFollowUp} follow-up
                        </span>
                      ) : null}
                      {showTextedOffersToConfirm ? (
                        <span
                          className="scheduling-tools-nav__alert scheduling-tools-nav__alert--to-confirm"
                          title={`${counts.textedOffersToConfirm} waiting for staff review`}
                        >
                          {counts.textedOffersToConfirm} to review
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </NavLink>
              );
            })}
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
