// src/components/UserMenu.tsx
import { useState, useRef, useEffect, type MouseEvent as ReactMouseEvent } from 'react';
import { useNavigate, NavLink, useLocation } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { apiErrorMessage } from '../api/http';
import { fetchMyPractices, type PracticeSummary } from '../api/practices';
import { blockRoutingCalendarPreviewNavigation } from '../utils/routingCalendarPreviewGuard';
import { markSchedulerHandoffPreferRoutingDoctor } from '../utils/schedulerCalendarHandoff';
import { startFreshNewAppointmentRouting } from '../utils/routingNewAppointment';
import './UserMenu.css';

export type UserMenuExtra =
  | { label: string; to: string; external?: false; href?: undefined }
  | { label: string; href: string; external: true; to?: undefined };

export default function UserMenu({ menuExtras = [] }: { menuExtras?: UserMenuExtra[] }) {
  const { logout, userEmail, role, switchPractice } = useAuth() as any;
  const nav = useNavigate();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [practices, setPractices] = useState<{
    current: string;
    practices: PracticeSummary[];
  } | null>(null);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Normalize roles
  const roles = Array.isArray(role) ? role : role ? [String(role)] : [];
  const isAdmin = roles.some((r) => ['admin', 'superadmin'].includes(String(r).toLowerCase()));

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        menuRef.current &&
        buttonRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || practices) return;
    let on = true;
    fetchMyPractices()
      .then((data) => {
        if (on) setPractices(data);
      })
      .catch(() => undefined);
    return () => {
      on = false;
    };
  }, [isOpen, practices]);

  const handleSwitchPractice = async (practiceKey: string) => {
    if (blockRoutingCalendarPreviewNavigation()) return;
    setSwitchError(null);
    setSwitchingTo(practiceKey);
    try {
      await switchPractice(practiceKey);
    } catch (err) {
      setSwitchError(apiErrorMessage(err));
      setSwitchingTo(null);
    }
  };

  const handleLogout = async () => {
    if (blockRoutingCalendarPreviewNavigation()) return;
    setIsOpen(false);
    await logout();
    nav('/login');
  };

  const handleSettings = () => {
    if (blockRoutingCalendarPreviewNavigation()) return;
    setIsOpen(false);
    nav('/admin');
  };

  const handlePageClick = (e: ReactMouseEvent<HTMLAnchorElement>, to?: string) => {
    const toPath = (to ?? '').split('?')[0] ?? '';
    if (toPath === '/schedule/routing') {
      if (!startFreshNewAppointmentRouting()) {
        e.preventDefault();
        return;
      }
      markSchedulerHandoffPreferRoutingDoctor();
      setIsOpen(false);
      return;
    }
    if (blockRoutingCalendarPreviewNavigation()) {
      e.preventDefault();
      return;
    }
    setIsOpen(false);
  };

  return (
    <div className="user-menu-container">
      <button
        ref={buttonRef}
        className="user-menu-button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="User menu"
        aria-expanded={isOpen}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="3" y1="12" x2="21" y2="12"></line>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <line x1="3" y1="18" x2="21" y2="18"></line>
        </svg>
      </button>

      {isOpen && (
        <div ref={menuRef} className="user-menu-dropdown">
          <div className="user-menu-header">
            <span className="user-menu-email">{userEmail || 'Signed in'}</span>
          </div>
          <div className="user-menu-divider"></div>

          {practices && practices.practices.length > 1 && (
            <>
              <div className="user-menu-section-label">Practice</div>
              {practices.practices.map((practice) => {
                const isCurrent = practice.key === practices.current;
                return (
                  <button
                    key={practice.key}
                    className={`user-menu-item user-menu-nav-item${isCurrent ? ' is-active' : ''}`}
                    onClick={() => !isCurrent && handleSwitchPractice(practice.key)}
                    disabled={isCurrent || switchingTo != null}
                    aria-current={isCurrent ? 'true' : undefined}
                  >
                    {switchingTo === practice.key ? `Switching to ${practice.name}…` : practice.name}
                  </button>
                );
              })}
              {switchError && <div className="user-menu-section-label danger">{switchError}</div>}
              <div className="user-menu-divider"></div>
            </>
          )}

          {menuExtras.length > 0 && (
            <>
              <div className="user-menu-section-label">Menu</div>
              {menuExtras.map((extra) => {
                if (extra.external) {
                  return (
                    <a
                      key={extra.href}
                      href={extra.href}
                      className="user-menu-item user-menu-nav-item"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setIsOpen(false)}
                    >
                      {extra.label}
                    </a>
                  );
                }
                const toPath = extra.to.split('?')[0] ?? extra.to;
                const isActive =
                  location.pathname === toPath || location.pathname.startsWith(`${toPath}/`);
                return (
                  <NavLink
                    key={extra.to}
                    to={extra.to}
                    className={`user-menu-item user-menu-nav-item${isActive ? ' is-active' : ''}`}
                    onClick={(e) => handlePageClick(e, extra.to)}
                  >
                    {extra.label}
                  </NavLink>
                );
              })}
              <div className="user-menu-divider"></div>
            </>
          )}
          
          {isAdmin && (
            <>
              <button className="user-menu-item user-menu-builtin-settings" onClick={handleSettings}>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M12 1v6m0 6v6M5.64 5.64l4.24 4.24m4.24 4.24l4.24 4.24M1 12h6m6 0h6M5.64 18.36l4.24-4.24m4.24-4.24l4.24-4.24"></path>
                </svg>
                Settings
              </button>
              <div className="user-menu-divider"></div>
            </>
          )}
          <button className="user-menu-item" onClick={handleLogout}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

