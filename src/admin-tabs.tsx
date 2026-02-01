// Admin sub-tabs: path is relative to /admin. Kept in a separate file to avoid circular import (Admin.tsx imports this; app-pages imports Admin).
import CreateUser from './pages/CreateUser';
import PaymentsAnalyticsPage from './pages/PaymentAnalytics';
import OpsAnalyticsPage from './pages/OpsAnalytics';
import DoctorRevenueAnalyticsPage from './pages/DoctorRevenueAnalytics';
import AuditAdminPage from './pages/AuditAdmin';
import SimResults from './pages/SimResults';
import SurveyResults from './pages/SurveyResults';

export type AdminTabPage = {
  path: string;
  label: string;
  element: JSX.Element;
  role?: string | string[];
};

export const ADMIN_TAB_PAGES: AdminTabPage[] = [
  { path: 'survey/results', label: 'Survey Results', element: <SurveyResults />, role: ['admin', 'superadmin'] },
  { path: 'users/create', label: 'Create User', element: <CreateUser />, role: 'superadmin' },
  { path: 'analytics/payments', label: 'Payments Analytics', element: <PaymentsAnalyticsPage />, role: ['admin', 'superadmin'] },
  { path: 'analytics/ops', label: 'Ops Analytics', element: <OpsAnalyticsPage />, role: ['admin'] },
  { path: 'analytics/revenue/doctor', label: 'Doctor Revenue Analytics', element: <DoctorRevenueAnalyticsPage />, role: ['admin'] },
  { path: 'audit', label: 'Super Admin Audit', element: <AuditAdminPage />, role: 'superadmin' },
  { path: 'simulation', label: 'Simulate Routing', element: <SimResults />, role: 'superadmin' },
];
