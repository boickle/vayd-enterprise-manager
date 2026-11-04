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
 * Labs-pending tasks. The work is scheduling the follow-up (Schedule follow-ups),
 * not charting a call. Chart notes stay available under the fold.
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
    <section className="pims-fb-task" aria-label="Schedule follow-ups">
      <p className="pims-fb-task__lead">
        When the labs are back, schedule {who}&apos;s follow-up: add {who} to a visit
        already on the books, book a new one, or send it to the CLs. Done closes this task.
      </p>
      <div className="pims-fb-task__actions">
        <Link className="pims-task-detail__btn pims-task-detail__btn--primary" to={to}>
          <CalendarPlus size={16} />
          Schedule follow-ups
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
