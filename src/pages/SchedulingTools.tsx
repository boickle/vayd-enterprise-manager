import { NavLink, Outlet } from 'react-router-dom';
import { getSchedulingToolsTabPages } from '../scheduling-tools-tabs';
import './Settings.css';

export default function SchedulingTools() {
  const tabs = getSchedulingToolsTabPages();

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
              to={`/scheduling-tools/${tab.path}`}
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
