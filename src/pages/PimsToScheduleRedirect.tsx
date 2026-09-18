import { Navigate, useLocation } from 'react-router';

// Legacy /pims URLs kept working after the PIMS pages moved into the schedule shell,
// so bookmarks and older links land on the equivalent page instead of a dead route.
const RENAMED_PATHS: Record<string, string> = {
  '': '/schedule',
  overview: '/schedule/home',
  inventory: '/schedule/inventory/items',
  labs: '/schedule/inventory/items?type=lab',
  'reports/summary': '/schedule/analytics',
  'reports/activity': '/schedule/analytics',
  'settings/practice': '/schedule/settings',
  'settings/users': '/schedule/settings',
};

export default function PimsToScheduleRedirect() {
  const { pathname, search, hash } = useLocation();
  const rest = pathname.replace(/^\/pims\/?/, '').replace(/\/+$/, '');
  const to = RENAMED_PATHS[rest] ?? `/schedule/${rest}`;
  const q = to.indexOf('?');
  const destPath = q < 0 ? to : to.slice(0, q);
  const destSearch = q < 0 ? search : to.slice(q);
  return <Navigate to={{ pathname: destPath, search: destSearch, hash }} replace />;
}
