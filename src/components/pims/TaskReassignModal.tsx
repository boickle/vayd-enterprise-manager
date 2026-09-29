import { useState } from 'react';
import {
  patchTask,
  reassignFromEmployee,
  type TaskDetail,
  type TaskListItem,
} from '../../api/tasks';
import type { Employee } from '../../api/appointmentSettings';
import { formatEmployeeDisplayName } from '../../utils/employeeDisplayName';
import {
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
  validateTaskScheduleOrder,
} from '../../utils/taskDateTime';
import './TaskReassignModal.css';

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const data = (e as { response?: { data?: { message?: string } } }).response?.data;
    if (data && typeof data.message === 'string') return data.message;
  }
  if (e instanceof Error) return e.message;
  return 'Request failed';
}

type TaskMoveTarget = Pick<
  TaskListItem,
  'id' | 'title' | 'assignedToEmployeeId' | 'startAt' | 'dueAt'
> & { body?: string | null };

type BulkReassign = {
  fromEmployeeId: number;
  taskIds: number[];
  upcomingOnly?: boolean;
  label: string;
};

type Props = {
  task?: TaskMoveTarget;
  bulk?: BulkReassign;
  employees: Employee[];
  /** Vacation / inactivation: must pick a person, not the queue. */
  requireAssignee?: boolean;
  onClose: () => void;
  onSaved: (updated?: TaskDetail) => void;
};

/**
 * Moving a task means changing who owns it, when it starts, when it is due, or
 * any combination. They are the same decision in practice — "this isn't mine
 * until Thursday" — so they share one screen and one button.
 */
export default function TaskReassignModal({
  task,
  bulk,
  employees,
  requireAssignee = false,
  onClose,
  onSaved,
}: Props) {
  const [toId, setToId] = useState<string>(
    !bulk && task?.assignedToEmployeeId != null ? String(task.assignedToEmployeeId) : '',
  );
  const [startLocal, setStartLocal] = useState(() =>
    !bulk && task ? toDatetimeLocalValue(task.startAt) : '',
  );
  const [dueLocal, setDueLocal] = useState(() =>
    !bulk && task ? toDatetimeLocalValue(task.dueAt) : '',
  );
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    const id = toId === '' ? null : Number(toId);
    if (toId !== '' && !Number.isFinite(id)) {
      setErr('Pick a valid assignee');
      return;
    }
    if (requireAssignee && id == null) {
      setErr('Pick who should receive these tasks');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      if (bulk) {
        if (id == null) {
          setErr('Pick who should receive these tasks');
          return;
        }
        await reassignFromEmployee({
          fromEmployeeId: bulk.fromEmployeeId,
          toEmployeeId: id,
          upcomingOnly: bulk.upcomingOnly,
          taskIds: bulk.taskIds,
        });
        onSaved();
        return;
      }
      if (!task) {
        setErr('Nothing to move');
        return;
      }
      const startAt = fromDatetimeLocalValue(startLocal);
      const dueAt = fromDatetimeLocalValue(dueLocal);
      const scheduleErr = validateTaskScheduleOrder(startAt, dueAt);
      if (scheduleErr) {
        setErr(scheduleErr);
        return;
      }
      const extra = note.trim();
      const prior = (task.body ?? '').trim();
      const body = extra
        ? prior
          ? `${prior}\n\nNote when moved:\n${extra}`
          : `Note when moved:\n${extra}`
        : undefined;
      const updated = await patchTask(task.id, {
        assignedToEmployeeId: id,
        startAt,
        dueAt,
        ...(body !== undefined ? { body } : {}),
      });
      onSaved(updated);
    } catch (e: unknown) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  // Bulk only changes the owner — there is no sensible shared due date — so it
  // keeps the narrower name.
  const title = bulk ? 'Re-assign tasks' : 'Move this task';

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
          <h2 id="task-reassign-title">{title}</h2>
          <button type="button" className="task-reassign-modal__close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="task-reassign-modal__task-title">
          {bulk ? bulk.label : task?.title}
        </p>
        {!bulk ? (
          <p className="task-reassign-modal__hint">
            Hand it to someone else, push it to another day, or both. Leave a field
            alone to keep it as it is.
          </p>
        ) : null}
        {err && <p className="task-reassign-modal__error">{err}</p>}
        <label className="task-reassign-modal__field">
          <span>Assign to</span>
          <select value={toId} onChange={(e) => setToId(e.target.value)} disabled={busy}>
            {!requireAssignee && <option value="">Queue (unassigned)</option>}
            {requireAssignee && <option value="">Select a person…</option>}
            {employees.map((em) => (
              <option key={em.id} value={String(em.id)}>
                {formatEmployeeDisplayName(em) || em.email}
              </option>
            ))}
          </select>
        </label>
        {!bulk && (
          <>
            <label className="task-reassign-modal__field">
              <span>Starts</span>
              <input
                type="datetime-local"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
                disabled={busy}
              />
            </label>
            <label className="task-reassign-modal__field">
              <span>Due</span>
              <input
                type="datetime-local"
                value={dueLocal}
                onChange={(e) => setDueLocal(e.target.value)}
                disabled={busy}
              />
            </label>
            <label className="task-reassign-modal__field">
              <span>Note (optional)</span>
              <textarea
                rows={3}
                value={note}
                placeholder="Anything they should know…"
                onChange={(e) => setNote(e.target.value)}
                disabled={busy}
              />
            </label>
          </>
        )}
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
