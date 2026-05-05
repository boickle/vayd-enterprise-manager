import FillDayPage from './pages/FillDay';
import CareOutreachPage from './pages/CareOutreachPage';

export type SchedulingToolsTabPage = {
  path: string;
  label: string;
  element: JSX.Element;
};

export const SCHEDULING_TOOLS_TAB_PAGES: SchedulingToolsTabPage[] = [
  {
    path: 'schedule-loader',
    label: 'Schedule loader',
    element: <FillDayPage />,
  },
  {
    path: 'care-outreach',
    label: 'Care outreach',
    element: <CareOutreachPage />,
  },
];

export function getSchedulingToolsTabPages(): SchedulingToolsTabPage[] {
  return SCHEDULING_TOOLS_TAB_PAGES;
}
