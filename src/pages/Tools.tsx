import { NavLink, Outlet } from 'react-router-dom';
import { getToolsTabPages } from '../tools-tabs';
import './Settings.css';

export default function Tools() {
  const tabs = getToolsTabPages();

  return (
    <div className="container">
      <div className="settings-page">
        <h1 className="settings-title">Tools</h1>
        <p className="settings-section-description" style={{ marginBottom: 24 }}>
          Utilities for day-to-day operations.
        </p>
        <div className="settings-tabs">
          {tabs.map((tab) => (
            <NavLink
              key={tab.path}
              to={`/tools/${tab.path}`}
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
