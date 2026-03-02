// Admin sub-tabs: path is relative to /admin. Kept in a separate file to avoid circular import (Admin.tsx imports this; app-pages imports Admin).
import CreateUser from './pages/CreateUser';
import SurveyResults from './pages/SurveyResults';
import { isProduction } from './utils/env';

export type AdminTabPage = {
  path: string;
  label: string;
  element: JSX.Element;
  role?: string | string[];
};

export const ADMIN_TAB_PAGES: AdminTabPage[] = [
  { path: 'survey/results', label: 'Survey Results', element: <SurveyResults />, role: ['admin', 'superadmin'] },
  { path: 'users/create', label: 'Create User', element: <CreateUser />, role: 'superadmin' },
];

/** Admin tabs visible to the current environment. Create User is hidden in non-production. */
export function getAdminTabPages(): AdminTabPage[] {
  if (isProduction()) return ADMIN_TAB_PAGES;
  return ADMIN_TAB_PAGES.filter((tab) => tab.path !== 'users/create');
}
