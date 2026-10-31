import { Link } from 'react-router';
import { ShieldCheck } from 'lucide-react';
import type { TaskDetail } from '../../api/tasks';

type Props = {
  task: TaskDetail;
  patientId: number | null;
  patientName?: string | null;
};

/**
 * The work is opening the chart and running "Owner paid — refund visit".
 * Chart notes stay under the fold.
 */
export default function VisitRefundTaskPanel({ task, patientId, patientName }: Props) {
  const who = patientName?.trim() || 'this pet';
  const amount = task.body?.match(/about \$[\d,]+(?:\.\d{2})?/)?.[0] ?? null;
  const to =
    patientId != null
      ? `/schedule/patients?patientId=${encodeURIComponent(String(patientId))}&focus=membership`
      : null;

  return (
    <section className="pims-fb-task" aria-label="Refund the visit">
      <p className="pims-fb-task__lead">
        {`${who}'s owner enrolled online after the visit`}
        {amount ? ` (${amount} back for the covered part)` : ''}. Open the chart and use{' '}
        <strong>Owner paid — refund visit</strong> on Membership. That asks you to confirm, then
        shows the visit at member prices. Nothing is refunded until you confirm the amount. There
        is no deadline — this refund has to happen. The task closes itself once anyone runs it.
      </p>
      {to ? (
        <div className="pims-fb-task__actions">
          <Link className="pims-task-detail__btn pims-task-detail__btn--primary" to={to}>
            <ShieldCheck size={16} />
            {`Open ${who}'s chart`}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
