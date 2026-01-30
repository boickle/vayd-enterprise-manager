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

// src/app-pages.ts
export type AppPage = {
  path: string;
  label: string;
  element: JSX.Element;
  permission?: string;
  icon?: React.ReactNode;
  role?: string | string[];
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
      path: '/users/create',
      label: 'Create User',
      element: <CreateUser />,
      permission: 'canManageUsers',
      role: ['superadmin'],
    },
    {
      path: '/analytics/payments',
      label: 'Payments Analytics',
      element: <PaymentsAnalyticsPage />,
      permission: 'canSeePaymentsAnalytics',
      role: ['admin', 'superadmin'],
    },
    {
      path: '/analytics/ops',
      label: 'Ops Analytics',
      element: <OpsAnalyticsPage />,
      permission: 'canSeeOpsAnalytics',
      role: ['admin'],
    },
    {
      path: '/analytics/revenue/doctor',
      label: 'Doctor Revenue Analytics',
      element: <DoctorRevenueAnalyticsPage />,
      permission: 'canSeeDoctorAnalytics',
      role: ['admin'],
    },
    {
      path: '/audit',
      label: 'Super Admin Audit',
      element: <AuditAdminPage />,
      permission: 'superadmin',
      role: 'superadmin',
    },
    {
      path: '/simulation',
      label: 'Simulate Routing',
      element: <SimResults />,
      permission: 'superadmin',
      role: 'superadmin',
    },
    {
      path: '/schedule-loader',
      label: 'Schedule Loader',
      element: <FillDayPage />,
      role: ['employee', 'admin', 'superadmin'],
    },
    {
      path: '/settings',
      label: 'Settings',
      element: <Settings />,
      role: ['admin', 'superadmin'],
    },
  ];

  // If abilities are undefined, treat permission check as passing.
  const permissionOk = (perm?: string) =>
    !perm || (Array.isArray(abilities) ? abilities.includes(perm) : true);

  return all.filter((p) => permissionOk(p.permission) && matchesRole(p.role, roles));
}
