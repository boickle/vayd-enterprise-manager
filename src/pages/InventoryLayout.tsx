import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router';
import { ChevronDown } from 'lucide-react';
import { useAuth } from '../auth/useAuth';
import { useCan, usePermissions } from '../permissions/PermissionContext';
import { isInventoryOpsNavPath } from '../utils/catalogInventoryNav';
import ReleasedStockLinksNotice from '../components/inventory/ReleasedStockLinksNotice';
import { AttentionBadge, useInventoryAttention } from '../utils/useInventoryAttention';
import { useMailNavCounts } from '../utils/useMailNavCounts';
import { currentPracticeId } from '../utils/practiceIdFromToken';
import './Settings.css';

type Props = { basePath?: string };

type NavItem = { to: string; label: string; badge?: number };

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
        <AttentionBadge count={items.reduce((sum, item) => sum + (item.badge ?? 0), 0)} />
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
              <AttentionBadge count={item.badge ?? 0} />
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
  const { hasRole, effective, error: permissionsError } = usePermissions();
  // Opening a gated page directly (a link, a refresh) mounts before permissions load; deciding
  // then would send a practice manager away from Cost Reviews. Wait for them first.
  const permissionsReady = isAdmin || effective != null || permissionsError != null;
  // Manage and Setup: practice manager and admin only (owner decision, Oct 30, 2026).
  const canSetup = isAdmin || hasRole('practice_admin', 'practice_manager');
  const canManage = isAdmin || hasRole('practice_admin', 'practice_manager');
  // Mail order queue: mail order staff, practice manager, and admin (not technicians).
  const holdsStoreListings = useCan('store.listing.manage');
  const holdsStoreCategories = useCan('store.category.manage');
  const holdsAbandonedCarts = useCan('store.abandoned_cart.resend');
  const holdsGiftCardAdmin = useCan('gift_card.issue');
  const holdsMailQueue = useCan('mail_order.fulfill');
  const holdsAutoships = useCan('store.subscription.manage');
  const canStoreListings = isAdmin || holdsStoreListings;
  const canStoreCategories = isAdmin || holdsStoreCategories;
  const canAbandonedCarts = isAdmin || holdsAbandonedCarts;
  const canMailQueue = isAdmin || holdsMailQueue;
  const canAutoships = isAdmin || holdsAutoships;
  // First / Annual Counts follows its own permission, so a doctor who manages their home branch
  // can count controlled drugs without being a practice manager.
  const holdsBaseline = useCan('inventory.count.baseline');
  const canFirstCounts = isAdmin || holdsBaseline;
  const holdsCostReview = useCan('inventory.cost_review.manage');
  const canCostReview = isAdmin || holdsCostReview;
  const canSeeGiftCards = isAdmin || holdsGiftCardAdmin;
  // Move / Order screens follow their own permissions, so client liaisons (who don't count or
  // unbox) see only what they can use (Q8, owner, Nov 9, 2026).
  const holdsCount = useCan('inventory.count.enter');
  const holdsReceive = useCan('inventory.receive');
  const holdsTransfer = useCan('inventory.transfer');
  const holdsWaste = useCan('inventory.waste');
  const holdsFillList = useCan('inventory.fill_list.manage');
  const holdsOrderRequest = useCan('inventory.po.request');
  const holdsOrderManage = useCan('inventory.po.manage');
  const location = useLocation();
  const attention = useInventoryAttention(canManage);
  // Owner (Nov 11, 2026): client replies on held mail orders, and auto-ship payment problems.
  const mailCounts = useMailNavCounts(currentPracticeId(), canMailQueue || canAutoships);

  const onPath = (segment: string) => location.pathname.includes(`/inventory/${segment}`);
  const moveOrderNav = [
    { segment: 'counts', label: 'Weekly Counts', allowed: isAdmin || holdsCount },
    { segment: 'receive', label: 'Unbox', allowed: isAdmin || holdsReceive },
    { segment: 'move', label: 'Move Items', allowed: isAdmin || holdsTransfer },
    { segment: 'waste', label: 'Waste / Adjust', allowed: isAdmin || holdsWaste },
    { segment: 'transfer-list', label: 'Transfer List', allowed: isAdmin || holdsFillList },
    {
      segment: 'order-list',
      label: 'Order List',
      allowed: isAdmin || holdsOrderRequest || holdsOrderManage,
    },
  ].map((item) => ({ ...item, to: `${basePath}/${item.segment}` }));
  // Someone with no Move / Order screens (the mail order team) lands on what they do use.
  const firstMoveOrder =
    moveOrderNav.find((item) => item.allowed)?.to ??
    (canMailQueue
      ? '/schedule/mail-orders'
      : canAutoships
        ? `${basePath}/auto-ships`
        : canStoreListings
          ? `${basePath}/online-store`
          : '/schedule');
  const blockedMoveOrder = moveOrderNav.find(
    (item) =>
      !item.allowed &&
      (location.pathname === item.to || location.pathname.startsWith(`${item.to}/`))
  );
  if (blockedMoveOrder) {
    if (!permissionsReady) return <p className="settings-muted">Loading…</p>;
    return <Navigate to={firstMoveOrder} replace />;
  }
  const gated = [
    'par-review',
    'cost-reviews',
    'par-seed',
    'store-import',
    'autoship-import',
    'online-store',
    'store-categories',
    'abandoned-carts',
    'gift-cards',
    'auto-ships',
  ];
  if (!permissionsReady && gated.some(onPath)) {
    return <p className="settings-muted">Loading…</p>;
  }
  if (!isAdmin && onPath('suppliers')) {
    return <Navigate to={`${basePath}/items`} replace />;
  }
  if (!canManage && onPath('par-review')) {
    return <Navigate to={`${basePath}/counts`} replace />;
  }
  if (!canCostReview && onPath('cost-reviews')) {
    return <Navigate to={`${basePath}/counts`} replace />;
  }
  if (!canSetup && ['par-seed', 'store-import', 'autoship-import'].some(onPath)) {
    return <Navigate to={`${basePath}/counts`} replace />;
  }
  if (
    (!canStoreListings && onPath('online-store')) ||
    (!canStoreCategories && onPath('store-categories')) ||
    (!canAbandonedCarts && onPath('abandoned-carts')) ||
    (!canSeeGiftCards && onPath('gift-cards')) ||
    (!canAutoships && onPath('auto-ships'))
  ) {
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
  const onMailQueue =
    location.pathname === '/schedule/mail-orders' ||
    location.pathname.startsWith('/schedule/mail-orders/');
  if (!permissionsReady && onMailQueue) {
    return <p className="settings-muted">Loading…</p>;
  }
  if (!canMailQueue && onMailQueue) {
    return <Navigate to={`${basePath}/counts`} replace />;
  }

  const catalogItems: NavItem[] = [
    { to: `${basePath}/items`, label: 'Items' },
    ...(isAdmin ? [{ to: `${basePath}/suppliers`, label: 'Suppliers' }] : []),
  ];
  const storeItems: NavItem[] = [
    ...(canStoreListings ? [{ to: `${basePath}/online-store`, label: 'Store items' }] : []),
    ...(canStoreCategories ? [{ to: `${basePath}/store-categories`, label: 'Categories' }] : []),
    ...(canAbandonedCarts ? [{ to: `${basePath}/abandoned-carts`, label: 'Abandoned carts' }] : []),
    ...(canSeeGiftCards ? [{ to: `${basePath}/gift-cards`, label: 'Sold gift cards' }] : []),
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
  const firstCountsItem: NavItem = {
    to: `${basePath}/first-counts`,
    label: 'First / Annual Counts',
  };
  const setupItems: NavItem[] = canSetup
    ? [
        { to: `${basePath}/par-levels`, label: 'Par Levels' },
        firstCountsItem,
        { to: `${basePath}/store-import`, label: 'Online Store Import' },
        { to: `${basePath}/autoship-import`, label: 'Auto-ship Import' },
      ]
    : canFirstCounts
      ? [firstCountsItem]
      : [];
  const manageItems: NavItem[] = [
    { to: `${basePath}/par-review`, label: 'Par Review' },
    ...(canCostReview
      ? [{ to: `${basePath}/cost-reviews`, label: 'Cost Reviews', badge: attention.costReviews }]
      : []),
    { to: '/schedule/analytics/inventory', label: 'Reports (shrink, counts, expiring, controlled) →' },
  ];
  const moveOrderItems: NavItem[] = moveOrderNav
    .filter((item) => item.allowed)
    .map(({ to, label }) => ({ to, label }));

  return (
    <div
      className={`settings-page${hidePharmacyChromeOnMobile ? ' settings-page--inventory-task' : ''}`}
    >
      <h1 className="settings-title settings-title--section">{sectionTitle}</h1>
      <div className="settings-tabs" role="navigation" aria-label={sectionTitle}>
        {pharmacySection ? (
          <>
            {moveOrderItems.length ? (
              <InventoryNavGroup
                label="Move / Order"
                items={moveOrderItems}
                alsoActiveFor={[`${basePath}/full-count`]}
              />
            ) : null}
            {storeItems.length ? <InventoryNavGroup label="Store" items={storeItems} /> : null}
            {canMailQueue ? (
              <NavLink
                to={mailOrdersTo}
                className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
              >
                Mail Order Queue
                <AttentionBadge count={mailCounts.clientReplies} title="Clients who texted back on a held order" />
              </NavLink>
            ) : null}
            {canAutoships ? (
              <NavLink
                to={autoShipsTo}
                className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
              >
                Auto-ships
                <AttentionBadge count={mailCounts.autoshipPaymentProblems} title="Auto-ships with a payment problem" />
              </NavLink>
            ) : null}
            {canManage ? <InventoryNavGroup label="Manage" items={manageItems} /> : null}
            {setupItems.length > 0 ? (
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
