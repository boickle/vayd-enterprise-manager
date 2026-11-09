// Admin sub-tabs: path is relative to /admin. Kept in a separate file to avoid circular import (Admin.tsx imports this; app-pages imports Admin).
import type { JSX } from 'react';
import { Navigate, useLocation } from 'react-router';
import OpenPhoneCoaching from './pages/OpenPhoneCoaching';
import AdminUsers from './pages/AdminUsers';
import PlatformPractices from './pages/PlatformPractices';
import { APPOINTMENT_REQUEST_PROMOTIONS_PATH, MEMBERSHIP_PROMOTIONS_PATH } from './marketing-nav';

export type AdminTabPage = {
  path: string;
  label: string;
  element: JSX.Element;
  role?: string | string[];
  /** When set, this tab is listed under a dropdown with this label (e.g. Inventory). */
  group?: string;
  /** Only shown to platform admins, whatever their role in this practice. */
  platformAdminOnly?: boolean;
  /** Route still works but isn't listed in the admin menu (moved pages, parked features). */
  hidden?: boolean;
};

/** Sends old admin links to where the page lives now, staying inside /schedule when there. */
function MovedTo({ to }: { to: string }) {
  const { pathname } = useLocation();
  const prefix = pathname.startsWith('/schedule/') ? '/schedule' : '';
  return <Navigate to={`${prefix}${to}`} replace />;
}

const ADMIN = ['admin', 'superadmin'];

export const ADMIN_TAB_PAGES: AdminTabPage[] = [
  {
    path: 'users',
    label: 'Users',
    element: <AdminUsers />,
    role: ADMIN,
  },
  {
    path: 'practices',
    label: 'Practices',
    element: <PlatformPractices />,
    role: ADMIN,
    platformAdminOnly: true,
  },
  {
    path: 'open-phone-coaching',
    label: 'Open Phone Coaching',
    element: <OpenPhoneCoaching />,
    role: ADMIN,
    hidden: true,
  },
  // RP-08: both promotions pages moved to Marketing (owner decision D3 menus). Old links redirect.
  {
    path: 'membership-promotions',
    label: 'Membership Promotions',
    element: <Navigate to={MEMBERSHIP_PROMOTIONS_PATH} replace />,
    role: ADMIN,
    hidden: true,
  },
  {
    path: 'appointment-request-promotions',
    label: 'Appointment Request Promotions',
    element: <Navigate to={APPOINTMENT_REQUEST_PROMOTIONS_PATH} replace />,
    role: ADMIN,
    hidden: true,
  },
  {
    path: 'survey/results',
    label: 'Survey Results',
    element: <MovedTo to="/analytics/survey-results" />,
    role: ADMIN,
    hidden: true,
  },
  {
    path: 'routing-score-thresholds',
    label: 'Client Offers & Auto-Book',
    element: <MovedTo to="/settings?tab=client-offers" />,
    role: ADMIN,
    hidden: true,
  },
  {
    path: 'inventory/cost-reviews',
    label: 'Cost Reviews',
    element: <MovedTo to="/analytics/inventory/cost-reviews" />,
    role: ADMIN,
    hidden: true,
  },
  {
    path: 'inventory/expiring',
    label: 'Expiring',
    element: <MovedTo to="/analytics/inventory/expiring" />,
    role: ADMIN,
    hidden: true,
  },
  {
    path: 'reports/room-loader-declines',
    label: 'Room Loader declines',
    element: <MovedTo to="/analytics/room-loader-declines" />,
    role: ADMIN,
    hidden: true,
  },
  {
    path: 'reports/production-overrides',
    label: 'Production overrides',
    element: <MovedTo to="/analytics/production-overrides" />,
    role: ADMIN,
    hidden: true,
  },
  {
    path: 'reports/credits-discounts',
    label: 'Credits and discounts',
    element: <MovedTo to="/analytics/credits-discounts" />,
    role: ADMIN,
    hidden: true,
  },
];

/** Admin tabs visible to the current environment. */
export function getAdminTabPages(): AdminTabPage[] {
  return ADMIN_TAB_PAGES;
}
