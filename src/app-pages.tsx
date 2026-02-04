// src/app-pages.ts
import Routing from './pages/Routing';
import DoctorDay from './pages/DoctorDay';
import CreateUser from './pages/CreateUser';
import PaymentsAnalyticsPage from './pages/PaymentAnalytics';
import OpsAnalyticsPage from './pages/OpsAnalytics';
import DoctorRevenueAnalyticsPage from './pages/DoctorRevenueAnalytics';
import AuditAdminPage from './pages/AuditAdmin';
import SimResults from './pages/SimResults';
import MyMonth from './pages/MyMonth.';
import MyDayToggle from './pages/MyDayToggle';
import FillDayPage from './pages/FillDay';
import Settings from './pages/Settings';
import RoomLoaderPage from './pages/RoomLoader';
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
      path: '/users/create',
      label: 'Create User',
      element: <CreateUser />,
      permission: 'canManageUsers',
      role: ['superadmin'],
      showInMainTabs: false,
    },
    {
      path: '/analytics/payments',
      label: 'Payments Analytics',
      element: <PaymentsAnalyticsPage />,
      permission: 'canSeePaymentsAnalytics',
      role: ['admin', 'superadmin'],
      showInMainTabs: false,
    },
    {
      path: '/analytics/ops',
      label: 'Ops Analytics',
      element: <OpsAnalyticsPage />,
      permission: 'canSeeOpsAnalytics',
      role: ['admin'],
      showInMainTabs: false,
    },
    {
      path: '/analytics/revenue/doctor',
      label: 'Doctor Revenue Analytics',
      element: <DoctorRevenueAnalyticsPage />,
      permission: 'canSeeDoctorAnalytics',
      role: ['admin'],
      showInMainTabs: false,
    },
    {
      path: '/audit',
      label: 'Super Admin Audit',
      element: <AuditAdminPage />,
      permission: 'superadmin',
      role: 'superadmin',
      showInMainTabs: false,
    },
    {
      path: '/simulation',
      label: 'Simulate Routing',
      element: <SimResults />,
      permission: 'superadmin',
      role: 'superadmin',
      showInMainTabs: false,
    },
    {
      path: '/schedule-loader',
      label: 'Schedule Loader',
      element: <FillDayPage />,
      role: ['employee', 'admin', 'superadmin'],
    },
    {
      path: '/room-loader',
      label: 'Room Loader',
      element: <RoomLoaderPage />,
      role: ['employee', 'admin', 'superadmin'],
    },
    {
      path: '/settings',
      label: 'Settings',
      element: <Settings />,
      role: ['admin', 'superadmin'],
    },
    {
      path: '/survey/responses',
      label: 'Survey Responses',
      element: <SurveyResponsesPage />,
      role: ['admin', 'superadmin'],
      showInMainTabs: false,
    },
    {
      path: '/survey/results',
      label: 'Survey Results',
      element: <SurveyResults />,
      role: ['admin', 'superadmin'],
      showInMainTabs: false,
    },
  ];

  // If abilities are undefined, treat permission check as passing.
  const permissionOk = (perm?: string) =>
    !perm || (Array.isArray(abilities) ? abilities.includes(perm) : true);

  return all.filter((p) => permissionOk(p.permission) && matchesRole(p.role, roles));
}
