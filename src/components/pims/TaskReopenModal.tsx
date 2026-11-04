import { useMemo, useState } from 'react';
import { reopenTask, type TaskDetail } from '../../api/tasks';
import type { Employee } from '../../api/appointmentSettings';
import { formatEmployeeDisplayName } from '../../utils/employeeDisplayName';
import {
  isSharedTask,
  joinPeople,
  reopenableMembers,
  sharedMemberLabel,
} from '../../utils/sharedTask';
import './SharedTaskPrompts.css';

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const data = (e as { response?: { data?: { message?: string } } }).response?.data;
    if (data && typeof data.message === 'string') return data.message;
  }
  if (e instanceof Error) return e.message;
  return 'Request failed';
}

type Props = {
  task: TaskDetail;
  /** Staff to choose from when nobody on the task is still active. */
  employees: Employee[];
  onClose: () => void;
  onReopened: (updated: TaskDetail) => void;
};

/**
 * Reopen a closed task.
 * - Shared: "Reopen for everyone (Dr. Crispell, Jen) or just one person?" — everyone still
 *   active, or one of them. When none of them is active, choose someone else to give it to.
 * - Not shared: reopen for the same person; if they have left, choose someone else.
 */
export default function TaskReopenModal({ task, employees, onClose, onReopened }: Props) {
  const shared = isSharedTask(task);
  const active = useMemo(() => reopenableMembers(task), [task]);
  const assigneeInactive =
    !shared &&
    task.assignedToEmployeeId != null &&
    employees.some((e) => e.id === task.assignedToEmployeeId && e.isActive === false);
  const [mode, setMode] = useState<'pick' | 'other'>(
    (shared && active.length === 0) || assigneeInactive ? 'other' : 'pick'
  );
  const [oneId, setOneId] = useState<number | null>(
    active.find((m) => m.isThisCopy)?.employeeId ?? active[0]?.employeeId ?? null
  );
  const [otherId, setOtherId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const choices = useMemo(
    () =>
      employees
        .filter((e) => e.isActive !== false && e.isDeleted !== true)
        .map((e) => ({ id: e.id, name: formatEmployeeDisplayName(e) || e.email }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [employees]
  );

  const run = async (body: { scope?: 'all'; employeeId?: number }) => {
    setBusy(true);
    setErr(null);
    try {
      onReopened(await reopenTask(task.id, body));
    } catch (e: unknown) {
      const msg = errMsg(e);
      setErr(msg);
      if (/no longer active|still active/i.test(msg)) setMode('other');
    } finally {
      setBusy(false);
    }
  };

  const activeNames = active.map(sharedMemberLabel);

  return (
    <div
      className="shared-task-prompt__backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        className="shared-task-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-reopen-title"
      >
        {mode === 'other' ? (
          <>
            <h2 id="task-reopen-title">Reopen and assign to someone</h2>
            <p>
              {shared
                ? 'Nobody on this task is still active. Choose someone to assign it to.'
                : 'The person on this task is no longer active. Choose someone to assign it to.'}
            </p>
            {err ? <p className="shared-task-prompt__error">{err}</p> : null}
            <select
              aria-label="Assign the reopened task to"
              value={otherId}
              onChange={(e) => setOtherId(e.target.value)}
              disabled={busy}
            >
              <option value="">Choose…</option>
              {choices.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
            <div className="shared-task-prompt__actions">
              <button type="button" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="is-primary"
                disabled={busy || !otherId}
                onClick={() => void run({ employeeId: Number(otherId) })}
              >
                Reopen
              </button>
            </div>
          </>
        ) : shared ? (
          <>
            <h2 id="task-reopen-title">
              Reopen for everyone ({joinPeople(activeNames)}) or just one person?
            </h2>
            {err ? <p className="shared-task-prompt__error">{err}</p> : null}
            <ul className="shared-task-prompt__people" aria-label="Reopen for one person">
              {active.map((m) => (
                <li key={m.employeeId}>
                  <label>
                    <input
                      type="radio"
                      name={`reopen-one-${task.id}`}
                      checked={oneId === m.employeeId}
                      onChange={() => setOneId(m.employeeId)}
                      disabled={busy}
                    />
                    {sharedMemberLabel(m)}
                  </label>
                </li>
              ))}
            </ul>
            <div className="shared-task-prompt__actions">
              <button type="button" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || oneId == null}
                onClick={() => oneId != null && void run({ employeeId: oneId })}
              >
                Just{' '}
                {active.find((m) => m.employeeId === oneId)
                  ? sharedMemberLabel(active.find((m) => m.employeeId === oneId)!)
                  : 'one person'}
              </button>
              <button
                type="button"
                className="is-primary"
                disabled={busy}
                onClick={() => void run({ scope: 'all' })}
              >
                Reopen for everyone
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="task-reopen-title">Reopen this task?</h2>
            <p>It goes back on the board for the same person.</p>
            {err ? <p className="shared-task-prompt__error">{err}</p> : null}
            <div className="shared-task-prompt__actions">
              <button type="button" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="is-primary"
                disabled={busy}
                onClick={() => void run({})}
              >
                Reopen
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
