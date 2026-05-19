// src/app-pages.ts
import { isProduction } from './utils/env';
import CreateUser from './pages/CreateUser';
import Admin from './pages/Admin';
import Analytics from './pages/Analytics';
import Settings from './pages/Settings';
import ScheduleLayout from './pages/ScheduleLayout';
import SurveyResponsesPage from './pages/SurveyResponses';
import SurveyResults from './pages/SurveyResults';
import Tools from './pages/Tools';
import PimsLayout from './pages/PimsLayout';

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
      path: '/schedule',
      label: 'Schedule',
      element: <ScheduleLayout />,
      role: ['employee', 'admin', 'superadmin'],
      showInMainTabs: false,
    },
    {
      path: '/admin',
      label: 'Admin',
      element: <Admin />,
      role: ['admin', 'superadmin'],
      showInMainTabs: false,
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
      path: '/analytics',
      label: 'Analytics',
      element: <Analytics />,
      role: ['employee', 'admin', 'superadmin'],
      showInMainTabs: false,
    },
    {
      path: '/pims',
      label: 'PIMS',
      element: <PimsLayout />,
      role: ['employee', 'admin', 'superadmin'],
      showInMainTabs: false,
    },
    {
      path: '/tools',
      label: 'Tools',
      element: <Tools />,
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

  const filtered = all.filter((p) => permissionOk(p.permission) && matchesRole(p.role, roles));
  // Hide Create User page in non-production
  if (!isProduction()) {
    return filtered.filter((p) => p.path !== '/users/create');
  }
  return filtered;
}
