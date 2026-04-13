// Analytics sub-tabs: path is relative to /analytics.
// VSD and Time Spent are lazy-loaded so the spinner shows immediately when switching tabs.
import React from 'react';
import PaymentsAnalyticsPage from './pages/PaymentAnalytics';
import RoutingAnalyticsPage from './pages/RoutingAnalytics';

const VeterinaryServicesDeliveredPage = React.lazy(
  () => import('./pages/VeterinaryServicesDelivered')
);
const TimeSpentAnalyticsPage = React.lazy(
  () => import('./pages/TimeSpentAnalytics')
);
const SquareReconciliationPage = React.lazy(
  () => import('./pages/SquareReconciliation')
);
const OpenPhoneCallsAnalyticsPage = React.lazy(
  () => import('./pages/OpenPhoneCallsAnalytics')
);
const MembershipPurchasesAnalyticsPage = React.lazy(
  () => import('./pages/MembershipPurchasesAnalytics')
);

export type AnalyticsTabPage = {
  path: string;
  label: string;
  element: JSX.Element;
  role?: string | string[];
};

export const ANALYTICS_TAB_PAGES: AnalyticsTabPage[] = [
  { path: 'payments', label: 'Payments', element: <PaymentsAnalyticsPage />, role: ['admin', 'superadmin'] },
  { path: 'vsd', label: 'Veterinary Services Delivered', element: <VeterinaryServicesDeliveredPage />, role: ['admin', 'superadmin'] },
  { path: 'time-spent', label: 'Time Spent', element: <TimeSpentAnalyticsPage />, role: ['admin', 'superadmin'] },
  { path: 'appointments', label: 'Appointments', element: <RoutingAnalyticsPage />, role: ['admin', 'superadmin'] },
  { path: 'square-reconciliation', label: 'Square Reconciliation', element: <SquareReconciliationPage />, role: ['superadmin'] },
  { path: 'openphone-calls', label: 'OpenPhone Calls', element: <OpenPhoneCallsAnalyticsPage />, role: ['admin', 'superadmin'] },
  { path: 'memberships', label: 'Memberships', element: <MembershipPurchasesAnalyticsPage />, role: ['admin', 'superadmin'] },
];

export function getAnalyticsTabPages(): AnalyticsTabPage[] {
  return ANALYTICS_TAB_PAGES;
}
