// Admin sub-tabs: path is relative to /admin. Kept in a separate file to avoid circular import (Admin.tsx imports this; app-pages imports Admin).
import CreateUser from './pages/CreateUser';
import MembershipPromotionsPage from './pages/MembershipPromotions';
import OpenPhoneCoaching from './pages/OpenPhoneCoaching';
import SurveyResults from './pages/SurveyResults';
import { getFrontendPaymentProvider } from './config/paymentProvider';
import { isProduction } from './utils/env';

export type AdminTabPage = {
  path: string;
  label: string;
  element: JSX.Element;
  role?: string | string[];
};

export const ADMIN_TAB_PAGES: AdminTabPage[] = [
  {
    path: 'survey/results',
    label: 'Survey Results',
    element: <SurveyResults />,
    role: ['admin', 'superadmin'],
  },
  {
    path: 'open-phone-coaching',
    label: 'Open Phone Coaching',
    element: <OpenPhoneCoaching />,
    role: ['admin', 'superadmin'],
  },
  { path: 'users/create', label: 'Create User', element: <CreateUser />, role: 'superadmin' },
  {
    path: 'membership-promotions',
    label: 'Promotions',
    element: <MembershipPromotionsPage />,
    role: ['admin', 'superadmin'],
  },
];

/** Admin tabs visible to the current environment. Create User is hidden in non-production. */
export function getAdminTabPages(): AdminTabPage[] {
  const stripeOnlyPaths = new Set(['membership-promotions']);
  const useStripe = getFrontendPaymentProvider() === 'stripe';
  let tabs = ADMIN_TAB_PAGES.filter((tab) => useStripe || !stripeOnlyPaths.has(tab.path));
  if (isProduction()) return tabs;
  return tabs.filter((tab) => tab.path !== 'users/create');
}
