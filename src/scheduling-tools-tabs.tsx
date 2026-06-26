import { Navigate } from 'react-router-dom';
import FillDayPage from './pages/FillDay';
import CareOutreachPage from './pages/CareOutreachPage';
import ForwardBookingPage from './pages/ForwardBookingPage';
import TextedOffersPage from './pages/TextedOffersPage';
import {
  LEGACY_WORKFLOW_STATUS_BY_PATH,
  SCHEDULING_TOOLS_PATH_PREFIX,
  SCHEDULING_TOOL_OUTREACH_TABS,
  SCHEDULING_TOOL_TABS,
  SCHEDULING_TOOL_WORKFLOW_TABS,
  bookedListPath,
  type SchedulingToolTab,
} from './scheduling-tools-nav';

export type SchedulingToolsTabPage = {
  path: string;
  label: string;
  element: JSX.Element;
};

function elementForTab(path: string): JSX.Element {
  switch (path) {
    case 'schedule-loader':
      return <FillDayPage />;
    case 'care-outreach':
      return <CareOutreachPage />;
    case 'texted-offers':
      return <TextedOffersPage />;
    case 'forward-booking':
      return <ForwardBookingPage />;
    case 'on-hold':
      return <ForwardBookingPage variant="onHold" />;
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
