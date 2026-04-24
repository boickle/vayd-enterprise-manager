// Analytics sub-tabs: path is relative to /analytics.
// VSD and Time Spent are lazy-loaded so the spinner shows immediately when switching tabs.
import React from 'react';
import PaymentsAnalyticsPage from './pages/PaymentAnalytics';
import RoutingAnalyticsPage from './pages/RoutingAnalytics';

const VeterinaryServicesDeliveredPage = React.lazy(
  () => import('./pages/VeterinaryServicesDelivered')
);
const TimeSpentAnalyticsPage = React.lazy(() => import('./pages/TimeSpentAnalytics'));
const SquareReconciliationPage = React.lazy(() => import('./pages/SquareReconciliation'));
const OpenPhoneCallsAnalyticsPage = React.lazy(() => import('./pages/OpenPhoneCallsAnalytics'));
const MembershipPurchasesAnalyticsPage = React.lazy(
  () => import('./pages/MembershipPurchasesAnalytics')
);
const CancellationsAnalyticsPage = React.lazy(() => import('./pages/CancellationsAnalytics'));
const PatientDormancyAnalyticsPage = React.lazy(() => import('./pages/PatientDormancyAnalytics'));
const RoomLoaderPlanVsVisitAnalyticsPage = React.lazy(
  () => import('./pages/RoomLoaderPlanVsVisitAnalytics')
);

export type AnalyticsTabPage = {
  path: string;
  label: string;
  element: JSX.Element;
  role?: string | string[];
};

export const ANALYTICS_TAB_PAGES: AnalyticsTabPage[] = [
  {
    path: 'payments',
    label: 'Payments',
    element: <PaymentsAnalyticsPage />,
    role: ['employee', 'admin', 'superadmin'],
  },
  {
    path: 'vsd',
    label: 'Veterinary Services Delivered',
    element: <VeterinaryServicesDeliveredPage />,
    role: ['employee', 'admin', 'superadmin'],
  },
  {
    path: 'time-spent',
    label: 'Time Spent',
    element: <TimeSpentAnalyticsPage />,
    role: ['employee', 'admin', 'superadmin'],
  },
  {
    path: 'appointments',
    label: 'Appointments',
    element: <RoutingAnalyticsPage />,
    role: ['employee', 'admin', 'superadmin'],
  },
  {
    path: 'cancellations',
    label: 'Cancellations',
    element: <CancellationsAnalyticsPage />,
    role: ['employee', 'admin', 'superadmin'],
  },
  {
    path: 'square-reconciliation',
    label: 'Square Reconciliation',
    element: <SquareReconciliationPage />,
    role: ['superadmin'],
  },
  {
    path: 'openphone-calls',
    label: 'OpenPhone Calls',
    element: <OpenPhoneCallsAnalyticsPage />,
    role: ['employee', 'admin', 'superadmin'],
  },
  {
    path: 'memberships',
    label: 'Memberships',
    element: <MembershipPurchasesAnalyticsPage />,
    role: ['employee', 'admin', 'superadmin'],
  },
  {
    path: 'patient-dormancy',
    label: 'Patient Dormancy',
    element: <PatientDormancyAnalyticsPage />,
    role: ['employee', 'admin', 'superadmin'],
  },
  {
    path: 'room-loader-plan-vs-visit',
    label: 'Room Loader analytics',
    element: <RoomLoaderPlanVsVisitAnalyticsPage />,
    role: ['employee', 'admin', 'superadmin'],
  },
];

export function getAnalyticsTabPages(): AnalyticsTabPage[] {
  return ANALYTICS_TAB_PAGES;
}
