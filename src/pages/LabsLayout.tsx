import { NavLink, Outlet } from 'react-router';
import { LABS_HOME, LABS_IN_HOUSE } from '../utils/labsNav';
import './Settings.css';
import './PendingLabsPage.css';

export default function LabsLayout() {
  return (
    <div className="settings-page labs-layout">
      <h1 className="settings-title settings-title--section">Labs</h1>
      <div className="settings-tabs" role="navigation" aria-label="Labs">
        <NavLink
          to={LABS_HOME}
          className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
        >
          IDEXX results
        </NavLink>
        <NavLink
          to={LABS_IN_HOUSE}
          className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
        >
          In-house labs
        </NavLink>
        <NavLink to="/schedule/inventory/items?type=lab" className="settings-tab">
          Lab catalog →
        </NavLink>
      </div>
      <Outlet />
    </div>
  );
}
