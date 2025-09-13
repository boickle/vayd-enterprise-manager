// src/components/AppTabs.tsx
import { NavLink } from 'react-router-dom';

type Page = { path: string; label: string };

export default function AppTabs({ pages }: { pages: Page[] }) {
  return (
    <nav className="app-tabs">
      <div className="app-tabs__scroller">
        {pages.map((p) => (
          <NavLink
            key={p.path}
            to={p.path}
            className={({ isActive }) => `app-tab${isActive ? ' is-active' : ''}`}
          >
            {p.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
