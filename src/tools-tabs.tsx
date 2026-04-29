// Sub-routes under /tools (mirrors admin-tabs pattern).
import ExitSurveyPage from './pages/ExitSurveyPage';

export type ToolsTabPage = {
  path: string;
  label: string;
  element: JSX.Element;
};

export const TOOLS_TAB_PAGES: ToolsTabPage[] = [
  {
    path: 'exit-survey',
    label: 'Exit Survey',
    element: <ExitSurveyPage />,
  },
];

export function getToolsTabPages(): ToolsTabPage[] {
  return TOOLS_TAB_PAGES;
}
