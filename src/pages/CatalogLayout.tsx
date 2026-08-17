import { NavLink, Outlet } from 'react-router';
import './Settings.css';

type Props = { basePath?: string };

export default function CatalogLayout({ basePath = '/schedule/catalog' }: Props) {
  return (
    <div className="settings-page">
      <h1 className="settings-title">Catalog</h1>
      <div className="settings-tabs" role="navigation" aria-label="Catalog sections">
        <NavLink
          to={`${basePath}/inventory`}
          className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
        >
          Inventory
        </NavLink>
        <NavLink
          to={`${basePath}/procedures`}
          className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
        >
          Procedures
        </NavLink>
        <NavLink
          to={`${basePath}/labs`}
          className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
        >
          Labs
        </NavLink>
      </div>
      <Outlet />
    </div>
  );
}
