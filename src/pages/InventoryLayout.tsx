import { NavLink, Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/useAuth';
import './Settings.css';

type Props = { basePath?: string };

function useIsInventoryAdmin(): boolean {
  const { role } = useAuth() as { role?: string | string[] };
  const roles = (Array.isArray(role) ? role : role ? [role] : []).map((r) =>
    String(r).toLowerCase().trim()
  );
  return roles.includes('admin') || roles.includes('superadmin');
}

export default function InventoryLayout({
  basePath = '/schedule/inventory',
}: Props) {
  const isAdmin = useIsInventoryAdmin();
  const location = useLocation();

  const onAdminPath =
    location.pathname.includes('/inventory/suppliers') ||
    location.pathname.includes('/inventory/count-report');
  if (!isAdmin && onAdminPath) {
    return <Navigate to={`${basePath}/items`} replace />;
  }

  return (
    <div className="settings-page">
      <h1 className="settings-title">Inventory</h1>
      <div className="settings-tabs" role="navigation" aria-label="Inventory">
        <NavLink
          to={`${basePath}/items`}
          className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
        >
          Items
        </NavLink>
        <NavLink
          to={`${basePath}/receive`}
          className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
        >
          Receive
        </NavLink>
        <NavLink
          to={`${basePath}/move`}
          className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
        >
          Move Items
        </NavLink>
        <NavLink
          to={`${basePath}/waste`}
          className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
        >
          Waste / Adjust
        </NavLink>
        <NavLink
          to={`${basePath}/activity`}
          className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
        >
          Activity
        </NavLink>
        <NavLink
          to={`${basePath}/par-levels`}
          className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
        >
          Par Levels
        </NavLink>
        <NavLink
          to={`${basePath}/counts`}
          className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
        >
          Weekly list to count
        </NavLink>
        <NavLink
          to={`${basePath}/full-count`}
          className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
        >
          All items
        </NavLink>
        {isAdmin && (
          <NavLink
            to={`${basePath}/count-report`}
            className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
          >
            Count report
          </NavLink>
        )}
        <NavLink
          to={`${basePath}/fill-list`}
          className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
        >
          Fill List
        </NavLink>
        <NavLink
          to={`${basePath}/order-list`}
          className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
        >
          Order List
        </NavLink>
        <NavLink
          to={`${basePath}/transfer-list`}
          className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
        >
          Transfer List
        </NavLink>
        {isAdmin && (
          <NavLink
            to={`${basePath}/suppliers`}
            className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
          >
            Suppliers
          </NavLink>
        )}
      </div>
      <Outlet />
    </div>
  );
}
