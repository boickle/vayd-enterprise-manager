// Admin sub-tabs: path is relative to /admin. Kept in a separate file to avoid circular import (Admin.tsx imports this; app-pages imports Admin).
import type { JSX } from 'react';
import MembershipPromotionsPage from './pages/MembershipPromotions';
import AppointmentRequestPromotionsPage from './pages/AppointmentRequestPromotions';
import OpenPhoneCoaching from './pages/OpenPhoneCoaching';
import SurveyResults from './pages/SurveyResults';
import AdminUsers from './pages/AdminUsers';
import RoutingScoreThresholdsPage from './pages/RoutingScoreThresholds';
import { getFrontendPaymentProvider } from './config/paymentProvider';
import { isQuoPhoneProvider } from './config/phoneProvider';

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
  {
    path: 'users',
    label: 'Users',
    element: <AdminUsers />,
    role: ['admin', 'superadmin'],
  },
  {
    path: 'membership-promotions',
    label: 'Promotions',
    element: <MembershipPromotionsPage />,
    role: ['admin', 'superadmin'],
  },
  {
    path: 'appointment-request-promotions',
    label: 'Appt Request Promotions',
    element: <AppointmentRequestPromotionsPage />,
    role: ['admin', 'superadmin'],
  },
  {
    path: 'routing-score-thresholds',
    label: 'Routing Score Thresholds',
    element: <RoutingScoreThresholdsPage />,
    role: ['admin', 'superadmin'],
  },
];

/** Admin tabs visible to the current environment. */
export function getAdminTabPages(): AdminTabPage[] {
  const stripeOnlyPaths = new Set(['membership-promotions']);
  const quoOnlyPaths = new Set(['open-phone-coaching']);
  const useStripe = getFrontendPaymentProvider() === 'stripe';
  const useQuo = isQuoPhoneProvider();
  return ADMIN_TAB_PAGES.filter((tab) => {
    if (!useStripe && stripeOnlyPaths.has(tab.path)) return false;
    if (!useQuo && quoOnlyPaths.has(tab.path)) return false;
    return true;
  });
}
