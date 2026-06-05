import { NavLink, Outlet, useOutletContext } from 'react-router-dom';
import { getSchedulingToolsTabPages } from '../scheduling-tools-tabs';
import './Settings.css';

type SchedulingToolsOutletContext = {
  schedulingToolsLinkPrefix?: string;
};

export default function SchedulingTools() {
  const tabs = getSchedulingToolsTabPages();
  const ctx = useOutletContext<SchedulingToolsOutletContext | undefined>();
  const base = (ctx?.schedulingToolsLinkPrefix ?? '/scheduling-tools').replace(/\/$/, '');

  return (
    <div className="container">
      <div className="settings-page">
        <h1 className="settings-title">Scheduling Tools</h1>
        <p className="settings-section-description" style={{ marginBottom: 24 }}>
          Fill open slots on the calendar and follow up on unscheduled care reminders.
        </p>
        <div className="settings-tabs">
          {tabs.map((tab) => (
            <NavLink
              key={tab.path}
              to={`${base}/${tab.path}`}
              end={false}
              className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
            >
              {tab.label}
            </NavLink>
          ))}
        </div>
        <Outlet />
      </div>
    </div>
  );
}
