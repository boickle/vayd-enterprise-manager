// src/components/UserMenu.tsx
import { useState, useRef, useEffect } from 'react';
import { useNavigate, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import './UserMenu.css';

type Page = { path: string; label: string };

export default function UserMenu({ pages = [] }: { pages?: Page[] }) {
  const { logout, userEmail, role } = useAuth() as any;
  const nav = useNavigate();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
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

  const handleLogout = async () => {
    setIsOpen(false);
    await logout();
    nav('/login');
  };

  const handleSettings = () => {
    setIsOpen(false);
    nav('/settings');
  };

  const handlePageClick = () => {
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
          
          {/* Navigation tabs - shown on mobile only */}
          {pages.length > 0 && (
            <>
              <div className="user-menu-section-label">Navigation</div>
              {pages.map((page) => {
                const isActive = location.pathname === page.path || location.pathname.startsWith(page.path + '/');
                return (
                  <NavLink
                    key={page.path}
                    to={page.path}
                    className={`user-menu-item user-menu-nav-item${isActive ? ' is-active' : ''}`}
                    onClick={handlePageClick}
                  >
                    {page.label}
                  </NavLink>
                );
              })}
              <div className="user-menu-divider"></div>
            </>
          )}
          
          {isAdmin && (
            <>
              <button className="user-menu-item" onClick={handleSettings}>
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

