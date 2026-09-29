import { Link } from 'react-router';
import { CalendarPlus, Check } from 'lucide-react';
import type { TaskDetail } from '../../api/tasks';
import {
  buildCreateForwardBookingUrl,
  buildTaskForwardBookingReturnPath,
  getForwardBookingPrefillFromTaskLinks,
} from '../../utils/forwardBookingCreateLink';

type Props = {
  task: TaskDetail;
  patientName?: string | null;
  canComplete: boolean;
  busy?: boolean;
  onComplete: () => void;
};

/**
 * Labs-pending / "add to the list" tasks. The work is putting them on the forward
 * booking list — not charting a call. Chart notes stay available under the fold.
 */
export default function ForwardBookingTaskPanel({
  task,
  patientName,
  canComplete,
  busy = false,
  onComplete,
}: Props) {
  const prefill = getForwardBookingPrefillFromTaskLinks(task.links);
  if (!prefill) return null;

  const who = patientName?.trim() || 'this patient';
  const to = buildCreateForwardBookingUrl({
    ...prefill,
    returnTo: buildTaskForwardBookingReturnPath(task.id),
  });

  return (
    <section className="pims-fb-task" aria-label="Add forward booking">
      <p className="pims-fb-task__lead">
        When you are ready, add {who} to the forward booking list. Lab results and
        owner comms can live on another screen — this task is the booking.
      </p>
      <div className="pims-fb-task__actions">
        <Link className="pims-task-detail__btn pims-task-detail__btn--primary" to={to}>
          <CalendarPlus size={16} />
          Add to forward booking list
        </Link>
        {canComplete ? (
          <button
            type="button"
            className="pims-task-detail__btn pims-task-detail__btn--secondary"
            disabled={busy}
            onClick={onComplete}
          >
            <Check size={16} />
            Mark complete
          </button>
        ) : null}
      </div>
    </section>
  );
}
