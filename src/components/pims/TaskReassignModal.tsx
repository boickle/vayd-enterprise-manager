import { useState } from 'react';
import { patchTask, type TaskDetail, type TaskListItem } from '../../api/tasks';
import type { Employee } from '../../api/appointmentSettings';
import { formatEmployeeDisplayName } from '../../utils/employeeDisplayName';
import './TaskReassignModal.css';

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const data = (e as { response?: { data?: { message?: string } } }).response?.data;
    if (data && typeof data.message === 'string') return data.message;
  }
  if (e instanceof Error) return e.message;
  return 'Request failed';
}

type TaskReassignTarget = Pick<TaskListItem, 'id' | 'title' | 'assignedToEmployeeId'>;

type Props = {
  task: TaskReassignTarget;
  employees: Employee[];
  onClose: () => void;
  onSaved: (updated: TaskDetail) => void;
};

export default function TaskReassignModal({ task, employees, onClose, onSaved }: Props) {
  const [toId, setToId] = useState<string>(
    task.assignedToEmployeeId != null ? String(task.assignedToEmployeeId) : '',
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    const id = toId === '' ? null : Number(toId);
    if (toId !== '' && !Number.isFinite(id)) {
      setErr('Pick a valid assignee');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const updated = await patchTask(task.id, { assignedToEmployeeId: id });
      onSaved(updated);
    } catch (e: unknown) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="task-reassign-modal__backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="task-reassign-modal"
        role="dialog"
        aria-labelledby="task-reassign-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="task-reassign-modal__head">
          <h2 id="task-reassign-title">Reassign</h2>
          <button type="button" className="task-reassign-modal__close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="task-reassign-modal__task-title">{task.title}</p>
        {err && <p className="task-reassign-modal__error">{err}</p>}
        <label className="task-reassign-modal__field">
          <span>Assign to</span>
          <select value={toId} onChange={(e) => setToId(e.target.value)} disabled={busy}>
            <option value="">Queue (unassigned)</option>
            {employees.map((em) => (
              <option key={em.id} value={String(em.id)}>
                {formatEmployeeDisplayName(em) || em.email}
              </option>
            ))}
          </select>
        </label>
        <div className="task-reassign-modal__actions">
          <button type="button" className="task-reassign-modal__cancel" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="task-reassign-modal__submit" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
