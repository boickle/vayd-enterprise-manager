import Routing from './Routing';
import Scheduler from './Scheduler';
import './RoutingCalendarWorkspace.css';

/**
 * Routing + practice calendar side by side. Routing keeps its own React state; the calendar
 * is a separate Scheduler instance from `/schedule/scheduler`. Preview sync uses sessionStorage + a window event.
 */
export default function RoutingCalendarWorkspace() {
  return (
    <div className="schedule-routing-workspace">
      <div className="schedule-routing-workspace__routing">
        <div className="schedule-routing-workspace__routing-inner">
          <Routing calendarWorkspaceMode />
        </div>
      </div>
      <div className="schedule-routing-workspace__calendar">
        <Scheduler embedInRoutingWorkspace />
      </div>
    </div>
  );
}
