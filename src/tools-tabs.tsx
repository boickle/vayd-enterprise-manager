// Sub-routes under /tools (mirrors admin-tabs pattern).
import type { JSX } from 'react';
import ExitSurveyPage from './pages/ExitSurveyPage';

export const EXIT_SURVEY_PATH = '/schedule/exit-survey';

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
