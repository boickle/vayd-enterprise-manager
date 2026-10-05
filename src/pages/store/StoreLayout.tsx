import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../../auth/useAuth';
import { clearStorePortalReturn, storeCartCount, storePortalReturnPath } from './storeCartState';
import { useAbandonedCartSync } from './useAbandonedCartSync';
import { useStoreCart } from './useStoreCart';
import { useStorePortalReturn } from './useStorePortalReturn';
import StoreMemberPromo from './StoreMemberPromo';
import './Store.css';

export default function StoreLayout() {
  const nav = useNavigate();
  const count = storeCartCount(useStoreCart());
  const [menuOpen, setMenuOpen] = useState(false);
  const auth = useAuth() as {
    token?: string | null;
    userId?: string | null;
    userEmail?: string | null;
    clientInfo?: { email?: string } | null;
    logout?: () => Promise<void>;
  };
  const clientId =
    auth.userId && Number.isFinite(Number(auth.userId)) ? Number(auth.userId) : null;
  useAbandonedCartSync(auth.clientInfo?.email || auth.userEmail, clientId);
  const location = useLocation();
  // The app shell's <main> is the scroll container and keeps its offset across
  // route changes, so arriving from a long portal page would land mid/bottom.
  // Reset per store route unless the page is about to scroll to a specific row.
  useEffect(() => {
    if ((location.state as { highlightItemId?: unknown } | null)?.highlightItemId != null) return;
    document.querySelector('main')?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  const portalReturn = useStorePortalReturn();
  const showPortalReturn = Boolean(auth.token && portalReturn);
  const petName = portalReturn?.petName?.trim();
  const portalReturnLabel = petName
    ? `Back to ${petName}${/s$/i.test(petName) ? "'" : "'s"} portal`
    : 'Back to my portal';

  return (
    <div className="vayd-store">
      {auth.token ? (
        <div className="vayd-store__account">
          <button
            type="button"
            className="vayd-store__account-btn"
            aria-label="Account menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              {menuOpen ? (
                <path d="M18 6L6 18M6 6l12 12" />
              ) : (
                <>
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </>
              )}
            </svg>
          </button>
          {menuOpen ? (
            <>
              <div className="vayd-store__account-overlay" onClick={() => setMenuOpen(false)} />
              <div className="vayd-store__account-menu">
                <Link to="/store/autoship" onClick={() => setMenuOpen(false)}>
                  Edit auto-ship items
                </Link>
                <Link to="/client-portal?preferences=1" onClick={() => setMenuOpen(false)}>
                  Preferences
                </Link>
                <button
                  type="button"
                  onClick={async () => {
                    await auth.logout?.();
                    setMenuOpen(false);
                    nav('/login');
                  }}
                >
                  Log out
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      <header className="vayd-store__hero">
        <div className="vayd-store__nav">
          <Link to="/store">Shop</Link>
          {auth.token ? (
            <>
              <Link to="/store/autoship">Auto-ship</Link>
              <Link to="/client-portal">Client portal</Link>
            </>
          ) : (
            <Link to="/login" state={{ from: { pathname: '/store' } }}>
              Log in
            </Link>
          )}
          <Link to="/store/cart" className="vayd-store__nav-cart">
            Cart{count ? ` (${count})` : ''}
          </Link>
        </div>
        <Link to="/store" className="vayd-store__logo">
          <img src="/final_thick_lines_cropped.jpeg" alt="Vet At Your Door" />
        </Link>
      </header>
      <div className="vayd-store__wrap">
        {showPortalReturn ? (
          <div className="vayd-store__portal-return" role="note">
            <Link
              to={storePortalReturnPath(portalReturn)}
              className="vayd-store__portal-return-link"
              onClick={() => clearStorePortalReturn()}
            >
              <span aria-hidden>←</span> {portalReturnLabel}
            </Link>
            <span className="vayd-store__portal-return-hint">
              Your cart is saved — pick up where you left off any time.
            </span>
          </div>
        ) : null}
        <StoreMemberPromo />
        <Outlet />
      </div>
    </div>
  );
}
