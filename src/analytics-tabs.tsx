// Analytics sub-tabs: path is relative to /analytics.
import PaymentsAnalyticsPage from './pages/PaymentAnalytics';
import VeterinaryServicesDeliveredPage from './pages/VeterinaryServicesDelivered';
import TimeSpentAnalyticsPage from './pages/TimeSpentAnalytics';
import RoutingAnalyticsPage from './pages/RoutingAnalytics';

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
  { path: 'routing', label: 'Routing', element: <RoutingAnalyticsPage />, role: ['admin', 'superadmin'] },
];

export function getAnalyticsTabPages(): AnalyticsTabPage[] {
  return ANALYTICS_TAB_PAGES;
}
