import { NavLink } from 'react-router';
import { useCan } from '../../permissions/PermissionContext';

/** Par Levels has one menu item; this switches between editing by item and a whole location. */
export default function ParLevelsModeTabs() {
  const canBulk = useCan('inventory.par.manage', 'all');
  if (!canBulk) return null;
  const chip = ({ isActive }: { isActive: boolean }) =>
    `par-loc-chip${isActive ? ' par-loc-chip--active' : ''}`;
  return (
    <div className="par-loc-chips" role="tablist" aria-label="Par levels" style={{ marginBottom: 12 }}>
      <NavLink to="/schedule/inventory/par-levels" className={chip} role="tab" end>
        By item
      </NavLink>
      <NavLink to="/schedule/inventory/par-seed" className={chip} role="tab" end>
        Whole location (bulk)
      </NavLink>
    </div>
  );
}
