import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router';
import { ChevronDown } from 'lucide-react';
import { useAuth } from '../auth/useAuth';
import { usePermissions } from '../permissions/PermissionContext';
import { isInventoryOpsNavPath } from '../utils/catalogInventoryNav';
import ReleasedStockLinksNotice from '../components/inventory/ReleasedStockLinksNotice';
import './Settings.css';

type Props = { basePath?: string };

type NavItem = { to: string; label: string };

function useIsInventoryAdmin(): boolean {
  const { role } = useAuth() as { role?: string | string[] };
  const roles = (Array.isArray(role) ? role : role ? [role] : []).map((r) =>
    String(r).toLowerCase().trim(),
  );
  return roles.includes('admin') || roles.includes('superadmin');
}

function pathInGroup(pathname: string, items: NavItem[]): boolean {
  return items.some(
    (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
  );
}

function InventoryNavGroup({
  label,
  items,
  alsoActiveFor = [],
}: {
  label: string;
  items: NavItem[];
  /** Extra paths that should light up this group (e.g. full-count under Counts). */
  alsoActiveFor?: string[];
}) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const groupActive =
    pathInGroup(location.pathname, items) ||
    alsoActiveFor.some(
      (path) => location.pathname === path || location.pathname.startsWith(`${path}/`),
    );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="settings-tab-menu" ref={rootRef}>
      <button
        type="button"
        className={`settings-tab settings-tab-menu__trigger${groupActive ? ' active' : ''}${
          open ? ' settings-tab-menu__trigger--open' : ''
        }`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((prev) => !prev)}
      >
        {label}
        <ChevronDown size={14} aria-hidden />
      </button>
      {open ? (
        <div className="settings-tab-menu__panel" role="menu" aria-label={label}>
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              role="menuitem"
              className={({ isActive }) =>
                `settings-tab-menu__item${isActive ? ' active' : ''}`
              }
              onClick={() => setOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function InventoryLayout({
  basePath = '/schedule/inventory',
}: Props) {
  const isAdmin = useIsInventoryAdmin();
  const { hasRole } = usePermissions();
  const canSetup =
    isAdmin || hasRole('practice_admin', 'practice_manager', 'inventory_manager');
  const canManage = isAdmin || hasRole('practice_admin');
  const location = useLocation();

  const onPath = (segment: string) => location.pathname.includes(`/inventory/${segment}`);
  if (!isAdmin && onPath('suppliers')) {
    return <Navigate to={`${basePath}/items`} replace />;
  }
  if (!canManage && ['par-review', 'count-report', 'expiring', 'cost-reviews'].some(onPath)) {
    return <Navigate to={`${basePath}/counts`} replace />;
  }
  if (!canSetup && ['par-seed', 'store-import'].some(onPath)) {
    return <Navigate to={`${basePath}/counts`} replace />;
  }
  if (location.pathname.startsWith('/schedule/inventory/mail-orders')) {
    return (
      <Navigate
        to={{ pathname: '/schedule/mail-orders', search: location.search, hash: location.hash }}
        replace
      />
    );
  }

  const catalogItems: NavItem[] = [
    { to: `${basePath}/items`, label: 'Items' },
    ...(isAdmin ? [{ to: `${basePath}/suppliers`, label: 'Suppliers' }] : []),
  ];
  const storeItems: NavItem[] = [
    { to: `${basePath}/online-store`, label: 'Store items' },
    { to: `${basePath}/store-categories`, label: 'Categories' },
    { to: `${basePath}/abandoned-carts`, label: 'Abandoned carts' },
  ];
  const mailOrdersTo = '/schedule/mail-orders';
  const autoShipsTo = `${basePath}/auto-ships`;
  const pharmacySection = isInventoryOpsNavPath(location.pathname);
  const sectionTitle = pharmacySection ? 'Pharmacy' : 'Catalog';
  const hidePharmacyChromeOnMobile =
    pharmacySection &&
    [`${basePath}/receive`, `${basePath}/move`, `${basePath}/transfer-list`].some(
      (path) => location.pathname === path || location.pathname.startsWith(`${path}/`),
    );
  const setupItems: NavItem[] = [
    { to: `${basePath}/par-levels`, label: 'Par Levels' },
    { to: `${basePath}/first-counts`, label: 'First / Annual Counts' },
    { to: `${basePath}/store-import`, label: 'Online Store Import' },
  ];
  const manageItems: NavItem[] = [
    { to: `${basePath}/par-review`, label: 'Par Review' },
    { to: `${basePath}/count-report`, label: 'Count Report' },
    { to: `${basePath}/expiring`, label: 'Expiring' },
    { to: `${basePath}/cost-reviews`, label: 'Cost Reviews' },
    { to: `${basePath}/activity`, label: 'Activity' },
  ];
  const moveOrderItems: NavItem[] = [
    { to: `${basePath}/counts`, label: 'Weekly Counts' },
    { to: `${basePath}/receive`, label: 'Receive' },
    { to: `${basePath}/move`, label: 'Move Items' },
    { to: `${basePath}/waste`, label: 'Waste / Adjust' },
    { to: `${basePath}/transfer-list`, label: 'Transfer List' },
    { to: `${basePath}/order-list`, label: 'Order List' },
  ];

  return (
    <div
      className={`settings-page${hidePharmacyChromeOnMobile ? ' settings-page--inventory-task' : ''}`}
    >
      <h1 className="settings-title settings-title--section">{sectionTitle}</h1>
      <div className="settings-tabs" role="navigation" aria-label={sectionTitle}>
        {pharmacySection ? (
          <>
            <InventoryNavGroup
              label="Move / Order"
              items={moveOrderItems}
              alsoActiveFor={[`${basePath}/full-count`]}
            />
            <InventoryNavGroup label="Store" items={storeItems} />
            <NavLink
              to={mailOrdersTo}
              className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
            >
              Mail Order Queue
            </NavLink>
            <NavLink
              to={autoShipsTo}
              className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
            >
              Auto-ships
            </NavLink>
            {canManage ? <InventoryNavGroup label="Manage" items={manageItems} /> : null}
            {canSetup ? (
              <InventoryNavGroup
                label="Setup"
                items={setupItems}
                alsoActiveFor={[`${basePath}/par-seed`]}
              />
            ) : null}
          </>
        ) : (
          catalogItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))
        )}
      </div>
      {pharmacySection && canSetup ? <ReleasedStockLinksNotice /> : null}
      <Outlet />
    </div>
  );
}
