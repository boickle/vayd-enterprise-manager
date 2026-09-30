import { Link } from 'react-router';
import { Check, FileText } from 'lucide-react';
import type { TaskDetail } from '../../api/tasks';
import { soapPathFromTaskLinks } from '../../utils/soapTask';

type Props = {
  task: TaskDetail;
  patientName?: string | null;
  canComplete: boolean;
  busy?: boolean;
  onComplete: () => void;
};

/**
 * Unfinished-SOAP automation. The work is opening the visit and signing it —
 * not jotting a chart note on the task. Signing the SOAP closes this row.
 */
export default function SoapTaskPanel({
  task,
  patientName,
  canComplete,
  busy = false,
  onComplete,
}: Props) {
  const to = soapPathFromTaskLinks(task.links);
  if (!to) return null;

  const who = patientName?.trim() || 'this patient';

  return (
    <section className="pims-fb-task" aria-label="Finish SOAP">
      <p className="pims-fb-task__lead">
        This SOAP for {who} is still a draft. Open it to finish and sign. This
        task closes on its own when the chart is signed.
      </p>
      <div className="pims-fb-task__actions">
        <Link className="pims-task-detail__btn pims-task-detail__btn--primary" to={to}>
          <FileText size={16} />
          Open SOAP
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
      {canComplete ? (
        <p className="pims-fb-task__hint">
          Mark complete only if you already signed it. If the SOAP is still a
          draft, a new task comes back after a day.
        </p>
      ) : null}
    </section>
  );
}
