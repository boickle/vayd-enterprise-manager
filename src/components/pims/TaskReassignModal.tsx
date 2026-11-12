import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  getTask,
  patchTask,
  reassignFromEmployee,
  type TaskDetail,
  type TaskListItem,
} from '../../api/tasks';
import type { Employee } from '../../api/appointmentSettings';
import { formatEmployeeDisplayName } from '../../utils/employeeDisplayName';
import {
  fromDatetimeLocalValue,
  taskStartIso,
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
  'id' | 'title' | 'assignedToEmployeeId' | 'startAt' | 'dueAt' | 'created'
> & {
  body?: string | null;
  /** Present when the caller already has the full task; otherwise loaded here. */
  watchers?: TaskDetail['watchers'];
};

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
  /** The signed-in employee: offered "Keep me watching" when handing off their own task. */
  myEmployeeId?: number | null;
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
  myEmployeeId = null,
  onClose,
  onSaved,
}: Props) {
  const [toId, setToId] = useState<string>(
    !bulk && task?.assignedToEmployeeId != null ? String(task.assignedToEmployeeId) : '',
  );
  const [startLocal, setStartLocal] = useState(() =>
    !bulk && task ? toDatetimeLocalValue(taskStartIso(task)) : '',
  );
  const [dueLocal, setDueLocal] = useState(() =>
    !bulk && task ? toDatetimeLocalValue(task.dueAt) : '',
  );
  const [note, setNote] = useState('');
  // The API replaces the whole watcher list, so we need the current one before
  // we can add to it. null = still loading (or failed): don't send watchers.
  const [initialWatchers, setInitialWatchers] = useState<number[] | null>(() =>
    !bulk && task?.watchers ? task.watchers.map((w) => w.employeeId) : null,
  );
  const [watchers, setWatchers] = useState<number[]>(() => initialWatchers ?? []);
  const [watchersErr, setWatchersErr] = useState(false);
  // Handing off your own task: stay on it as a watcher unless you untick this (D6).
  const [keepWatching, setKeepWatching] = useState(true);
  // Bulk: people to add as watchers on every moved task (D7).
  const [bulkWatchers, setBulkWatchers] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const taskId = task?.id;
  const needsWatcherLoad = !bulk && taskId != null && initialWatchers == null;
  useEffect(() => {
    if (!needsWatcherLoad || taskId == null) return;
    let cancelled = false;
    getTask(taskId)
      .then((full) => {
        if (cancelled) return;
        const ids = (full.watchers ?? []).map((w) => w.employeeId);
        setInitialWatchers(ids);
        setWatchers(ids);
      })
      .catch(() => {
        if (!cancelled) setWatchersErr(true);
      });
    return () => {
      cancelled = true;
    };
  }, [needsWatcherLoad, taskId]);

  const employeeName = useMemo(() => {
    const m = new Map<number, string>();
    for (const em of employees) {
      const name = formatEmployeeDisplayName(em) || em.email;
      m.set(em.id, em.isActive === false ? `${name} (inactive)` : name);
    }
    return (id: number) => m.get(id) ?? `Employee #${id}`;
  }, [employees]);

  const handingOff =
    !bulk &&
    myEmployeeId != null &&
    task?.assignedToEmployeeId === myEmployeeId &&
    toId !== String(myEmployeeId) &&
    !watchers.includes(myEmployeeId);
  const finalWatchers =
    handingOff && keepWatching && myEmployeeId != null ? [...watchers, myEmployeeId] : watchers;

  const watchersChanged =
    initialWatchers != null &&
    (finalWatchers.length !== initialWatchers.length ||
      finalWatchers.some((id) => !initialWatchers.includes(id)));

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
          ...(bulkWatchers.length ? { addWatcherEmployeeIds: bulkWatchers } : {}),
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
        ...(watchersChanged ? { watcherEmployeeIds: [...new Set(finalWatchers)] } : {}),
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

  const modal = (
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
        {bulk ? (
          <div className="task-reassign-modal__field">
            <span>Add watchers to every task (optional)</span>
            <WatcherPicker
              ids={bulkWatchers}
              onChange={setBulkWatchers}
              employees={employees.filter((em) => String(em.id) !== toId)}
              employeeName={employeeName}
              disabled={busy}
              empty="Each task keeps its own watchers."
            />
          </div>
        ) : null}
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
            <div className="task-reassign-modal__field">
              <span>Watchers</span>
              {initialWatchers == null ? (
                <p className="task-reassign-modal__muted">
                  {watchersErr ? 'Could not load watchers — edit them from the task instead.' : 'Loading watchers…'}
                </p>
              ) : (
                <>
                  <WatcherPicker
                    ids={watchers}
                    onChange={setWatchers}
                    employees={employees}
                    employeeName={employeeName}
                    disabled={busy}
                    empty="No one is watching this task."
                  />
                  {handingOff ? (
                    <label className="task-reassign-modal__check">
                      <input
                        type="checkbox"
                        checked={keepWatching}
                        disabled={busy}
                        onChange={(e) => setKeepWatching(e.target.checked)}
                      />
                      Keep me watching
                    </label>
                  ) : null}
                </>
              )}
            </div>
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

  return typeof document !== 'undefined' ? createPortal(modal, document.body) : modal;
}

/** Watchers as removable name tags, plus an "Add a watcher…" picker. */
function WatcherPicker({
  ids,
  onChange,
  employees,
  employeeName,
  disabled,
  empty,
}: {
  ids: number[];
  onChange: (next: number[]) => void;
  employees: Employee[];
  employeeName: (id: number) => string;
  disabled: boolean;
  empty: string;
}) {
  const options = employees.filter((em) => em.isActive !== false && !ids.includes(em.id));
  return (
    <>
      {ids.length ? (
        <ul className="task-reassign-modal__chips">
          {ids.map((id) => (
            <li key={id} className="task-reassign-modal__chip">
              {employeeName(id)}
              <button
                type="button"
                aria-label={`Remove ${employeeName(id)} as a watcher`}
                disabled={disabled}
                onClick={() => onChange(ids.filter((w) => w !== id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="task-reassign-modal__muted">{empty}</p>
      )}
      <select
        aria-label="Add a watcher"
        value=""
        disabled={disabled || options.length === 0}
        onChange={(e) => {
          const id = Number(e.target.value);
          if (Number.isFinite(id) && id > 0 && !ids.includes(id)) onChange([...ids, id]);
        }}
      >
        <option value="">Add a watcher…</option>
        {options.map((em) => (
          <option key={em.id} value={String(em.id)}>
            {formatEmployeeDisplayName(em) || em.email}
          </option>
        ))}
      </select>
    </>
  );
}
