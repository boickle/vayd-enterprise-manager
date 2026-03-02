// Analytics sub-tabs: path is relative to /analytics.
import PaymentsAnalyticsPage from './pages/PaymentAnalytics';
import VeterinaryServicesDeliveredPage from './pages/VeterinaryServicesDelivered';

export type AnalyticsTabPage = {
  path: string;
  label: string;
  element: JSX.Element;
  role?: string | string[];
};

export const ANALYTICS_TAB_PAGES: AnalyticsTabPage[] = [
  { path: 'payments', label: 'Payments', element: <PaymentsAnalyticsPage />, role: ['admin', 'superadmin'] },
  { path: 'vsd', label: 'Veterinary Services Delivered', element: <VeterinaryServicesDeliveredPage />, role: ['employee', 'admin', 'superadmin'] },
];

export function getAnalyticsTabPages(): AnalyticsTabPage[] {
  return ANALYTICS_TAB_PAGES;
}
