// Sub-routes under /tools (mirrors admin-tabs pattern).
import CareOutreachPage from './pages/CareOutreachPage';
import ExitSurveyPage from './pages/ExitSurveyPage';

export type ToolsTabPage = {
  path: string;
  label: string;
  element: JSX.Element;
};

export const TOOLS_TAB_PAGES: ToolsTabPage[] = [
  {
    path: 'care-outreach',
    label: 'Care Outreach',
    element: <CareOutreachPage />,
  },
  {
    path: 'exit-survey',
    label: 'Exit Survey',
    element: <ExitSurveyPage />,
  },
];

export function getToolsTabPages(): ToolsTabPage[] {
  return TOOLS_TAB_PAGES;
}
