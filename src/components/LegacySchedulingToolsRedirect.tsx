import { Navigate, useLocation } from 'react-router-dom';

/** Old bookmarks under `/scheduling-tools/*` → `/schedule/scheduling-tools/*`. */
export default function LegacySchedulingToolsRedirect() {
  const { pathname } = useLocation();
  const rest = pathname.replace(/^\/scheduling-tools\/?/, '') || 'schedule-loader';
  return <Navigate to={`/schedule/scheduling-tools/${rest}`} replace />;
}
