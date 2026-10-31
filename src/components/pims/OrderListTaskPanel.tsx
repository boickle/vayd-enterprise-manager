import { Link } from 'react-router';
import { CheckCircle2, ExternalLink } from 'lucide-react';
import { completeTask, type TaskDetail } from '../../api/tasks';
import {
  isOrderListAutomationTask,
  orderListItemLines,
  orderListPath,
} from '../../utils/orderListTask';

type Props = {
  task: TaskDetail;
  branchName?: string | null;
  canMutate: boolean;
  busy?: boolean;
  onDone: () => void;
};

export default function OrderListTaskPanel({
  task,
  branchName,
  canMutate,
  busy = false,
  onDone,
}: Props) {
  if (!isOrderListAutomationTask(task)) return null;

  const items = orderListItemLines(task.body);
  const branchId = task.branchIds?.[0] ?? null;
  const office = branchName?.trim() || 'this office';

  /** The order went in. That is the work, so this is a real completion. */
  const markOrdered = async () => {
    if (task.status !== 'done') await completeTask(task.id);
    onDone();
  };

  return (
    <section className="pims-order-list-task" aria-label="Order list">
      <p className="pims-order-list-task__lead">
        These items are on the {office} order list. Nothing to chart — place the order,
        then mark it ordered. It also clears itself once the office order list is empty.
      </p>
      {items.length > 0 ? (
        <ul className="pims-order-list-task__items">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      <div className="pims-order-list-task__actions">
        <Link className="pims-task-detail__btn pims-task-detail__btn--primary" to={orderListPath(branchId)}>
          <ExternalLink size={16} />
          Open {office} order list
        </Link>
        {canMutate ? (
          <button
            type="button"
            className="pims-task-detail__btn pims-task-detail__btn--secondary"
            disabled={busy}
            onClick={() => void markOrdered()}
          >
            <CheckCircle2 size={16} />
            Mark ordered
          </button>
        ) : null}
      </div>
    </section>
  );
}
