import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { listPracticeBranches, type PracticeBranch } from '../api/branchInventory';
import { fetchAllEmployees, type Employee } from '../api/appointmentSettings';
import {
  completeTask,
  createTask,
  getTask,
  listTasks,
  patchTask,
  type TaskLinkEntityType,
  type TaskLinkRow,
  type TaskListItem,
} from '../api/tasks';
import { resolveEmployeeIdFromToken, resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import PimsTaskDetailView from '../components/pims/PimsTaskDetailView';
import './PimsTasksPage.css';

const PAGE_SIZE = 50;
const CLIENT_FILTER_CAP = 200;
const LINK_FETCH_CAP = 28;

type TabId = 'all' | 'queue' | 'mine' | 'done';

function normalizeRoles(role: string | string[] | undefined): string[] {
  if (!role) return [];
  const arr = Array.isArray(role) ? role : [role];
  return arr.map((r) => String(r).toLowerCase().trim()).filter(Boolean);
}

function humanDueLine(iso: string | null): string {
  if (!iso) return 'No due date set';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Due date invalid';
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endToday = new Date(startToday);
  endToday.setDate(endToday.getDate() + 1);
  if (d < startToday) return 'Overdue';
  if (d < endToday) return 'Due today';
  const weekEnd = new Date(startToday);
  weekEnd.setDate(weekEnd.getDate() + 7);
  if (d < weekEnd) return 'Due this week';
  return `Due ${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`;
}

function isUrgentTask(t: TaskListItem): boolean {
  if (t.status === 'done') return false;
  if (t.status === 'open' && t.assignedToEmployeeId == null) return true;
  if (!t.dueAt) return false;
  const due = new Date(t.dueAt).getTime();
  const day = 24 * 60 * 60 * 1000;
  return due <= Date.now() + day;
}

function canActOnTask(t: TaskListItem, myEmployeeId: number | null, isPracticeAdmin: boolean): boolean {
  if (t.status === 'done') return false;
  if (isPracticeAdmin) return true;
  if (myEmployeeId == null) return false;
  return t.assignedToEmployeeId === myEmployeeId || t.createdByEmployeeId === myEmployeeId;
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const data = (e as { response?: { data?: { message?: string } } }).response?.data;
    if (data && typeof data.message === 'string') return data.message;
  }
  if (e instanceof Error) return e.message;
  return 'Request failed';
}

