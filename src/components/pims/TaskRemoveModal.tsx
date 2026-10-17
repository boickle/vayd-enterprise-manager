import { useState } from 'react';
import { removeTask, type TaskDetail } from '../../api/tasks';
import './TaskRemoveModal.css';

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const data = (e as { response?: { data?: { message?: string } } }).response?.data;
    if (data && typeof data.message === 'string') return data.message;
  }
  if (e instanceof Error) return e.message;
  return 'Request failed';
}

/** Common enough to be worth one click; anything else goes in the box. */
const QUICK_REASONS = [
  'No longer needed',
  'Handled another way',
  'Created by mistake',
  'Duplicate of another task',
  'Client declined',
];

type Props = {
  task: { id: number; title: string };
  onClose: () => void;
  onRemoved: (updated: TaskDetail) => void;
};

/**
 * Removing is not completing. The work did not happen, and the reason goes on
 * the task's history so the Completed list stays honest about what was actually
 * done versus what the practice decided to let go.
 */
export default function TaskRemoveModal({ task, onClose, onRemoved }: Props) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const text = reason.trim();
    if (!text) {
      setErr('Say why this is being removed.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      onRemoved(await removeTask(task.id, text));
    } catch (e: unknown) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="task-remove-modal__backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="task-remove-modal"
        role="dialog"
        aria-labelledby="task-remove-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="task-remove-modal__head">
          <h2 id="task-remove-title">Remove this task</h2>
          <button
            type="button"
            className="task-remove-modal__close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="task-remove-modal__task-title">{task.title}</p>
        <p className="task-remove-modal__hint">
          This takes it off the board without marking the work done. It stays in
          Completed, labelled Removed, with your reason on the history.
        </p>
        {err && <p className="task-remove-modal__error">{err}</p>}
        <div className="task-remove-modal__quick">
          {QUICK_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              className={`task-remove-modal__chip${
                reason === r ? ' task-remove-modal__chip--on' : ''
              }`}
              disabled={busy}
              onClick={() => setReason(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <label className="task-remove-modal__field">
          <span>Reason (required)</span>
          <textarea
            rows={3}
            value={reason}
            placeholder="Why is this no longer worth doing?"
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
          />
        </label>
        <div className="task-remove-modal__actions">
          <button
            type="button"
            className="task-remove-modal__cancel"
            disabled={busy}
            onClick={onClose}
          >
            Keep it
          </button>
          <button
            type="button"
            className="task-remove-modal__submit"
            disabled={busy || !reason.trim()}
            onClick={() => void submit()}
          >
            {busy ? 'Removing…' : 'Remove task'}
          </button>
        </div>
      </div>
    </div>
  );
}
