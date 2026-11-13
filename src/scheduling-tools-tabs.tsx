import type { JSX } from 'react';
import { Navigate, useLocation } from 'react-router';
import FillDayPage from './pages/FillDay';
import WaitlistPage from './pages/WaitlistPage';
import CareOutreachPage from './pages/CareOutreachPage';
import ForwardBookingPage from './pages/ForwardBookingPage';
import TextedOffersPage from './pages/TextedOffersPage';
import ScheduleOptimizationPage from './pages/ScheduleOptimizationPage';
import { HOLDS_PATH } from './holds-nav';
import { RECORDS_PATH } from './records-nav';
import {
  LEGACY_WORKFLOW_STATUS_BY_PATH,
  SCHEDULING_TOOLS_PATH_PREFIX,
  SCHEDULING_TOOL_TABS,
  bookedListPath,
  type SchedulingToolTab,
} from './scheduling-tools-nav';

function LegacyRecordsRedirect() {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: RECORDS_PATH, search, hash }} replace />;
}

export type SchedulingToolsTabPage = {
  path: string;
  label: string;
  element: JSX.Element;
};

function elementForTab(path: string): JSX.Element {
  switch (path) {
    case 'schedule-loader':
      return <FillDayPage />;
    case 'waitlist':
      return <WaitlistPage />;
    case 'schedule-optimization':
      return <ScheduleOptimizationPage />;
    case 'care-outreach':
      return <CareOutreachPage />;
    case 'texted-offers':
      return <TextedOffersPage />;
    case 'forward-booking':
      return <ForwardBookingPage />;
    case 'booked':
      return <ForwardBookingPage variant="booked" />;
    default:
      return <ForwardBookingPage />;
  }
}

export const SCHEDULING_TOOLS_TAB_PAGES: SchedulingToolsTabPage[] = [
  ...SCHEDULING_TOOL_TABS.map((tab: SchedulingToolTab) => ({
    path: tab.path,
    label: tab.label,
    element: elementForTab(tab.path),
  })),
  // Records moved to Scheduling → Records (Nov 13, 2026); old links keep their search.
  {
    path: 'records',
    label: 'Records',
    element: <LegacyRecordsRedirect />,
  },
  // Legacy On hold route — holds board lives at /schedule/holds.
  {
    path: 'on-hold',
    label: 'On hold',
    element: <Navigate to={HOLDS_PATH} replace />,
  },
  // Legacy Booked / Complete routes redirect into top-level Booked or Forward booking.
  ...Object.entries(LEGACY_WORKFLOW_STATUS_BY_PATH).map(([path, status]) => ({
    path,
    label: status,
    element: (
      <Navigate
        to={
          status === 'booked'
            ? bookedListPath()
            : `${SCHEDULING_TOOLS_PATH_PREFIX}/forward-booking`
        }
        replace
      />
    ),
  })),
];

export function getSchedulingToolsTabPages(): SchedulingToolsTabPage[] {
  return SCHEDULING_TOOLS_TAB_PAGES;
}

export { SCHEDULING_TOOL_TABS };
