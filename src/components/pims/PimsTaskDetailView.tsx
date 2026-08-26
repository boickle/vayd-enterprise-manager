import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, CheckCircle2, Loader2, Pencil } from 'lucide-react';
import {
  completeTask,
  getTask,
  patchTask,
  type TaskDetail,
  type TaskLinkEntityType,
  TASK_LINK_ENTITY_TYPES,
} from '../../api/tasks';
import type { PracticeBranch } from '../../api/branchInventory';
import type { Employee } from '../../api/appointmentSettings';
import { formatEmployeeDisplayName } from '../../utils/employeeDisplayName';
import {
  formatTaskIso,
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
  validateTaskScheduleOrder,
} from '../../utils/taskDateTime';
import { priorityApiLabel } from '../../utils/taskPriority';
import { taskLinkDisplayLabel, useTaskLinkLabels } from '../../utils/taskLinkDisplay';
import { buildSchedulerFocusAppointmentUrl } from '../../utils/schedulerFocusAppointment';
import {
  getForwardBookingPrefillFromTaskLinks,
  taskDescriptionDisplayBody,
} from '../../utils/forwardBookingCreateLink';
import { TaskBodyContent } from './TaskBodyContent';
import { ForwardBookingFromTaskLink } from './ForwardBookingFromTaskLink';
import TaskReassignModal from './TaskReassignModal';
import './PimsTaskDetailView.css';

function isTaskLinkEntityType(s: string): s is TaskLinkEntityType {
  return (TASK_LINK_ENTITY_TYPES as readonly string[]).includes(s);
}

function formatEventType(eventType: string): string {
  const known: Record<string, string> = {
    created: 'Created',
    updated: 'Updated',
    assignee_changed: 'Assignee changed',
    status_changed: 'Status changed',
    watcher_added: 'Watcher added',
    watcher_removed: 'Watcher removed',
    branch_changed: 'Branches changed',
    link_added: 'Link added',
    link_removed: 'Link removed',
    completed: 'Completed',
    escalation_sent: 'Escalation reminder',
    body_changed: 'Description changed',
    due_changed: 'Due date changed',
    due_at_changed: 'Due date changed',
    start_at_changed: 'Start date changed',
    title_changed: 'Title changed',
  };
  return known[eventType] ?? eventType.replace(/_/g, ' ');
}

