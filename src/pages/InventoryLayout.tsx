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

export default function InventoryLayout({ basePath = '/schedule/inventory' }: Props) {
  const isAdmin = useIsInventoryAdmin();
  const location = useLocation();

  const onAdminPath = ['/cost-reviews', '/suppliers', '/waste-admin'].some((p) =>
    location.pathname.includes(`/inventory${p}`)
  );
  if (!isAdmin && onAdminPath) {
    return <Navigate to={`${basePath}/receive`} replace />;
  }

  return (
    <div className="settings-page">
      <h1 className="settings-title">Inventory</h1>
      <div className="settings-tabs" role="navigation" aria-label="Inventory sections">
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
        {isAdmin && (
          <>
            <NavLink
              to={`${basePath}/cost-reviews`}
              className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
            >
              Cost Reviews
            </NavLink>
            <NavLink
              to={`${basePath}/suppliers`}
              className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
            >
              Suppliers
            </NavLink>
            <NavLink
              to={`${basePath}/waste-admin`}
              className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
            >
              Waste Admin
            </NavLink>
          </>
        )}
      </div>
      <Outlet />
    </div>
  );
}
