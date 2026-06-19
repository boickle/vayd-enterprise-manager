import FillDayPage from './pages/FillDay';
import CareOutreachPage from './pages/CareOutreachPage';
import ForwardBookingPage from './pages/ForwardBookingPage';
import {
  SCHEDULING_TOOL_TABS,
  SCHEDULING_WORKFLOW_TABS,
  type SchedulingToolTab,
  type SchedulingWorkflowTab,
} from './scheduling-tools-nav';

export type SchedulingToolsTabPage = {
  path: string;
  label: string;
  element: JSX.Element;
};

function ForwardBookingOnHoldPage() {
  return (
    <ForwardBookingPage
      fixedStatusFilter="onHold"
      pageTitle="On hold"
      pageDescription="Visits placed on hold from schedule loader, care outreach, or forward booking."
    />
  );
}

function ForwardBookingBookedPage() {
  return (
    <ForwardBookingPage
      fixedStatusFilter="booked"
      pageTitle="Booked"
      pageDescription="Scheduled follow-up visits awaiting staff follow-up."
    />
  );
}

function ForwardBookingCompletePage() {
  return (
    <ForwardBookingPage
      fixedStatusFilter="complete"
      pageTitle="Complete"
      pageDescription="Follow-ups marked finished from any scheduling tool."
    />
  );
}

const WORKFLOW_PAGE_BY_PATH: Record<string, JSX.Element> = {
  'on-hold': <ForwardBookingOnHoldPage />,
  booked: <ForwardBookingBookedPage />,
  complete: <ForwardBookingCompletePage />,
};

export const SCHEDULING_TOOLS_TAB_PAGES: SchedulingToolsTabPage[] = [
  ...SCHEDULING_TOOL_TABS.map((tab: SchedulingToolTab) => ({
    path: tab.path,
    label: tab.label,
    element:
      tab.path === 'schedule-loader' ? (
        <FillDayPage />
      ) : tab.path === 'care-outreach' ? (
        <CareOutreachPage />
      ) : (
        <ForwardBookingPage />
      ),
  })),
  ...SCHEDULING_WORKFLOW_TABS.map((tab: SchedulingWorkflowTab) => ({
    path: tab.path,
    label: tab.label,
    element: WORKFLOW_PAGE_BY_PATH[tab.path] ?? <ForwardBookingPage />,
  })),
];

export function getSchedulingToolsTabPages(): SchedulingToolsTabPage[] {
  return SCHEDULING_TOOLS_TAB_PAGES;
}

export { SCHEDULING_TOOL_TABS, SCHEDULING_WORKFLOW_TABS };
