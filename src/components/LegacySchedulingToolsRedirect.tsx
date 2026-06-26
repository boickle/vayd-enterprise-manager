import { Navigate, useLocation } from 'react-router-dom';

/** Old bookmarks under `/scheduling-tools/*` → `/schedule/scheduling-tools/*`. */
export default function LegacySchedulingToolsRedirect() {
  const { pathname } = useLocation();
  const rest = pathname.replace(/^\/scheduling-tools\/?/, '') || 'schedule-loader';
  if (rest === 'appointments' || rest.startsWith('appointments/')) {
    const suffix = rest.replace(/^appointments\/?/, '');
    return (
      <Navigate
        to={`/schedule/appointments/${suffix || 'requests'}`}
        replace
      />
    );
  }
  return <Navigate to={`/schedule/scheduling-tools/${rest}`} replace />;
}
