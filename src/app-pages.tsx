// src/app-pages.ts
import Routing from './pages/Routing';
import DoctorDay from './pages/DoctorDay';
import CreateUser from './pages/CreateUser';
import PaymentsAnalyticsPage from './pages/PaymentAnalytics';
import DoctorRevenueAnalyticsPage from './pages/DoctorRevenueAnalytics';
import MyMonth from './pages/MyMonth.';
import MyDayToggle from './pages/MyDayToggle';
import FillDayPage from './pages/FillDay';
import Settings from './pages/Settings';
import SurveyResponsesPage from './pages/SurveyResponses';
import SurveyResults from './pages/SurveyResults';
import Admin from './pages/Admin';

export type AppPage = {
  path: string;
  label: string;
  element: JSX.Element;
  permission?: string;
  icon?: React.ReactNode;
  role?: string | string[];
  /** If false, page is only reachable via Admin tab (not in main tab bar). Default true. */
  showInMainTabs?: boolean;
};

/** Admin tab config: path is relative to /admin (e.g. 'settings', 'survey/results'). */
export type AdminTabPage = {
  path: string;
  label: string;
  element: JSX.Element;
  role?: string | string[];
};

export const ADMIN_TAB_PAGES: AdminTabPage[] = [
  { path: 'settings', label: 'Settings', element: <Settings />, role: ['admin', 'superadmin'] },
  { path: 'survey/results', label: 'Survey Results', element: <SurveyResults />, role: ['admin', 'superadmin'] },
  { path: 'users/create', label: 'Create User', element: <CreateUser />, role: 'superadmin' },
  { path: 'analytics/payments', label: 'Payments Analytics', element: <PaymentsAnalyticsPage />, role: ['admin', 'superadmin'] },
  { path: 'analytics/revenue/doctor', label: 'Doctor Revenue Analytics', element: <DoctorRevenueAnalyticsPage />, role: ['admin'] },
];

function matchesRole(required: AppPage['role'], userRoles?: string[]) {
  if (!required) return true; // no role requirement
  if (!userRoles || userRoles.length === 0) return false;
  if (userRoles.includes('superadmin')) return true; // superadmin sees all
  const need = Array.isArray(required) ? required : [required];
  return need.some((r) => userRoles.includes(String(r)));
}

export function getAccessiblePages(abilities?: string[], roles?: string[]): AppPage[] {
  const all: AppPage[] = [
    {
      path: '/routing',
      label: 'Routing',
      element: <Routing />,
      permission: 'canSeeRouting',
      role: ['employee', 'admin'],
    },
    {
      path: '/doctor',
      label: 'My Day',
      element: <MyDayToggle />,
      permission: 'canSeeDoctorDay',
      role: ['employee', 'admin'],
    },
    {
      path: '/doctormonth',
      label: 'My Month',
      element: <MyMonth />,
      permission: 'canSeeDoctorMonth',
      role: ['employee', 'admin'],
    },
    {
      path: '/admin',
      label: 'Admin',
      element: <Admin />,
      role: ['admin', 'superadmin'],
      showInMainTabs: true,
    },
    {
      path: '/schedule-loader',
      label: 'Schedule Loader',
      element: <FillDayPage />,
      role: ['employee', 'admin', 'superadmin'],
    },
    {
      path: '/survey/responses',
      label: 'Survey Responses',
      element: <SurveyResponsesPage />,
      role: ['admin', 'superadmin'],
      showInMainTabs: false,
    },
  ];

  // If abilities are undefined, treat permission check as passing.
  const permissionOk = (perm?: string) =>
    !perm || (Array.isArray(abilities) ? abilities.includes(perm) : true);

  return all.filter((p) => permissionOk(p.permission) && matchesRole(p.role, roles));
}
