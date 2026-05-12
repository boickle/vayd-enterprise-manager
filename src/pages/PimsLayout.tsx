import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import type { LucideIcon } from 'lucide-react';
import {
  Menu,
  Home,
  ClipboardList,
  Users,
  PawPrint,
  FlaskConical,
  ScanBarcode,
  BarChart3,
  Settings,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import PimsChromeHeader from '../components/pims/PimsChromeHeader';
import './PimsLayout.css';

type NavLeaf = { to: string; label: string };

type NavGroup = {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Single destination (no chevron / no sublist). */
  to?: string;
  /** Collapsible children (chevron). */
  children?: NavLeaf[];
};

const NAV_TAIL: NavGroup[] = [
  { id: 'tasks', label: 'Tasks', icon: ClipboardList, to: '/pims/tasks' },
  { id: 'clients', label: 'Clients', icon: Users, to: '/pims/clients' },
  { id: 'patients', label: 'Patients', icon: PawPrint, to: '/pims/patients' },
  { id: 'labs', label: 'Labs', icon: FlaskConical, to: '/pims/labs' },
  {
    id: 'inventory',
    label: 'Inventory',
    icon: ScanBarcode,
    children: [{ to: '/pims/inventory', label: 'Branch inventory & stock' }],
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: BarChart3,
    children: [
      { to: '/pims/reports/summary', label: 'Summary' },
      { to: '/pims/reports/activity', label: 'Activity' },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    children: [
      { to: '/pims/settings/practice', label: 'Practice' },
      { to: '/pims/settings/users', label: 'Users' },
    ],
  },
];

function buildNav(abilities?: string[] | null): NavGroup[] {
  const canSched =
    abilities == null || abilities.length === 0 || abilities.includes('canSeeRouting');
  const homeTo = canSched ? '/schedule/home' : '/pims/overview';
  return [
    { id: 'home', label: 'Home', icon: Home, to: homeTo },
    ...NAV_TAIL,
  ];
}

function pathMatchesChild(pathname: string, children: NavLeaf[]): boolean {
  return children.some((c) => pathname === c.to || pathname.startsWith(c.to + '/'));
}

export default function PimsLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = location.pathname;
  const { abilities } = useAuth() as { abilities?: string[] };

  const navItems = useMemo(() => buildNav(abilities), [abilities]);

  const [collapsed, setCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    const nav = buildNav(abilities);
    for (const g of nav) {
      if (g.children && pathMatchesChild(pathname, g.children)) init[g.id] = true;
    }
    return init;
  });

  useEffect(() => {
    setOpenGroups((prev) => {
      const next = { ...prev };
      for (const g of navItems) {
        if (g.children && pathMatchesChild(pathname, g.children)) next[g.id] = true;
      }
      return next;
    });
  }, [pathname, navItems]);

  const toggleGroup = useCallback((id: string) => {
    setOpenGroups((p) => ({ ...p, [id]: !p[id] }));
  }, []);

  return (
    <div className="pims-shell">
      <aside className={`pims-sidebar${collapsed ? ' pims-sidebar--collapsed' : ''}`}>
        <button
          type="button"
          className="pims-sidebar__toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
        >
          <Menu size={22} strokeWidth={1.75} />
        </button>
        <nav className="pims-sidebar__nav" aria-label="PIMS">
          <div className="pims-sidebar__scroll">
            {navItems.map((g) => {
              const Icon = g.icon;
              const hasChildren = !!(g.children && g.children.length);
              const isOpen = openGroups[g.id] ?? false;
              const childActive = hasChildren && g.children && pathMatchesChild(pathname, g.children);
              if (!hasChildren && g.to) {
                return (
                  <NavLink
                    key={g.id}
                    to={g.to}
                    end={g.id === 'home'}
                    title={collapsed ? g.label : undefined}
                    className={({ isActive }) =>
                      `pims-nav-row${isActive ? ' pims-nav-row--active' : ''}`
                    }
                  >
                    <span className="pims-nav-icon">
                      <Icon size={20} strokeWidth={1.75} />
                    </span>
                    <span className="pims-nav-label">{g.label}</span>
                  </NavLink>
                );
              }

              return (
                <div key={g.id}>
                  <button
                    type="button"
                    className={`pims-nav-row${childActive ? ' pims-nav-row--active' : ''}`}
                    title={collapsed ? g.label : undefined}
                    aria-expanded={!collapsed && isOpen}
                    onClick={() => {
                      if (collapsed && g.children?.length) {
                        navigate(g.children[0].to);
                        return;
                      }
                      toggleGroup(g.id);
                    }}
                  >
                    <span className="pims-nav-icon">
                      <Icon size={20} strokeWidth={1.75} />
                    </span>
                    <span className="pims-nav-label">{g.label}</span>
                    {!collapsed && (
                      <span className="pims-chevron" aria-hidden>
                        {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      </span>
                    )}
                  </button>
                  {hasChildren && isOpen && !collapsed && (
                    <div className="pims-subwrap">
                      {g.children!.map((c) => {
                        return (
                          <NavLink
                            key={c.to}
                            to={c.to}
                            className={({ isActive }) =>
                              `pims-sublink${isActive ? ' pims-sublink--active' : ''}`
                            }
                          >
                            {c.label}
                          </NavLink>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </nav>
      </aside>
      <div className="pims-main">
        <div className="pims-main__inner">
          <PimsChromeHeader />
          <Outlet />
        </div>
      </div>
    </div>
  );
}
