import { NavLink, Outlet } from 'react-router';
import { APPOINTMENT_REQUEST_PROMOTIONS_PATH, MEMBERSHIP_PROMOTIONS_PATH } from '../../marketing-nav';
import '../Settings.css';

/** Marketing → Promotions: one page with a tab for each kind of promotion (like Labs). */
export default function PromotionsLayout() {
  const tabClass = ({ isActive }: { isActive: boolean }) =>
    `settings-tab${isActive ? ' active' : ''}`;
  return (
    <div className="settings-page promotions-layout">
      <h1 className="settings-title settings-title--section">Promotions</h1>
      <div className="settings-tabs" role="navigation" aria-label="Promotions">
        <NavLink to={MEMBERSHIP_PROMOTIONS_PATH} className={tabClass}>
          Membership Promotions
        </NavLink>
        <NavLink to={APPOINTMENT_REQUEST_PROMOTIONS_PATH} className={tabClass}>
          Appointment Request Promotions
        </NavLink>
      </div>
      <Outlet />
    </div>
  );
}
