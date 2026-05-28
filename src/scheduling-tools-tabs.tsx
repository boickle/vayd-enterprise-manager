import FillDayPage from './pages/FillDay';
import CareOutreachPage from './pages/CareOutreachPage';
import ForwardBookingPage from './pages/ForwardBookingPage';

export type SchedulingToolsTabPage = {
  path: string;
  label: string;
  element: JSX.Element;
};

export const SCHEDULING_TOOLS_TAB_PAGES: SchedulingToolsTabPage[] = [
  {
    path: 'schedule-loader',
    label: 'Fill',
    element: <FillDayPage />,
  },
  {
    path: 'care-outreach',
    label: 'Care outreach',
    element: <CareOutreachPage />,
  },
  {
    path: 'forward-booking',
    label: 'Forward booking',
    element: <ForwardBookingPage />,
  },
];

export function getSchedulingToolsTabPages(): SchedulingToolsTabPage[] {
  return SCHEDULING_TOOLS_TAB_PAGES;
}
