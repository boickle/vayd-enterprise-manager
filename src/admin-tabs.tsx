// Admin sub-tabs: path is relative to /admin. Kept in a separate file to avoid circular import (Admin.tsx imports this; app-pages imports Admin).
import type { JSX } from 'react';
import CreateUser from './pages/CreateUser';
import CreateEmployee from './pages/CreateEmployee';
import MembershipPromotionsPage from './pages/MembershipPromotions';
import MembershipManagementPage from './pages/MembershipManagement';
import AppointmentRequestPromotionsPage from './pages/AppointmentRequestPromotions';
import OpenPhoneCoaching from './pages/OpenPhoneCoaching';
import SurveyResults from './pages/SurveyResults';
import { getFrontendPaymentProvider } from './config/paymentProvider';

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
    path: 'users/create-employee',
    label: 'Create Employee',
    element: <CreateEmployee />,
    role: 'superadmin',
  },
  {
    path: 'memberships',
    label: 'Memberships',
    element: <MembershipManagementPage />,
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
];

/** Admin tabs visible to the current environment. */
export function getAdminTabPages(): AdminTabPage[] {
  const stripeOnlyPaths = new Set(['membership-promotions']);
  const useStripe = getFrontendPaymentProvider() === 'stripe';
  return ADMIN_TAB_PAGES.filter((tab) => useStripe || !stripeOnlyPaths.has(tab.path));
}