function scheduleChangeDetail(eventType: string, payload: unknown): string | null {
  if (
    eventType !== 'start_at_changed' &&
    eventType !== 'due_at_changed' &&
    eventType !== 'due_changed'
  ) {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const fromRaw = p.from ?? p.old ?? p.previous ?? p.before;
  const toRaw = p.to ?? p.new ?? p.next ?? p.after;
  const from =
    typeof fromRaw === 'string' || fromRaw === null ? formatTaskIso(fromRaw as string | null) : '—';
  const to = typeof toRaw === 'string' || toRaw === null ? formatTaskIso(toRaw as string | null) : '—';
  return `${from} → ${to}`;
}

function linkHref(entityType: string, entityId: number): string | null {
  switch (entityType) {
    case 'patient':
      return `/pims/patients?patientId=${encodeURIComponent(String(entityId))}`;
    case 'client':
      return `/pims/clients?clientId=${encodeURIComponent(String(entityId))}`;
    case 'appointment':
      return buildSchedulerFocusAppointmentUrl(entityId);
    default:
      return null;
  }
}

function formatIso(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

function employeeLabel(map: Map<number, string>, id: number | null | undefined): string {
  if (id == null) return '—';
  return map.get(id) ?? `Employee #${id}`;
}

type Props = {
  taskId: number;
  branches: PracticeBranch[];
  employees: Employee[];
  myEmployeeId: number | null;
  isPracticeAdmin: boolean;
  onBack: () => void;
  onUpdated: () => void;
};

export default function PimsTaskDetailView({
  taskId,
  branches,
  employees,
  myEmployeeId,
  isPracticeAdmin,
  onBack,
  onUpdated,
}: Props) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);

  const employeeMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const e of employees) {
      const name = formatEmployeeDisplayName(e) || e.email;
      m.set(e.id, name);
    }
    return m;
  }, [employees]);

  const branchMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const b of branches) m.set(b.id, b.name);
    return m;
  }, [branches]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const d = await getTask(taskId);
      setTask(d);
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? String((e as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Failed to load task')
          : 'Failed to load task';
      setLoadError(msg);
      setTask(null);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setEditing(false);
    setReassignOpen(false);
  }, [taskId]);

  useEffect(() => {
    if (!task || task.status === 'done') return;
    const t = window.setInterval(() => {
      void load();
    }, 90_000);
    return () => window.clearInterval(t);
  }, [task, load]);

  const canMutate = useMemo(() => {
    if (!task) return false;
    if (isPracticeAdmin) return true;
    if (myEmployeeId == null) return false;
    return (
      task.assignedToEmployeeId === myEmployeeId || task.createdByEmployeeId === myEmployeeId
    );
  }, [task, isPracticeAdmin, myEmployeeId]);

  const isWatcherOnly = useMemo(() => {
    if (!task || myEmployeeId == null) return false;
    if (canMutate) return false;
    return task.watchers.some((w) => w.employeeId === myEmployeeId);
  }, [task, myEmployeeId, canMutate]);

  const latestEscalation = task?.events?.[0]?.eventType === 'escalation_sent';
  const linkLabels = useTaskLinkLabels(task?.links);
  const taskDescriptionBody = useMemo(
    () => taskDescriptionDisplayBody(task?.body),
    [task?.body]
  );
  const forwardBookingPrefill = useMemo(
    () => getForwardBookingPrefillFromTaskLinks(task?.links),
    [task?.links]
  );

  const eventsChronological = useMemo(() => {
    if (!task?.events?.length) return [];
    return [...task.events].sort(
      (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime()
    );
  }, [task?.events]);

  const handleComplete = async () => {
    if (!task || !canMutate) return;
    setBusy(true);
    setActionError(null);
    try {
      const d = await completeTask(task.id);
      setTask(d);
      onUpdated();
    } catch (e: unknown) {
      setActionError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const handleClaim = async () => {
    if (!task || myEmployeeId == null || !canMutate) return;
    setBusy(true);
    setActionError(null);
    try {
      const d = await patchTask(task.id, { assignedToEmployeeId: myEmployeeId });
      setTask(d);
      onUpdated();
    } catch (e: unknown) {
      setActionError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (loadError && !task) {
    return (
      <div className="pims-task-detail">
        <button type="button" className="pims-task-detail__back" onClick={onBack}>
          <ArrowLeft size={18} />
          Back
        </button>
        <p className="pims-task-detail__error">{loadError}</p>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="pims-task-detail pims-task-detail--loading">
        <Loader2 className="pims-task-detail__spinner" size={28} />
        <span>Loading task…</span>
      </div>
    );
  }

  const inQueue = task.status === 'open' && task.assignedToEmployeeId == null;
  const showClaim = canMutate && inQueue && myEmployeeId != null;

  return (
    <div className="pims-task-detail">
      <div className="pims-task-detail__toolbar">
        <button type="button" className="pims-task-detail__back" onClick={onBack}>
          <ArrowLeft size={18} />
          Back to list
        </button>
        <div className="pims-task-detail__actions">
          {latestEscalation && task.status !== 'done' && !editing && (
            <span className="pims-task-detail__badge" title="Latest history event is an escalation reminder">
              Escalation
            </span>
          )}
          {editing ? (
            <button
              type="button"
              className="pims-task-detail__btn pims-task-detail__btn--secondary"
              disabled={busy}
              onClick={() => {
                setActionError(null);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          ) : (
            <>
              {showClaim && (
                <button type="button" className="pims-task-detail__btn pims-task-detail__btn--secondary" disabled={busy} onClick={() => void handleClaim()}>
                  Assign to me
                </button>
              )}
              {canMutate && task.status !== 'done' && (
                <button
                  type="button"
                  className="pims-task-detail__btn pims-task-detail__btn--secondary"
                  disabled={busy}
                  onClick={() => {
                    setActionError(null);
                    setEditing(true);
                  }}
                >
                  <Pencil size={18} />
                  Edit
                </button>
              )}
              {canMutate && task.status !== 'done' && (
                <button
                  type="button"
                  className="pims-task-detail__btn pims-task-detail__btn--secondary"
                  disabled={busy}
                  onClick={() => {
                    setActionError(null);
                    setReassignOpen(true);
                  }}
                >
                  Reassign
                </button>
              )}
              {canMutate && task.status !== 'done' && (
                <button type="button" className="pims-task-detail__btn pims-task-detail__btn--primary" disabled={busy} onClick={() => void handleComplete()}>
                  <CheckCircle2 size={18} />
                  Mark complete
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {isWatcherOnly && !editing && (
        <p className="pims-task-detail__hint">You are watching this task. Only the assignee, creator, or an admin can edit or complete it.</p>
      )}

      {actionError && <p className="pims-task-detail__error">{actionError}</p>}

      {editing ? (
        <TaskEditForm
          key={`${task.id}-${task.updated}`}
          task={task}
          branches={branches}
          employees={employees}
          isPracticeAdmin={isPracticeAdmin}
          busy={busy}
          setBusy={setBusy}
          setActionError={setActionError}
          onSaved={(d) => {
            setTask(d);
            setEditing(false);
            onUpdated();
          }}
          onCancel={() => {
            setActionError(null);
            setEditing(false);
          }}
        />
      ) : (
        <>
      <header className="pims-task-detail__head">
        <h1 className="pims-task-detail__title">{task.title}</h1>
        <div className="pims-task-detail__meta">
          <span className={`pims-task-detail__status pims-task-detail__status--${task.status}`}>{task.status}</span>
          {task.source !== 'manual' && (
            <span className="pims-task-detail__pill">
              {task.source}
              {task.triggerDefinitionId ? ` · ${task.triggerDefinitionId}` : ''}
            </span>
          )}
        </div>
      </header>

      <section className="pims-task-detail__section">
        <h2 className="pims-task-detail__h2">Details</h2>
        <dl className="pims-task-detail__dl">
          <div>
            <dt>Description</dt>
            <dd>
              {taskDescriptionBody ? <TaskBodyContent body={taskDescriptionBody} /> : null}
              {forwardBookingPrefill ? (
                <p className="pims-task-detail__forward-booking-link">
                  <ForwardBookingFromTaskLink links={task.links} taskId={task.id} />
                </p>
              ) : null}
              {!taskDescriptionBody && !forwardBookingPrefill ? <>—</> : null}
            </dd>
          </div>
          <div>
            <dt>Start</dt>
            <dd>{formatTaskIso(task.startAt)}</dd>
          </div>
          <div>
            <dt>Due</dt>
            <dd>{formatTaskIso(task.dueAt)}</dd>
          </div>
          <div>
            <dt>Branches</dt>
            <dd>
              {task.branchIds?.length
                ? task.branchIds.map((id) => branchMap.get(id) ?? `#${id}`).join(', ')
                : '—'}
            </dd>
          </div>
          <div>
            <dt>Assignee</dt>
            <dd>{employeeLabel(employeeMap, task.assignedToEmployeeId)}</dd>
          </div>
          <div>
            <dt>Created by</dt>
            <dd>{employeeLabel(employeeMap, task.createdByEmployeeId)}</dd>
          </div>
          {task.defaultAssigneeEmployeeId != null && (
            <div>
              <dt>Default assignee (hint)</dt>
              <dd>{employeeLabel(employeeMap, task.defaultAssigneeEmployeeId)}</dd>
            </div>
          )}
          <div>
            <dt>Priority</dt>
            <dd>{priorityApiLabel(task.priority)}</dd>
          </div>
        </dl>
      </section>

      {task.escalation && task.status !== 'done' && (
        <section className="pims-task-detail__section">
          <h2 className="pims-task-detail__h2">Escalation</h2>
          <dl className="pims-task-detail__dl">
            <div>
              <dt>Next reminder</dt>
              <dd>{formatIso(task.escalation.nextEscalationAt)}</dd>
            </div>
            <div>
              <dt>Interval</dt>
              <dd>{Math.round(task.escalation.intervalSeconds / 60)} min</dd>
            </div>
            <div>
              <dt>Count</dt>
              <dd>{task.escalation.escalationCount}</dd>
            </div>
          </dl>
        </section>
      )}

      <section className="pims-task-detail__section">
        <h2 className="pims-task-detail__h2">Watchers</h2>
        {task.watchers?.length ? (
          <ul className="pims-task-detail__list">
            {task.watchers.map((w) => (
              <li key={`${w.employeeId}-${w.created}`}>{employeeLabel(employeeMap, w.employeeId)}</li>
            ))}
          </ul>
        ) : (
          <p className="pims-task-detail__muted">None</p>
        )}
      </section>

      <section className="pims-task-detail__section">
        <h2 className="pims-task-detail__h2">Linked records</h2>
        {task.links?.length ? (
          <ul className="pims-task-detail__list">
            {task.links.map((l) => {
              const href = linkHref(l.entityType, l.entityId);
              const label = taskLinkDisplayLabel(l, linkLabels);
              return (
                <li key={l.id}>
                  {href ? (
                    <Link to={href} className="pims-task-detail__link">
                      {label}
                    </Link>
                  ) : (
                    <span>{label}</span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="pims-task-detail__muted">None</p>
        )}
      </section>

      <section className="pims-task-detail__section">
        <h2 className="pims-task-detail__h2">History</h2>
        <ul className="pims-task-detail__timeline">
          {eventsChronological.map((ev) => (
            <li key={ev.id} className="pims-task-detail__timeline-item">
              <div className="pims-task-detail__timeline-dot" />
              <div className="pims-task-detail__timeline-body">
                <div className="pims-task-detail__timeline-title">{formatEventType(ev.eventType)}</div>
                {scheduleChangeDetail(ev.eventType, ev.payload) ? (
                  <div className="pims-task-detail__timeline-detail">
                    {scheduleChangeDetail(ev.eventType, ev.payload)}
                  </div>
                ) : null}
                <div className="pims-task-detail__timeline-meta">
                  {formatIso(ev.created)}
                  {ev.actorEmployeeId != null && (
                    <> · {employeeLabel(employeeMap, ev.actorEmployeeId)}</>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
        </>
      )}

      {reassignOpen && (
        <TaskReassignModal
          task={task}
          employees={employees}
          onClose={() => setReassignOpen(false)}
          onSaved={(updated) => {
            setTask(updated);
            setReassignOpen(false);
            onUpdated();
          }}
        />
      )}
    </div>
  );
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const r = (e as { response?: { data?: { message?: string } }; message?: string }).response?.data
      ?.message;
    if (typeof r === 'string' && r.trim()) return r;
  }
  if (e instanceof Error) return e.message;
  return 'Request failed';
}

type EditProps = {
  task: TaskDetail;
  branches: PracticeBranch[];
  employees: Employee[];
  isPracticeAdmin: boolean;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setActionError: (v: string | null) => void;
  onSaved: (d: TaskDetail) => void;
  onCancel: () => void;
};

function TaskEditForm({
  task,
  branches,
  employees,
  isPracticeAdmin,
  busy,
  setBusy,
  setActionError,
  onSaved,
  onCancel,
}: EditProps) {
  const [title, setTitle] = useState(task.title);
  const [body, setBody] = useState(task.body ?? '');
  const [startLocal, setStartLocal] = useState(() => toDatetimeLocalValue(task.startAt));
  const [dueLocal, setDueLocal] = useState(() => toDatetimeLocalValue(task.dueAt));
  const [branchSel, setBranchSel] = useState<Record<number, boolean>>(() => {
    const m: Record<number, boolean> = {};
    for (const id of task.branchIds ?? []) m[id] = true;
    return m;
  });
  const [assignee, setAssignee] = useState<string>(
    task.assignedToEmployeeId != null ? String(task.assignedToEmployeeId) : ''
  );
  const [watchers, setWatchers] = useState<number[]>(() => task.watchers.map((w) => w.employeeId));
  const [linkRows, setLinkRows] = useState<{ entityType: string; entityId: string }[]>(() =>
    task.links.map((l) => ({ entityType: l.entityType, entityId: String(l.entityId) }))
  );
  const [escalationMinutes, setEscalationMinutes] = useState('');

  const activeBranches = useMemo(() => branches.filter((b) => b.isActive !== false), [branches]);

  const submit = async () => {
    const selectedBranchIds = activeBranches.filter((b) => branchSel[b.id]).map((b) => b.id);
    if (!title.trim()) {
      setActionError('Title is required');
      return;
    }
    if (selectedBranchIds.length === 0) {
      setActionError('Select at least one branch');
      return;
    }

    const linksPayload = linkRows
      .map((row) => {
        const id = Number(row.entityId);
        if (!row.entityType.trim() || !Number.isFinite(id)) return null;
        if (!isTaskLinkEntityType(row.entityType)) return null;
        return { entityType: row.entityType, entityId: id };
      })
      .filter(Boolean) as { entityType: TaskLinkEntityType; entityId: number }[];

    const assigneeId = assignee === '' ? null : Number(assignee);
    if (assignee !== '' && !Number.isFinite(assigneeId)) {
      setActionError('Invalid assignee');
      return;
    }

    let escalationIntervalSeconds: number | undefined;
    if (escalationMinutes.trim()) {
      const mins = Number(escalationMinutes);
      if (!Number.isFinite(mins) || mins < 1) {
        setActionError('Escalation interval must be at least 1 minute (server requires ≥ 60 seconds)');
        return;
      }
      escalationIntervalSeconds = Math.round(mins * 60);
      if (escalationIntervalSeconds < 60) {
        setActionError('Escalation interval must be at least 60 seconds');
        return;
      }
    }

    const startAt = fromDatetimeLocalValue(startLocal);
    const dueAt = fromDatetimeLocalValue(dueLocal);
    const scheduleErr = validateTaskScheduleOrder(startAt, dueAt);
    if (scheduleErr) {
      setActionError(scheduleErr);
      return;
    }

    setBusy(true);
    setActionError(null);
    try {
      const patch: Parameters<typeof patchTask>[1] = {
        title: title.trim(),
        body: body.trim() || null,
        startAt,
        dueAt,
        branchIds: selectedBranchIds,
        assignedToEmployeeId: assigneeId,
        watcherEmployeeIds: [...new Set(watchers)],
        links: linksPayload,
      };
      if (escalationIntervalSeconds != null) {
        patch.escalationIntervalSeconds = escalationIntervalSeconds;
      }
      const d = await patchTask(task.id, patch);
      onSaved(d);
    } catch (e: unknown) {
      setActionError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="pims-task-detail__section pims-task-detail__section--edit">
      <h2 className="pims-task-detail__h2">Edit task</h2>
      <div className="pims-task-detail__form">
        <label className="pims-task-detail__field">
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
        </label>
        <label className="pims-task-detail__field">
          <span>Description</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} disabled={busy} />
        </label>
        <div className="pims-task-detail__row2">
          <label className="pims-task-detail__field">
            <span>Start</span>
            <input
              type="datetime-local"
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
              disabled={busy}
            />
            <span className="pims-task-detail__field-hint">Clear to remove start date.</span>
          </label>
          <label className="pims-task-detail__field">
            <span>Due</span>
            <input type="datetime-local" value={dueLocal} onChange={(e) => setDueLocal(e.target.value)} disabled={busy} />
            <span className="pims-task-detail__field-hint">Clear to remove due date.</span>
          </label>
        </div>

        <div className="pims-task-detail__field">
          <span>Branches</span>
          <div className="pims-task-detail__checks">
            {activeBranches.map((b) => (
              <label key={b.id} className="pims-task-detail__check">
                <input
                  type="checkbox"
                  checked={!!branchSel[b.id]}
                  onChange={(e) => setBranchSel((p) => ({ ...p, [b.id]: e.target.checked }))}
                  disabled={busy}
                />
                {b.name}
              </label>
            ))}
          </div>
          {!isPracticeAdmin && (
            <p className="pims-task-detail__field-hint">Non-admins may only choose branches they belong to; the server will reject invalid picks.</p>
          )}
        </div>

        <label className="pims-task-detail__field">
          <span>Assignee</span>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={busy}>
            <option value="">Queue (unassigned)</option>
            {employees.map((em) => (
              <option key={em.id} value={String(em.id)}>
                {formatEmployeeDisplayName(em) || em.email}
              </option>
            ))}
          </select>
        </label>

        <label className="pims-task-detail__field">
          <span>Watchers</span>
          <select
            multiple
            className="pims-task-detail__multi"
            value={watchers.map(String)}
            onChange={(e) => {
              const selected = Array.from(e.target.selectedOptions).map((o) => Number(o.value));
              setWatchers(selected.filter(Number.isFinite));
            }}
            disabled={busy}
          >
            {employees.map((em) => (
              <option key={em.id} value={String(em.id)}>
                {formatEmployeeDisplayName(em) || em.email}
              </option>
            ))}
          </select>
          <span className="pims-task-detail__field-hint">Hold Ctrl/Cmd to select multiple.</span>
        </label>

        <div className="pims-task-detail__field">
          <span>Links</span>
          {linkRows.map((row, idx) => (
            <div key={idx} className="pims-task-detail__link-row">
              <select
                value={row.entityType}
                onChange={(e) => {
                  const v = e.target.value;
                  setLinkRows((r) => r.map((x, i) => (i === idx ? { ...x, entityType: v } : x)));
                }}
                disabled={busy}
              >
                {TASK_LINK_ENTITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <input
                type="number"
                placeholder="Entity id"
                value={row.entityId}
                onChange={(e) => {
                  const v = e.target.value;
                  setLinkRows((r) => r.map((x, i) => (i === idx ? { ...x, entityId: v } : x)));
                }}
                disabled={busy}
              />
              <button
                type="button"
                className="pims-task-detail__icon-btn"
                disabled={busy}
                onClick={() => setLinkRows((r) => r.filter((_, i) => i !== idx))}
              >
                Remove
              </button>
            </div>
          ))}
          <button type="button" className="pims-task-detail__btn pims-task-detail__btn--secondary" disabled={busy} onClick={() => setLinkRows((r) => [...r, { entityType: 'patient', entityId: '' }])}>
            Add link
          </button>
        </div>

        <label className="pims-task-detail__field">
          <span>Escalation interval (minutes, optional)</span>
          <input
            type="number"
            min={1}
            placeholder="e.g. 60 — starts from now when saved"
            value={escalationMinutes}
            onChange={(e) => setEscalationMinutes(e.target.value)}
            disabled={busy}
          />
        </label>

        <div className="pims-task-detail__form-actions">
          <button type="button" className="pims-task-detail__btn pims-task-detail__btn--secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="pims-task-detail__btn pims-task-detail__btn--primary" disabled={busy} onClick={() => void submit()}>
            Save changes
          </button>
        </div>
      </div>
    </section>
  );
}