function fromDatetimeLocalValue(local: string): string | null {
  if (!local.trim()) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function linkLabel(l: TaskLinkRow): string {
  const t = l.entityType.replace(/_/g, ' ');
  return `${t} #${l.entityId}`;
}

export default function PimsTasksPage() {
  const { token, role } = useAuth() as { token: string | null; role: string | string[] };
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);
  const myEmployeeId = useMemo(() => resolveEmployeeIdFromToken(token), [token]);
  const roles = useMemo(() => normalizeRoles(role), [role]);
  const isPracticeAdmin = useMemo(
    () => roles.includes('admin') || roles.includes('superadmin'),
    [roles]
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const taskIdParam = searchParams.get('taskId') ?? '';

  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [branchFilter, setBranchFilter] = useState<string>('');
  const [tab, setTab] = useState<TabId>('mine');

  const [items, setItems] = useState<TaskListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linksByTaskId, setLinksByTaskId] = useState<Record<number, TaskLinkRow[]>>({});
  const [reassignTask, setReassignTask] = useState<TaskListItem | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setCreateOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    let on = true;
    void (async () => {
      try {
        const [b, em] = await Promise.all([listPracticeBranches(practiceId), fetchAllEmployees()]);
        if (!on) return;
        setBranches(Array.isArray(b) ? b : []);
        setEmployees(Array.isArray(em) ? em : []);
      } catch {
        if (on) {
          setBranches([]);
          setEmployees([]);
        }
      }
    })();
    return () => {
      on = false;
    };
  }, [practiceId]);

  const branchMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const b of branches) m.set(b.id, b.name);
    return m;
  }, [branches]);

  const employeeMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const e of employees) {
      m.set(e.id, [e.firstName, e.lastName].filter(Boolean).join(' ').trim() || e.email);
    }
    return m;
  }, [employees]);

  const branchIdNum = branchFilter === '' ? undefined : Number(branchFilter);

  useEffect(() => {
    setOffset(0);
    setItems([]);
    setLoading(true);
    setError(null);
    let cancelled = false;
    void (async () => {
      try {
        if (tab === 'queue' || tab === 'mine') {
          const res = await listTasks({
            includeDone: false,
            status: tab === 'queue' ? 'open' : undefined,
            branchId: branchIdNum,
            limit: CLIENT_FILTER_CAP,
            offset: 0,
          });
          if (cancelled) return;
          let rows = res.items;
          if (tab === 'queue') {
            rows = rows.filter((t) => t.status === 'open' && t.assignedToEmployeeId == null);
          } else if (tab === 'mine' && myEmployeeId != null) {
            rows = rows.filter((t) => t.assignedToEmployeeId === myEmployeeId);
          } else if (tab === 'mine') {
            rows = [];
          }
          setItems(rows);
          setTotal(rows.length);
          setOffset(rows.length);
        } else if (tab === 'done') {
          const res = await listTasks({
            includeDone: true,
            status: 'done',
            branchId: branchIdNum,
            limit: PAGE_SIZE,
            offset: 0,
          });
          if (cancelled) return;
          setItems(res.items);
          setTotal(res.total);
          setOffset(res.items.length);
        } else {
          const res = await listTasks({
            includeDone: false,
            branchId: branchIdNum,
            limit: PAGE_SIZE,
            offset: 0,
          });
          if (cancelled) return;
          setItems(res.items);
          setTotal(res.total);
          setOffset(res.items.length);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(errMsg(e));
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, branchFilter, branchIdNum, myEmployeeId]);

  useEffect(() => {
    const slice = items.slice(0, LINK_FETCH_CAP);
    if (slice.length === 0) {
      setLinksByTaskId({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        slice.map(async (row) => {
          try {
            const d = await getTask(row.id);
            return [row.id, d.links ?? []] as const;
          } catch {
            return [row.id, []] as const;
          }
        })
      );
      if (!cancelled) setLinksByTaskId(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [items]);

  const loadMore = useCallback(async () => {
    if (tab === 'queue' || tab === 'mine') return;
    setLoading(true);
    setError(null);
    try {
      if (tab === 'done') {
        const res = await listTasks({
          includeDone: true,
          status: 'done',
          branchId: branchIdNum,
          limit: PAGE_SIZE,
          offset,
        });
        setItems((prev) => [...prev, ...res.items]);
        setTotal(res.total);
        setOffset((o) => o + res.items.length);
      } else {
        const res = await listTasks({
          includeDone: false,
          branchId: branchIdNum,
          limit: PAGE_SIZE,
          offset,
        });
        setItems((prev) => [...prev, ...res.items]);
        setTotal(res.total);
        setOffset((o) => o + res.items.length);
      }
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [tab, branchIdNum, offset]);

  const refreshList = useCallback(() => {
    setOffset(0);
    setItems([]);
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        if (tab === 'queue' || tab === 'mine') {
          const res = await listTasks({
            includeDone: false,
            status: tab === 'queue' ? 'open' : undefined,
            branchId: branchIdNum,
            limit: CLIENT_FILTER_CAP,
            offset: 0,
          });
          let rows = res.items;
          if (tab === 'queue') {
            rows = rows.filter((t) => t.status === 'open' && t.assignedToEmployeeId == null);
          } else if (tab === 'mine' && myEmployeeId != null) {
            rows = rows.filter((t) => t.assignedToEmployeeId === myEmployeeId);
          } else if (tab === 'mine') {
            rows = [];
          }
          setItems(rows);
          setTotal(rows.length);
          setOffset(rows.length);
        } else if (tab === 'done') {
          const res = await listTasks({
            includeDone: true,
            status: 'done',
            branchId: branchIdNum,
            limit: PAGE_SIZE,
            offset: 0,
          });
          setItems(res.items);
          setTotal(res.total);
          setOffset(res.items.length);
        } else {
          const res = await listTasks({
            includeDone: false,
            branchId: branchIdNum,
            limit: PAGE_SIZE,
            offset: 0,
          });
          setItems(res.items);
          setTotal(res.total);
          setOffset(res.items.length);
        }
      } catch (e: unknown) {
        setError(errMsg(e));
        setItems([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [tab, branchIdNum, myEmployeeId]);

  const backFromDetail = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('taskId');
    setSearchParams(next, { replace: false });
  }, [searchParams, setSearchParams]);

  const { urgent, normal } = useMemo(() => {
    if (tab === 'done') {
      return { urgent: [] as TaskListItem[], normal: items };
    }
    const u: TaskListItem[] = [];
    const n: TaskListItem[] = [];
    for (const t of items) {
      if (isUrgentTask(t)) u.push(t);
      else n.push(t);
    }
    return { urgent: u, normal: n };
  }, [items, tab]);

  const handleMarkDone = async (id: number) => {
    try {
      await completeTask(id);
      refreshList();
    } catch (e: unknown) {
      setError(errMsg(e));
    }
  };

  const taskIdNum = taskIdParam.trim() ? Number(taskIdParam.trim()) : NaN;
  if (taskIdParam.trim() && Number.isFinite(taskIdNum)) {
    return (
      <div className="pims-tasks pims-tasks--detail">
        <PimsTaskDetailView
          taskId={taskIdNum}
          branches={branches}
          employees={employees}
          myEmployeeId={myEmployeeId}
          isPracticeAdmin={isPracticeAdmin}
          onBack={backFromDetail}
          onUpdated={refreshList}
        />
      </div>
    );
  }

  const canLoadMore = tab === 'all' || tab === 'done' ? offset < total && !loading : false;

  const renderTaskCard = (row: TaskListItem) => {
    const links = linksByTaskId[row.id];
    const canAct = canActOnTask(row, myEmployeeId, isPracticeAdmin);
    return (
      <article key={row.id} className="pims-task-card">
        <div className="pims-task-card__top">
          <Link className="pims-task-card__title" to={`?taskId=${row.id}`}>
            {row.title}
          </Link>
          <span className={`pims-task-card__pill pims-task-card__pill--${row.status}`}>{row.status}</span>
        </div>
        <p className="pims-task-card__due">{humanDueLine(row.dueAt)}</p>
        {links && links.length > 0 ? (
          <div className="pims-task-card__linked">
            <span className="pims-task-card__linked-label">Linked:</span>{' '}
            {links.map((l, i) => (
              <span key={l.id ?? `${l.entityType}-${l.entityId}-${i}`}>
                {i > 0 ? ' · ' : null}
                <TaskLinkInline link={l} />
              </span>
            ))}
          </div>
        ) : (
          <p className="pims-task-card__linked pims-task-card__linked--empty">Linked: —</p>
        )}
        <div className="pims-task-card__meta">
          {row.branchIds?.length ? (
            <span className="pims-task-card__branches">
              {row.branchIds.map((id) => branchMap.get(id) ?? `#${id}`).join(', ')}
            </span>
          ) : null}
          {row.assignedToEmployeeId != null && (
            <span className="pims-task-card__assignee">
              {employeeMap.get(row.assignedToEmployeeId) ?? `Employee #${row.assignedToEmployeeId}`}
            </span>
          )}
        </div>
        {canAct && (
          <div className="pims-task-card__actions">
            <button type="button" className="pims-task-card__btn pims-task-card__btn--done" onClick={() => void handleMarkDone(row.id)}>
              Mark done
            </button>
            <button type="button" className="pims-task-card__btn pims-task-card__btn--reassign" onClick={() => setReassignTask(row)}>
              Re-assign
            </button>
          </div>
        )}
      </article>
    );
  };

  return (
    <div className="pims-tasks">
      <div className="pims-tasks__head">
        <div>
          <h1 className="pims-tasks__title">{tab === 'mine' ? 'My tasks' : 'Tasks'}</h1>
          {tab === 'mine' && <p className="pims-tasks__subtitle">Assigned to me</p>}
        </div>
        <button type="button" className="pims-tasks__add" onClick={() => setCreateOpen(true)}>
          + Task
        </button>
      </div>

      <div className="pims-tasks__toolbar">
        <div className="pims-tasks__tabs" role="tablist" aria-label="Task views">
          {(
            [
              ['mine', 'My tasks'],
              ['all', 'Active'],
              ['queue', 'Queue'],
              ['done', 'Done'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`pims-tasks__tab${tab === id ? ' pims-tasks__tab--active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="pims-tasks__filter">
          <span>Branch</span>
          <select
            className="pims-tasks__select"
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            aria-label="Filter by branch"
          >
            <option value="">All branches</option>
            {branches
              .filter((b) => b.isActive !== false)
              .map((b) => (
                <option key={b.id} value={String(b.id)}>
                  {b.name}
                </option>
              ))}
          </select>
        </label>
      </div>

      {(tab === 'queue' || tab === 'mine') && (
        <p className="pims-tasks__count">
          Showing up to {CLIENT_FILTER_CAP} visible tasks for this filter. Use Active for full pagination.
        </p>
      )}
      {tab === 'mine' && myEmployeeId == null && (
        <p className="pims-tasks__count pims-tasks__count--warn">
          Your session does not include an employee id, so My tasks cannot filter. Use Active or add an employee id to your JWT.
        </p>
      )}

      <p className="pims-tasks__count">
        {tab !== 'queue' && tab !== 'mine' && (
          <>
            {loading && items.length === 0 ? 'Loading…' : `${items.length} shown`}
            {total > 0 && ` · ${total} total`}
          </>
        )}
        {(tab === 'queue' || tab === 'mine') && !loading && `${items.length} task${items.length === 1 ? '' : 's'}`}
      </p>

      {error && <div className="pims-tasks__error">{error}</div>}

      <div className="pims-tasks__board">
        {tab === 'done' ? (
          <section className="pims-tasks__section">
            <h2 className="pims-tasks__section-title">Completed</h2>
            {loading && items.length === 0 ? (
              <p className="pims-tasks__empty">Loading…</p>
            ) : items.length === 0 ? (
              <p className="pims-tasks__empty">No completed tasks in this view.</p>
            ) : (
              <div className="pims-tasks__cards">{items.map(renderTaskCard)}</div>
            )}
          </section>
        ) : (
          <>
            <section className="pims-tasks__section">
              <h2 className="pims-tasks__section-title pims-tasks__section-title--urgent">Urgent</h2>
              {urgent.length === 0 ? (
                <p className="pims-tasks__empty">None right now.</p>
              ) : (
                <div className="pims-tasks__cards">{urgent.map(renderTaskCard)}</div>
              )}
            </section>
            <section className="pims-tasks__section">
              <h2 className="pims-tasks__section-title">Normal</h2>
              {normal.length === 0 ? (
                <p className="pims-tasks__empty">No other tasks in this view.</p>
              ) : (
                <div className="pims-tasks__cards">{normal.map(renderTaskCard)}</div>
              )}
            </section>
          </>
        )}
      </div>

      {canLoadMore && (
        <div className="pims-tasks__loadmore">
          <button type="button" disabled={loading} onClick={() => void loadMore()}>
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}

      {reassignTask && (
        <ReassignModal
          task={reassignTask}
          employees={employees}
          onClose={() => setReassignTask(null)}
          onSaved={() => {
            setReassignTask(null);
            refreshList();
          }}
        />
      )}

      {createOpen && (
        <CreateTaskModal
          branches={branches}
          employees={employees}
          isPracticeAdmin={isPracticeAdmin}
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            setCreateOpen(false);
            refreshList();
            const next = new URLSearchParams(searchParams);
            next.set('taskId', String(id));
            setSearchParams(next, { replace: false });
          }}
        />
      )}
    </div>
  );
}

function TaskLinkInline({ link }: { link: TaskLinkRow }) {
  const label = linkLabel(link);
  if (link.entityType === 'patient') {
    return (
      <Link className="pims-task-card__link" to={`/pims/patients?patientId=${encodeURIComponent(String(link.entityId))}`}>
        {label}
      </Link>
    );
  }
  if (link.entityType === 'client') {
    return (
      <Link className="pims-task-card__link" to={`/pims/clients?clientId=${encodeURIComponent(String(link.entityId))}`}>
        {label}
      </Link>
    );
  }
  return <span>{label}</span>;
}

type ReassignProps = {
  task: TaskListItem;
  employees: Employee[];
  onClose: () => void;
  onSaved: () => void;
};

function ReassignModal({ task, employees, onClose, onSaved }: ReassignProps) {
  const [toId, setToId] = useState<string>(task.assignedToEmployeeId != null ? String(task.assignedToEmployeeId) : '');
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
      await patchTask(task.id, { assignedToEmployeeId: id });
      onSaved();
    } catch (e: unknown) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pims-tasks__backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pims-tasks__modal pims-tasks__modal--narrow" role="dialog" aria-labelledby="pims-reassign-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="pims-tasks__modal-head">
          <h2 id="pims-reassign-title">Re-assign</h2>
          <button type="button" className="pims-tasks__modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="pims-tasks__reassign-task">{task.title}</p>
        {err && <p className="pims-tasks__error">{err}</p>}
        <label className="pims-tasks__modal-field">
          <span>Assign to</span>
          <select value={toId} onChange={(e) => setToId(e.target.value)} disabled={busy}>
            <option value="">Queue (unassigned)</option>
            {employees.map((em) => (
              <option key={em.id} value={String(em.id)}>
                {[em.firstName, em.lastName].filter(Boolean).join(' ') || em.email}
              </option>
            ))}
          </select>
        </label>
        <div className="pims-tasks__modal-actions">
          <button type="button" className="pims-tasks__modal-cancel" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="pims-tasks__modal-submit" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

type ModalProps = {
  branches: PracticeBranch[];
  employees: Employee[];
  isPracticeAdmin: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
};

function CreateTaskModal({ branches, employees, isPracticeAdmin, onClose, onCreated }: ModalProps) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [dueLocal, setDueLocal] = useState('');
  const [startLocal, setStartLocal] = useState('');
  const [assignee, setAssignee] = useState('');
  const [watchers, setWatchers] = useState<number[]>([]);
  const [priority, setPriority] = useState('');
  const [linkedKind, setLinkedKind] = useState<'patient' | 'client'>('patient');
  const [linkedId, setLinkedId] = useState('');
  const [branchSel, setBranchSel] = useState<Record<number, boolean>>({});
  const [escalationMinutes, setEscalationMinutes] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const activeBranches = useMemo(() => branches.filter((b) => b.isActive !== false), [branches]);

  useEffect(() => {
    if (activeBranches.length === 1) {
      setBranchSel({ [activeBranches[0].id]: true });
    }
  }, [activeBranches]);

  const submit = async () => {
    const selectedBranchIds = activeBranches.filter((b) => branchSel[b.id]).map((b) => b.id);
    if (!title.trim()) {
      setFormError('Enter a task title');
      return;
    }
    if (selectedBranchIds.length === 0) {
      setFormError('Select at least one branch');
      return;
    }
    const assigneeId = assignee === '' ? null : Number(assignee);
    if (assignee !== '' && !Number.isFinite(assigneeId)) {
      setFormError('Invalid assignee');
      return;
    }

    const linksPayload: { entityType: TaskLinkEntityType; entityId: number }[] = [];
    const lid = linkedId.trim() ? Number(linkedId.trim()) : NaN;
    if (linkedId.trim() && Number.isFinite(lid)) {
      const et: TaskLinkEntityType = linkedKind === 'client' ? 'client' : 'patient';
      linksPayload.push({ entityType: et, entityId: lid });
    }

    let priorityNum: number | undefined;
    if (priority.trim()) {
      const p = Number(priority);
      if (!Number.isFinite(p)) {
        setFormError('Priority must be a number');
        return;
      }
      priorityNum = p;
    }

    let escalationIntervalSeconds: number | undefined;
    if (escalationMinutes.trim()) {
      const mins = Number(escalationMinutes);
      if (!Number.isFinite(mins) || mins < 1) {
        setFormError('Escalation interval must be at least 1 minute');
        return;
      }
      escalationIntervalSeconds = Math.round(mins * 60);
      if (escalationIntervalSeconds < 60) {
        setFormError('Escalation must be at least 60 seconds');
        return;
      }
    }

    setBusy(true);
    setFormError(null);
    try {
      const created = await createTask({
        title: title.trim(),
        body: body.trim() || null,
        branchIds: selectedBranchIds,
        assignedToEmployeeId: assigneeId,
        dueAt: fromDatetimeLocalValue(dueLocal),
        priority: priorityNum,
        watcherEmployeeIds: [...new Set(watchers)],
        links: linksPayload.length ? linksPayload : undefined,
        escalationIntervalSeconds,
      });
      onCreated(created.id);
    } catch (e: unknown) {
      setFormError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pims-tasks__backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pims-tasks__modal pims-tasks__modal--create" role="dialog" aria-labelledby="pims-tasks-create-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="pims-tasks__modal-head">
          <h2 id="pims-tasks-create-title">Create task</h2>
          <button type="button" className="pims-tasks__modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {formError && <p className="pims-tasks__error">{formError}</p>}
        <div className="pims-tasks__modal-form">
          <label className="pims-tasks__modal-field">
            <span>Task</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} autoFocus placeholder="What needs to be done?" />
          </label>

          <label className="pims-tasks__modal-field">
            <span>Assign to</span>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={busy}>
              <option value="">Queue (unassigned)</option>
              {employees.map((em) => (
                <option key={em.id} value={String(em.id)}>
                  {[em.firstName, em.lastName].filter(Boolean).join(' ') || em.email}
                </option>
              ))}
            </select>
            <span className="pims-tasks__field-hint">Primary owner. Add more people as watchers below.</span>
          </label>

          <label className="pims-tasks__modal-field">
            <span>Also notify (watchers)</span>
            <select
              multiple
              className="pims-tasks__modal-multi"
              value={watchers.map(String)}
              onChange={(e) => {
                const selected = Array.from(e.target.selectedOptions).map((o) => Number(o.value));
                setWatchers(selected.filter(Number.isFinite));
              }}
              disabled={busy}
            >
              {employees.map((em) => (
                <option key={em.id} value={String(em.id)}>
                  {[em.firstName, em.lastName].filter(Boolean).join(' ') || em.email}
                </option>
              ))}
            </select>
            <span className="pims-tasks__field-hint">Hold Ctrl/Cmd to select multiple. Groups are not supported yet.</span>
          </label>

          <div className="pims-tasks__modal-row2">
            <label className="pims-tasks__modal-field">
              <span>Start</span>
              <input type="datetime-local" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} disabled={busy} />
              <span className="pims-tasks__field-hint">For your reference only; not stored on the task yet.</span>
            </label>
            <label className="pims-tasks__modal-field">
              <span>End (due)</span>
              <input type="datetime-local" value={dueLocal} onChange={(e) => setDueLocal(e.target.value)} disabled={busy} />
            </label>
          </div>

          <label className="pims-tasks__modal-field">
            <span>Priority</span>
            <input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} disabled={busy} placeholder="Optional number" />
          </label>

          <div className="pims-tasks__modal-field">
            <span>Linked to (optional)</span>
            <div className="pims-tasks__modal-inline">
              <select value={linkedKind} onChange={(e) => setLinkedKind(e.target.value as 'patient' | 'client')} disabled={busy}>
                <option value="patient">Patient</option>
                <option value="client">Client</option>
              </select>
              <input
                type="number"
                placeholder="Record id"
                value={linkedId}
                onChange={(e) => setLinkedId(e.target.value)}
                disabled={busy}
              />
            </div>
          </div>

          <label className="pims-tasks__modal-field">
            <span>Notes</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} disabled={busy} placeholder="Details, instructions, context…" />
          </label>

          <div className="pims-tasks__modal-field">
            <span>Branches</span>
            <div className="pims-tasks__checks">
              {activeBranches.map((b) => (
                <label key={b.id} className="pims-tasks__check">
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
              <span className="pims-tasks__field-hint">You may only use branches on your profile; the server returns 403 otherwise.</span>
            )}
          </div>

          <details className="pims-tasks__advanced">
            <summary>Advanced</summary>
            <label className="pims-tasks__modal-field">
              <span>Escalation repeat (minutes)</span>
              <input type="number" min={1} value={escalationMinutes} onChange={(e) => setEscalationMinutes(e.target.value)} disabled={busy} />
            </label>
          </details>
        </div>
        <div className="pims-tasks__modal-actions pims-tasks__modal-actions--center">
          <button type="button" className="pims-tasks__modal-cancel" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="pims-tasks__modal-submit" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Creating…' : 'Create task'}
          </button>
        </div>
      </div>
    </div>
  );
}
