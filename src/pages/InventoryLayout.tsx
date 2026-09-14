import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router';
import { ChevronDown } from 'lucide-react';
import { useAuth } from '../auth/useAuth';
import { isInventoryOpsNavPath } from '../utils/catalogInventoryNav';
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
}: {
  label: string;
  items: NavItem[];
}) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const groupActive = pathInGroup(location.pathname, items);

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
  const location = useLocation();

  const onAdminPath =
    location.pathname.includes('/inventory/suppliers') ||
    location.pathname.includes('/inventory/count-report');
  if (!isAdmin && onAdminPath) {
    return <Navigate to={`${basePath}/items`} replace />;
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
    { to: `${basePath}/subscriptions`, label: 'Subscriptions' },
    ...(isAdmin ? [{ to: `${basePath}/suppliers`, label: 'Suppliers' }] : []),
  ];
  const storeItems: NavItem[] = [
    { to: `${basePath}/online-store`, label: 'Store items' },
    { to: `${basePath}/store-categories`, label: 'Categories' },
    { to: `${basePath}/abandoned-carts`, label: 'Abandoned carts' },
  ];
  const mailOrdersTo = '/schedule/mail-orders';
  const pharmacySection = isInventoryOpsNavPath(location.pathname);
  const sectionTitle = pharmacySection ? 'Pharmacy' : 'Catalog';
  const countItems: NavItem[] = [
    { to: `${basePath}/par-levels`, label: 'Par Levels' },
    { to: `${basePath}/counts`, label: 'Weekly count list' },
    { to: `${basePath}/full-count`, label: 'Counts for all items' },
    ...(isAdmin ? [{ to: `${basePath}/count-report`, label: 'Count report' }] : []),
  ];
  const flowItems: NavItem[] = [
    { to: `${basePath}/receive`, label: 'Receive' },
    { to: `${basePath}/move`, label: 'Move Items' },
    { to: `${basePath}/waste`, label: 'Waste / Adjust' },
    { to: `${basePath}/activity`, label: 'Activity' },
    { to: `${basePath}/fill-list`, label: 'Fill List' },
    { to: `${basePath}/order-list`, label: 'Order List' },
    { to: `${basePath}/transfer-list`, label: 'Transfer List' },
  ];

  return (
    <div className="settings-page">
      <h1 className="settings-title">{sectionTitle}</h1>
      <div className="settings-tabs" role="navigation" aria-label={sectionTitle}>
        {pharmacySection ? (
          <>
            <InventoryNavGroup label="Counts" items={countItems} />
            <InventoryNavGroup label="Flow" items={flowItems} />
            <InventoryNavGroup label="Store" items={storeItems} />
            <NavLink
              to={mailOrdersTo}
              className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
            >
              Mail Order Queue
            </NavLink>
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
      <Outlet />
    </div>
  );
}
