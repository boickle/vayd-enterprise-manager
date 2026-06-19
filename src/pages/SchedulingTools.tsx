import { NavLink, Outlet, useLocation, useOutletContext } from 'react-router-dom';
import {
  SCHEDULING_TOOL_TABS,
  SCHEDULING_WORKFLOW_TABS,
  isSchedulingToolTabActive,
  isSchedulingWorkflowTabActive,
} from '../scheduling-tools-nav';
import { useSchedulingToolsNavCounts } from '../hooks/useSchedulingToolsNavCounts';
import './Settings.css';

type SchedulingToolsOutletContext = {
  schedulingToolsLinkPrefix?: string;
};

function navTabCount(count: number | undefined, loading: boolean): string {
  if (loading || count == null) return '';
  return ` (${count})`;
}

function OnHoldNavTabLabel({
  total,
  over24,
  loading,
}: {
  total: number;
  over24: number;
  loading: boolean;
}) {
  if (loading) return null;
  return (
    <>
      {' ('}
      {total}
      {', '}
      <span className="scheduling-tools-nav__on-hold-over24">{over24} &gt; 24 hours</span>
      {')'}
    </>
  );
}

export default function SchedulingTools() {
  const location = useLocation();
  const ctx = useOutletContext<SchedulingToolsOutletContext | undefined>();
  const base = (ctx?.schedulingToolsLinkPrefix ?? '/scheduling-tools').replace(/\/$/, '');
  const { counts, loading: countsLoading } = useSchedulingToolsNavCounts(true, location.pathname);

  return (
    <div className="container">
      <div className="settings-page">
        <h1 className="settings-title">Scheduling Tools</h1>
        <p className="settings-section-description" style={{ marginBottom: 20 }}>
          Fill open slots on the calendar and follow up on unscheduled care reminders.
        </p>

        <nav className="scheduling-tools-nav" aria-label="Scheduling tools">
          <div className="scheduling-tools-nav__row">
            <span className="scheduling-tools-nav__label" id="scheduling-tools-fill-schedule-label">
              Fill Schedule
            </span>
            <div className="scheduling-tools-nav__tabs" role="tablist" aria-labelledby="scheduling-tools-fill-schedule-label">
              {SCHEDULING_TOOL_TABS.map((tab) => {
                const countSuffix =
                  tab.path === 'forward-booking'
                    ? navTabCount(counts.forwardBookingPending, countsLoading)
                    : tab.path === 'care-outreach'
                      ? navTabCount(counts.careOutreachPriority, countsLoading)
                      : '';
                return (
                  <NavLink
                    key={tab.path}
                    to={`${base}/${tab.path}`}
                    end={false}
                    className={({ isActive }) =>
                      `settings-tab scheduling-tools-nav__tab${
                        isActive || isSchedulingToolTabActive(location.pathname, tab.path) ? ' active' : ''
                      }`
                    }
                  >
                    {tab.label}
                    {countSuffix}
                  </NavLink>
                );
              })}
            </div>
          </div>

          <div className="scheduling-tools-nav__row scheduling-tools-nav__row--workflow">
            <span className="scheduling-tools-nav__label" id="scheduling-tools-follow-up-label">
              Follow-up
            </span>
            <div
              className="scheduling-tools-nav__tabs"
              role="tablist"
              aria-labelledby="scheduling-tools-follow-up-label"
            >
              {SCHEDULING_WORKFLOW_TABS.map((tab) => (
                  <NavLink
                    key={tab.path}
                    to={`${base}/${tab.path}`}
                    end={false}
                    className={({ isActive }) =>
                      `settings-tab scheduling-tools-nav__tab scheduling-tools-nav__tab--workflow${
                        isActive || isSchedulingWorkflowTabActive(location.pathname, tab.path)
                          ? ' active'
                          : ''
                      }`
                    }
                  >
                    {tab.label}
                    {tab.path === 'on-hold' ? (
                      <OnHoldNavTabLabel
                        total={counts.onHold}
                        over24={counts.onHoldOver24}
                        loading={countsLoading}
                      />
                    ) : null}
                  </NavLink>
                ))}
            </div>
          </div>
        </nav>

        <Outlet />
      </div>
    </div>
  );
}
