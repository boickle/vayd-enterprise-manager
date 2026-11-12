import { NavLink } from 'react-router';
import { Banknote } from 'lucide-react';
import { useCanOrAdminLogin } from '../permissions/useCanOrAdminLogin';

/**
 * The left menu's "Create deposit" link. Shown only to people who may create a deposit (deposit.create,
 * or an admin login), the same check the deposits page itself makes (PAY-A8). Field staff who carry
 * checks see it even without analytics access; a client liaison without the permission doesn't.
 */
export default function DepositQuickLink({ collapsed }: { collapsed: boolean }) {
  const canCreateDeposit = useCanOrAdminLogin('deposit.create');
  if (!canCreateDeposit) return null;
  return (
    <NavLink
      to="/schedule/deposits"
      end
      className={({ isActive }) =>
        `schedule-app__quick-link${isActive ? ' schedule-app__quick-link--active' : ''}`
      }
      title={collapsed ? 'Create deposit' : undefined}
    >
      <span className="schedule-app__quick-link-icon" aria-hidden>
        <Banknote size={18} strokeWidth={1.75} />
      </span>
      <span className="schedule-app__quick-link-label">Create deposit</span>
    </NavLink>
  );
}
