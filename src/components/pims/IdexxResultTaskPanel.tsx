import type { TaskDetail } from '../../api/tasks';
import IdexxResultView from '../idexx/IdexxResultView';

type Props = {
  task: TaskDetail;
  readOnly?: boolean;
  onUpdated: () => void;
};

/** IDEXX results waiting on a doctor. Marking them reviewed closes the task. */
export default function IdexxResultTaskPanel({ task, readOnly = false, onUpdated }: Props) {
  const resultId = task.links?.find((l) => l.entityType === 'idexx_result')?.entityId ?? null;
  if (!resultId) {
    return <p className="idexx-order__note">This task isn&rsquo;t linked to an IDEXX result.</p>;
  }
  return (
    <div style={{ margin: '12px 0' }}>
      <IdexxResultView
        resultId={resultId}
        readOnly={readOnly}
        onReviewedChange={() => onUpdated()}
      />
    </div>
  );
}
