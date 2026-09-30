import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { DateTime } from 'luxon';
import { useAuth } from '../auth/useAuth';
import { listPracticeBranches, type PracticeBranch } from '../api/branchInventory';
import { fetchAllEmployees, fetchEmployeeRoles, type Employee, type EmployeeRole } from '../api/appointmentSettings';
import { fetchClientByIdStaff, searchClientsStaff, type ClientSearchRow } from '../api/clientsStaff';
import { fetchPatientByIdStaff, searchPatientsStaff, type PatientSearchRow } from '../api/patients';
import { formatEmployeeDisplayName } from '../utils/employeeDisplayName';
import {
  fromDatetimeLocalValue,
  taskStartIso,
  toDatetimeLocalValue,
  validateTaskScheduleOrder,
} from '../utils/taskDateTime';
import {
  type TaskPriorityChoice,
  isTaskPriorityUrgent,
  priorityToApi,
} from '../utils/taskPriority';
import { clientsForPatientSearchRow, primaryClientLabelForPatientRow } from '../utils/pimsPatientSearchRow';
import { extractActivePatientsFromClientStaffRecord } from '../utils/routingPatientHoverData';
import { taskLinkDisplayLabel, useTaskLinkLabels } from '../utils/taskLinkDisplay';
import { buildSchedulerFocusAppointmentUrl } from '../utils/schedulerFocusAppointment';
import {
  completeTask,
  createTask,
  fetchTasksSummary,
  getTask,
  listTasks,
  patchTask,
  taskKindLabel,
  taskResolutionLabel,
  type TaskKind,
  type TaskLinkEntityType,
  type TaskLinkRow,
  type TaskListItem,
  type TaskSummaryResponse,
} from '../api/tasks';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import { subscribePracticeTasks } from '../utils/taskRealtime';
import {
  filterMyOpenTasksByAssignedTab,
  filterVisibleWatchingTasks,
  notifyTasksChanged,
  normalizeEmployeeId,
  resolveMyEmployeeIds,
  taskAssigneeEmployeeId,
  VAYD_TASKS_CHANGED,
  type AssignedTasksTab,
} from '../utils/taskOwnership';
import PimsTaskDetailView from '../components/pims/PimsTaskDetailView';
import {
  mailOrderTaskStatusClass,
  mailOrderTaskStatusLabel,
} from '../utils/mailOrderTaskStatus';
import { isInvoiceAutomationTask } from '../utils/invoiceTask';
import { isSoapAutomationTask } from '../utils/soapTask';
import { isOrderListAutomationTask, orderListPath } from '../utils/orderListTask';
import TaskReassignModal from '../components/pims/TaskReassignModal';
import TaskRemoveModal from '../components/pims/TaskRemoveModal';
import './PimsTasksPage.css';

const PAGE_SIZE = 50;
const CLIENT_FILTER_CAP = 200;
const LINK_FETCH_CAP = 28;

type TabId = AssignedTasksTab | 'watching' | 'sent' | 'completed' | 'unassigned';

function queueRoleLabel(role: Pick<EmployeeRole, 'name' | 'roleValue'>): string {
  const name = (role.name ?? '').trim();
  if (/receptionist/i.test(name) || String(role.roleValue).toLowerCase() === 'receptionist') {
    return 'CL';
  }
  return name || `Role ${String(role.roleValue)}`;
}

function isBucketTab(tab: TabId): tab is AssignedTasksTab {
  return tab === 'active' || tab === 'expired' || tab === 'upcoming';
}

const EMPTY_SUMMARY: TaskSummaryResponse = {
  assigned: { active: 0, expired: 0, upcoming: 0, total: 0 },
  watching: { active: 0, expired: 0, upcoming: 0, total: 0 },
  unassigned: { active: 0, expired: 0, upcoming: 0, total: 0 },
  myBranchIds: [],
};

function normalizeRoles(role: string | string[] | undefined): string[] {
  if (!role) return [];
  const arr = Array.isArray(role) ? role : [role];
  return arr.map((r) => String(r).toLowerCase().trim()).filter(Boolean);
}

function formatCardDate(d: Date, now: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
  });
}

function humanStartLine(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endToday = new Date(startToday);
  endToday.setDate(endToday.getDate() + 1);
  const when = formatCardDate(d, now);
  if (d >= startToday && d < endToday) return `Starts today · ${when}`;
  if (d >= endToday) return `Starts ${when}`;
  return `Started ${when}`;
}

function humanDueLine(iso: string | null): string {
  if (!iso) return 'No due date set';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Due date invalid';
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endToday = new Date(startToday);
  endToday.setDate(endToday.getDate() + 1);
  const when = formatCardDate(d, now);
  if (d < startToday) return `Overdue · ${when}`;
  if (d < endToday) return `Due today · ${when}`;
  return `Due ${when}`;
}

function isUrgentTask(t: TaskListItem): boolean {
  if (t.status === 'done') return false;
  if (isTaskPriorityUrgent(t.priority)) return true;
  if (t.status === 'open' && t.assignedToEmployeeId == null) return true;
  if (!t.dueAt) return false;
  const due = new Date(t.dueAt).getTime();
  const day = 24 * 60 * 60 * 1000;
  return due <= Date.now() + day;
}

function canActOnTask(t: TaskListItem, myEmployeeIds: number[], isPracticeAdmin: boolean): boolean {
  if (t.status === 'done') return false;
  if (isPracticeAdmin) return true;
  if (myEmployeeIds.length === 0) return false;
  const assignee = taskAssigneeEmployeeId(t);
  const creator = normalizeEmployeeId(t.createdByEmployeeId);
  return (
    (assignee != null && myEmployeeIds.includes(assignee)) ||
    (creator != null && myEmployeeIds.includes(creator))
  );
}

function canClaimTask(t: TaskListItem, myEmployeeIds: number[]): boolean {
  return t.status !== 'done' && t.assignedToEmployeeId == null && myEmployeeIds.length > 0;
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const data = (e as { response?: { data?: { message?: string } } }).response?.data;
    if (data && typeof data.message === 'string') return data.message;
  }
  if (e instanceof Error) return e.message;
  return 'Request failed';
}

function dateToDatetimeLocal(d: Date): string {
  return toDatetimeLocalValue(d.toISOString());
}

type DueScheduleUnit = 'days' | 'weeks' | 'months';
type DueStartMode = 'today' | 'relative';

function applyStartSchedule(amount: number, unit: DueScheduleUnit): string {
  const n = Math.max(1, Math.floor(amount) || 1);
  const start = DateTime.now().plus({ [unit]: n });
  return dateToDatetimeLocal(start.toJSDate());
}

function applyStartToday(): string {
  return dateToDatetimeLocal(DateTime.now().toJSDate());
}

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function clientDisplayName(c: ClientSearchRow): string {
  const both = [pickStr(c.firstName), pickStr(c.lastName)].filter(Boolean).join(' ');
  return both || `Client #${c.id}`;
}

function patientSearchLabel(row: Record<string, unknown>): string {
  const joined = [pickStr(row.firstName), pickStr(row.lastName)].filter(Boolean).join(' ').trim();
  const name = pickStr(row.name) ?? (joined || 'Patient');
  const owner = primaryClientLabelForPatientRow(row as PatientSearchRow);
  return owner ? `${name} (${owner})` : name;
}

type LinkPick = { id: number; label: string; source?: unknown };

function clientPickFromPatientRecord(raw: unknown): LinkPick | null {
  const clients = clientsForPatientSearchRow(raw as PatientSearchRow);
  const c = clients[0];
  if (!c) return null;
  const id = Number(c.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  return { id, label: c.name, source: raw };
}

function householdPetsFromClient(raw: unknown): LinkPick[] {
  return extractActivePatientsFromClientStaffRecord(raw)
    .map((p) => {
      const id = Number(p.id);
      if (!Number.isFinite(id) || id <= 0) return null;
      return { id, label: p.name };
    })
    .filter((x): x is LinkPick => x != null);
}

function TaskLinkEntityPicker({
  kind,
  disabled,
  value,
  onChange,
  practiceId,
}: {
  kind: 'patient' | 'client';
  disabled?: boolean;
  value: LinkPick | null;
  onChange: (next: LinkPick | null) => void;
  practiceId?: number;
}) {
  const [query, setQuery] = useState(value?.label ?? '');
  const [results, setResults] = useState<LinkPick[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    setQuery(value?.label ?? '');
  }, [value?.id, value?.label]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (value && q === value.label) {
      setResults([]);
      return;
    }
    if (!q) {
      setResults([]);
      return;
    }
    const id = ++seq.current;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        if (kind === 'client') {
          const rows = await searchClientsStaff(q);
          if (seq.current !== id) return;
          setResults(
            rows.slice(0, 8).map((c) => ({
              id: Number(c.id),
              label: clientDisplayName(c),
              source: c,
            }))
          );
          setOpen(true);
        } else {
          const rows = await searchPatientsStaff(q, {
            ...(practiceId != null ? { practiceId } : {}),
            activeOnly: true,
          });
          if (seq.current !== id) return;
          setResults(
            rows
              .filter((r) => r && typeof r === 'object')
              .slice(0, 8)
              .map((r) => {
                const row = r as Record<string, unknown>;
                const idRaw = row.id ?? row.patientId;
                return {
                  id: Number(idRaw),
                  label: patientSearchLabel(row),
                  source: row,
                };
              })
              .filter((x) => Number.isFinite(x.id))
          );
          setOpen(true);
        }
      } catch {
        if (seq.current === id) setResults([]);
      } finally {
        if (seq.current === id) setSearching(false);
      }
    }, 280);
    return () => window.clearTimeout(timer);
  }, [query, kind, practiceId, value]);

  return (
    <div className="pims-tasks__link-search" ref={wrapRef}>
      <input
        type="search"
        placeholder={kind === 'client' ? 'Search client name…' : 'Search patient name…'}
        value={query}
        disabled={disabled}
        autoComplete="off"
        onChange={(e) => {
          const next = e.target.value;
          setQuery(next);
          if (value && next !== value.label) onChange(null);
        }}
        onFocus={() => results.length > 0 && setOpen(true)}
      />
      {value ? (
        <button
          type="button"
          className="pims-tasks__link-clear"
          disabled={disabled}
          onClick={() => {
            onChange(null);
            setQuery('');
            setResults([]);
          }}
        >
          Clear
        </button>
      ) : null}
      {searching ? <span className="pims-tasks__field-hint">Searching…</span> : null}
      {open && results.length > 0 ? (
        <ul className="pims-tasks__link-dropdown" role="listbox">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                role="option"
                className="pims-tasks__link-dd-item"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(r);
                  setQuery(r.label);
                  setOpen(false);
                }}
              >
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default function PimsTasksPage() {
  const { token, role, userEmail, userId, doctorId } = useAuth();
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);
  const authRoles = useMemo(() => normalizeRoles(role), [role]);
  const isPracticeAdmin = useMemo(
    () => authRoles.includes('admin') || authRoles.includes('superadmin'),
    [authRoles]
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const taskIdParam = searchParams.get('taskId') ?? '';

  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [roles, setRoles] = useState<EmployeeRole[]>([]);
  const [roleFilter, setRoleFilter] = useState('');
  const myEmployeeIds = useMemo(
    () =>
      resolveMyEmployeeIds({
        token,
        doctorId,
        userEmail,
        userId,
        employees,
      }),
    [token, doctorId, userEmail, userId, employees]
  );
  const myEmployeeId = myEmployeeIds[0] ?? null;
  const [branchFilter, setBranchFilter] = useState<string>('');
  const [tab, setTab] = useState<TabId>('active');
  const [taskSummary, setTaskSummary] = useState<TaskSummaryResponse>(EMPTY_SUMMARY);
  const [myOpenTasks, setMyOpenTasks] = useState<TaskListItem[]>([]);
  const [watchingTasks, setWatchingTasks] = useState<TaskListItem[]>([]);

  const visibleWatchingTasks = useMemo(
    () => filterVisibleWatchingTasks(watchingTasks),
    [watchingTasks]
  );

  const watchingTabCount = visibleWatchingTasks.length;

  const [sentListTotal, setSentListTotal] = useState(0);
  const [unassignedListTotal, setUnassignedListTotal] = useState(0);

  const showListCapAlert = useMemo(() => {
    if (isBucketTab(tab)) return taskSummary.assigned.total > CLIENT_FILTER_CAP;
    if (tab === 'watching') return taskSummary.watching.total > CLIENT_FILTER_CAP;
    if (tab === 'sent') return sentListTotal > CLIENT_FILTER_CAP;
    if (tab === 'unassigned') return unassignedListTotal > CLIENT_FILTER_CAP;
    return false;
  }, [tab, taskSummary, sentListTotal, unassignedListTotal]);

  const roleMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of roles) m.set(r.id, queueRoleLabel(r));
    return m;
  }, [roles]);

  const [items, setItems] = useState<TaskListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linksByTaskId, setLinksByTaskId] = useState<Record<number, TaskLinkRow[]>>({});
  const allTaskLinks = useMemo(() => Object.values(linksByTaskId).flat(), [linksByTaskId]);
  const linkLabels = useTaskLinkLabels(allTaskLinks);
  const [reassignTask, setReassignTask] = useState<TaskListItem | null>(null);
  const [removeTarget, setRemoveTarget] = useState<TaskListItem | null>(null);
  const [bulkReassignIds, setBulkReassignIds] = useState<number[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    setCreateOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    next.delete('taskId');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    let on = true;
    void (async () => {
      try {
        const [b, em, roleRows] = await Promise.all([
          listPracticeBranches(practiceId),
          fetchAllEmployees(),
          fetchEmployeeRoles().catch(() => [] as EmployeeRole[]),
        ]);
        if (!on) return;
        setBranches(Array.isArray(b) ? b : []);
        setEmployees(Array.isArray(em) ? em : []);
        setRoles(Array.isArray(roleRows) ? roleRows : []);
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
      m.set(e.id, formatEmployeeDisplayName(e) || e.email);
    }
    return m;
  }, [employees]);

  const branchIdNum = branchFilter === '' ? undefined : Number(branchFilter);

  const loadTaskSummary = useCallback(async () => {
    try {
      const summary = await fetchTasksSummary(
        branchIdNum != null && Number.isFinite(branchIdNum) ? { branchId: branchIdNum } : undefined
      );
      setTaskSummary(summary);
      return summary;
    } catch {
      setTaskSummary(EMPTY_SUMMARY);
      return EMPTY_SUMMARY;
    }
  }, [branchIdNum]);

  const loadAssignedOpenTasks = useCallback(async () => {
    if (myEmployeeIds.length === 0) {
      setMyOpenTasks([]);
      return [];
    }
    const res = await listTasks({
      involvement: 'assigned',
      includeDone: false,
      branchId: branchIdNum,
      limit: CLIENT_FILTER_CAP,
      offset: 0,
    });
    setMyOpenTasks(res.items);
    return res.items;
  }, [branchIdNum, myEmployeeIds]);

  const loadWatchingOpenTasks = useCallback(async () => {
    if (myEmployeeIds.length === 0) {
      setWatchingTasks([]);
      return [];
    }
    const res = await listTasks({
      involvement: 'watching',
      includeDone: false,
      branchId: branchIdNum,
      limit: CLIENT_FILTER_CAP,
      offset: 0,
    });
    setWatchingTasks(res.items);
    return filterVisibleWatchingTasks(res.items);
  }, [branchIdNum, myEmployeeIds]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await Promise.all([loadTaskSummary(), loadAssignedOpenTasks(), loadWatchingOpenTasks()]);
      } catch (e: unknown) {
        if (!cancelled) {
          setError(errMsg(e));
          setMyOpenTasks([]);
          setTaskSummary(EMPTY_SUMMARY);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadTaskSummary, loadAssignedOpenTasks, loadWatchingOpenTasks]);

  useEffect(() => {
    const onChanged = () => {
      void loadTaskSummary();
      void loadWatchingOpenTasks();
      if (isBucketTab(tab)) void loadAssignedOpenTasks();
    };
    window.addEventListener(VAYD_TASKS_CHANGED, onChanged);
    // Cross-user/cross-tab updates arrive over the `/tasks` websocket instead of polling.
    const unsubscribeTasks = subscribePracticeTasks({
      practiceId,
      onChange: onChanged,
      onReconnect: onChanged,
    });
    return () => {
      window.removeEventListener(VAYD_TASKS_CHANGED, onChanged);
      unsubscribeTasks();
    };
  }, [tab, practiceId, loadTaskSummary, loadAssignedOpenTasks, loadWatchingOpenTasks]);

  useEffect(() => {
    if (tab === 'watching') {
      setItems(visibleWatchingTasks);
      setTotal(visibleWatchingTasks.length);
      setOffset(visibleWatchingTasks.length);
      return;
    }
    if (!isBucketTab(tab)) return;
    const rows = myEmployeeIds.length === 0 ? [] : filterMyOpenTasksByAssignedTab(myOpenTasks, tab);
    setItems(rows);
    setTotal(rows.length);
    setOffset(rows.length);
  }, [tab, myOpenTasks, visibleWatchingTasks, myEmployeeIds]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [tab, branchFilter]);

  useEffect(() => {
    if (tab !== 'watching') return;
    setLoading(true);
    setError(null);
    let cancelled = false;
    void (async () => {
      try {
        await loadWatchingOpenTasks();
      } catch (e: unknown) {
        if (!cancelled) {
          setError(errMsg(e));
          setWatchingTasks([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, loadWatchingOpenTasks]);

  useEffect(() => {
    if (isBucketTab(tab) || tab === 'watching') return;
    setOffset(0);
    setItems([]);
    setLoading(true);
    setError(null);
    let cancelled = false;
    void (async () => {
      try {
        if (tab === 'unassigned') {
          const res = await listTasks({
            involvement: 'unassigned',
            includeDone: false,
            branchId: branchIdNum,
            roleId: roleFilter ? Number(roleFilter) : undefined,
            limit: CLIENT_FILTER_CAP,
            offset: 0,
          });
          if (cancelled) return;
          setItems(res.items);
          setUnassignedListTotal(res.total);
          setTotal(res.total);
          setOffset(res.items.length);
        } else if (tab === 'sent') {
          const res = await listTasks({
            involvement: 'created',
            includeDone: true,
            branchId: branchIdNum,
            limit: CLIENT_FILTER_CAP,
            offset: 0,
          });
          if (cancelled) return;
          setItems(res.items);
          setSentListTotal(res.total);
          setTotal(res.total);
          setOffset(res.items.length);
        } else if (tab === 'completed') {
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
  }, [tab, branchFilter, branchIdNum, roleFilter, myEmployeeIds]);

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
    if (tab !== 'completed') return;
    setLoading(true);
    setError(null);
    try {
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
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [tab, branchIdNum, offset]);

  const refreshList = useCallback(() => {
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        await loadTaskSummary();
        if (isBucketTab(tab)) {
          const mine = await loadAssignedOpenTasks();
          const rows = filterMyOpenTasksByAssignedTab(mine, tab);
          setItems(rows);
          setTotal(rows.length);
          setOffset(rows.length);
        } else if (tab === 'watching') {
          const rows = await loadWatchingOpenTasks();
          setItems(rows);
          setTotal(rows.length);
          setOffset(rows.length);
        } else if (tab === 'sent') {
          const res = await listTasks({
            involvement: 'created',
            includeDone: true,
            branchId: branchIdNum,
            limit: CLIENT_FILTER_CAP,
            offset: 0,
          });
          setItems(res.items);
          setTotal(res.items.length);
          setOffset(res.items.length);
        } else if (tab === 'completed') {
          setOffset(0);
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
        } else if (tab === 'unassigned') {
          const res = await listTasks({
            involvement: 'unassigned',
            includeDone: false,
            branchId: branchIdNum,
            roleId: roleFilter ? Number(roleFilter) : undefined,
            limit: CLIENT_FILTER_CAP,
            offset: 0,
          });
          setItems(res.items);
          setUnassignedListTotal(res.total);
          setTotal(res.total);
          setOffset(res.items.length);
        }
      } catch (e: unknown) {
        setError(errMsg(e));
        setItems([]);
        setMyOpenTasks([]);
        setWatchingTasks([]);
        setTaskSummary(EMPTY_SUMMARY);
      } finally {
        setLoading(false);
      }
    })();
  }, [tab, branchIdNum, roleFilter, loadAssignedOpenTasks, loadWatchingOpenTasks, loadTaskSummary]);

  const backFromDetail = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('taskId');
    setSearchParams(next, { replace: false });
  }, [searchParams, setSearchParams]);

  const { urgent, normal } = useMemo(() => {
    if (tab === 'completed') {
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
      notifyTasksChanged();
    } catch (e: unknown) {
      setError(errMsg(e));
    }
  };

  const handleClaim = async (id: number) => {
    const me = myEmployeeId;
    if (me == null) return;
    try {
      await patchTask(id, { assignedToEmployeeId: me });
      refreshList();
      notifyTasksChanged();
    } catch (e: unknown) {
      setError(errMsg(e));
    }
  };

  const toggleSelected = (id: number, on: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const taskIdNum = taskIdParam.trim() ? Number(taskIdParam.trim()) : NaN;
  if (taskIdParam.trim() && Number.isFinite(taskIdNum)) {
    return (
      <div className="pims-tasks pims-tasks--detail">
        <PimsTaskDetailView
          taskId={taskIdNum}
          branches={branches}
          employees={employees}
          roles={roles}
          myEmployeeId={myEmployeeId}
          isPracticeAdmin={isPracticeAdmin}
          onBack={backFromDetail}
          onUpdated={() => {
            refreshList();
            notifyTasksChanged();
          }}
        />
      </div>
    );
  }

  const canLoadMore = tab === 'completed' ? offset < total && !loading : false;

  const renderTaskCard = (row: TaskListItem) => {
    const links = linksByTaskId[row.id];
    const canAct = canActOnTask(row, myEmployeeIds, isPracticeAdmin);
    const canClaim = canClaimTask(row, myEmployeeIds);
    return (
      <article key={row.id} className="pims-task-card">
        {tab === 'upcoming' && (
          <label className="pims-task-card__pick">
            <input
              type="checkbox"
              checked={selectedIds.has(row.id)}
              onChange={(e) => toggleSelected(row.id, e.target.checked)}
              aria-label={`Select ${row.title}`}
            />
          </label>
        )}
        <div className="pims-task-card__top">
          <Link className="pims-task-card__title" to={`?taskId=${row.id}`}>
            {row.title}
          </Link>
          <div className="pims-task-card__pills">
            {row.kind === 'callback' ||
            isInvoiceAutomationTask(row) ||
            isSoapAutomationTask(row) ? (
              <span className="pims-task-card__kind">
                {isInvoiceAutomationTask(row)
                  ? taskKindLabel('invoice')
                  : isSoapAutomationTask(row)
                    ? taskKindLabel('soap')
                    : taskKindLabel(row.kind)}
              </span>
            ) : null}
            {row.status === 'done' ? (
              // Done, given up on, and closed by the system all live in Completed.
              // Say which, so the list is not a pile of undifferentiated "Done".
              <span
                className={`pims-task-card__pill pims-task-card__pill--res-${
                  row.resolution ?? 'completed'
                }`}
                title={row.resolutionNote ?? undefined}
              >
                {taskResolutionLabel(row.resolution)}
              </span>
            ) : (
              <span
                className={`pims-task-card__pill pims-task-card__pill--${
                  links?.some((l) => l.entityType === 'mail_order')
                    ? mailOrderTaskStatusClass(row.status)
                    : row.status
                }`}
              >
                {mailOrderTaskStatusLabel(row.status, links)}
              </span>
            )}
          </div>
        </div>
        <p className="pims-task-card__due pims-task-card__due--start">
          {humanStartLine(taskStartIso(row)) ?? 'No start date set'}
        </p>
        <p className="pims-task-card__due">{humanDueLine(row.dueAt)}</p>
        {isOrderListAutomationTask(row) ? (
          <div className="pims-task-card__linked">
            <Link className="pims-task-card__link" to={orderListPath(row.branchIds?.[0])}>
              {row.branchIds?.[0] != null
                ? `${branchMap.get(row.branchIds[0]) ?? 'Office'} order list`
                : 'Order list'}
            </Link>
          </div>
        ) : links && links.length > 0 ? (
          <div className="pims-task-card__linked">
            <span className="pims-task-card__linked-label">Linked:</span>{' '}
            {links.map((l, i) => (
              <span key={l.id ?? `${l.entityType}-${l.entityId}-${i}`}>
                {i > 0 ? ' · ' : null}
                <TaskLinkInline link={l} labels={linkLabels} />
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
          {row.assignedToEmployeeId != null ? (
            <span className="pims-task-card__assignee">
              {tab === 'sent' ? 'Assigned to ' : ''}
              {employeeMap.get(row.assignedToEmployeeId) ?? `Employee #${row.assignedToEmployeeId}`}
            </span>
          ) : (
            <span className="pims-task-card__assignee">
              Unassigned
              {row.queueRoleId != null ? ` · ${roleMap.get(row.queueRoleId) ?? `role #${row.queueRoleId}`}` : ''}
            </span>
          )}
        </div>
        {(canAct || canClaim) && (
          <div className="pims-task-card__actions">
            {canClaim ? (
              <button
                type="button"
                className="pims-task-card__btn pims-task-card__btn--reassign"
                onClick={() => void handleClaim(row.id)}
              >
                Assign to me
              </button>
            ) : null}
            {canAct && row.kind !== 'callback' ? (
              <button type="button" className="pims-task-card__btn pims-task-card__btn--done" onClick={() => void handleMarkDone(row.id)}>
                Mark done
              </button>
            ) : null}
            {canAct ? (
              <button
                type="button"
                className="pims-task-card__btn pims-task-card__btn--reassign"
                title="Change who owns it, when it starts, or when it is due"
                onClick={() => setReassignTask(row)}
              >
                Move
              </button>
            ) : null}
            {canAct ? (
              <button
                type="button"
                className="pims-task-card__btn pims-task-card__btn--remove"
                title="Remove — this no longer needs doing"
                aria-label={`Remove ${row.title}`}
                onClick={() => setRemoveTarget(row)}
              >
                ×
              </button>
            ) : null}
          </div>
        )}
      </article>
    );
  };

  return (
    <div className="pims-tasks">
      <div className="pims-tasks__head">
        <button type="button" className="pims-tasks__add" onClick={() => setCreateOpen(true)}>
          + Task
        </button>
        <div>
          <h1 className="pims-tasks__title">
            {tab === 'sent'
              ? 'Sent tasks'
              : tab === 'watching'
                ? 'Watching'
                : tab === 'unassigned'
                  ? 'Unassigned'
                  : tab === 'upcoming'
                    ? 'Future tasks'
                    : 'Tasks'}
          </h1>
          {tab === 'sent' && <p className="pims-tasks__subtitle">Created by me</p>}
          {tab === 'active' && <p className="pims-tasks__subtitle">Assigned to me — due now</p>}
          {tab === 'expired' && <p className="pims-tasks__subtitle">Assigned to me — overdue</p>}
          {tab === 'upcoming' && (
            <p className="pims-tasks__subtitle">
              Assigned to me, not due yet — re-assign before time off
            </p>
          )}
          {tab === 'watching' && <p className="pims-tasks__subtitle">Tasks you watch (not assigned to you)</p>}
          {tab === 'unassigned' && (
            <p className="pims-tasks__subtitle">
              Open queue — grab one, or filter by branch and role (CL / Brunswick)
            </p>
          )}
        </div>
      </div>

      <div className="pims-tasks__toolbar">
        <div className="pims-tasks__tabs" role="tablist" aria-label="Task views">
          {(
            [
              ['active', `Active (${taskSummary.assigned.active})`],
              ['expired', `Expired (${taskSummary.assigned.expired})`],
              ['upcoming', `Future (${taskSummary.assigned.upcoming})`],
              [
                'unassigned',
                `Unassigned (${taskSummary.unassigned?.total ?? unassignedListTotal})`,
              ],
              ['watching', `Watching (${watchingTabCount})`],
              ['sent', 'Sent'],
              ['completed', 'Completed'],
            ] satisfies [TabId, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`pims-tasks__tab${tab === id ? ' pims-tasks__tab--selected' : ''}${
                id === 'active' ? ' pims-tasks__tab--assigned' : ''
              }${id === 'upcoming' ? ' pims-tasks__tab--future' : ''}${
                id === 'watching' ? ' pims-tasks__tab--watching' : ''
              }${id === 'unassigned' ? ' pims-tasks__tab--unassigned' : ''}`}
              onClick={() => setTab(id as TabId)}
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
        {tab === 'unassigned' && (
          <label className="pims-tasks__filter">
            <span>Role</span>
            <select
              className="pims-tasks__select"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              aria-label="Filter by role"
            >
              <option value="">Any role</option>
              {roles.map((r) => (
                <option key={r.id} value={String(r.id)}>
                  {queueRoleLabel(r)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {showListCapAlert && (
        <p className="pims-tasks__count pims-tasks__count--warn" role="alert">
          Only the most recent {CLIENT_FILTER_CAP} tasks are shown.
        </p>
      )}
      {(isBucketTab(tab) || tab === 'watching' || tab === 'sent') && myEmployeeIds.length === 0 && (
        <p className="pims-tasks__count pims-tasks__count--warn">
          Your session does not include an employee id, so assigned and sent filters cannot run. Match your login email to an employee record or add employeeId to your JWT.
        </p>
      )}

      <p className="pims-tasks__count">
        {tab === 'completed' ? (
          <>
            {loading && items.length === 0 ? 'Loading…' : `${items.length} shown`}
            {total > 0 && ` · ${total} total`}
          </>
        ) : (
          !loading && `${items.length} task${items.length === 1 ? '' : 's'}`
        )}
      </p>

      {tab === 'upcoming' && items.length > 0 && myEmployeeId != null && (
        <div className="pims-tasks__bulk">
          <label className="pims-tasks__bulk-select">
            <input
              type="checkbox"
              checked={items.length > 0 && items.every((t) => selectedIds.has(t.id))}
              onChange={(e) => {
                if (e.target.checked) setSelectedIds(new Set(items.map((t) => t.id)));
                else setSelectedIds(new Set());
              }}
            />
            Select all
          </label>
          <button
            type="button"
            className="pims-tasks__bulk-btn"
            disabled={selectedIds.size === 0}
            onClick={() => setBulkReassignIds([...selectedIds])}
          >
            Re-assign selected ({selectedIds.size})
          </button>
          <button
            type="button"
            className="pims-tasks__bulk-btn"
            onClick={() => setBulkReassignIds(items.map((t) => t.id))}
          >
            Re-assign all on this tab
          </button>
        </div>
      )}

      {error && <div className="pims-tasks__error">{error}</div>}

      <div className="pims-tasks__board">
        {tab === 'completed' ? (
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
        <TaskReassignModal
          task={reassignTask}
          employees={employees}
          onClose={() => setReassignTask(null)}
          onSaved={() => {
            setReassignTask(null);
            refreshList();
            notifyTasksChanged();
          }}
        />
      )}

      {removeTarget && (
        <TaskRemoveModal
          task={removeTarget}
          onClose={() => setRemoveTarget(null)}
          onRemoved={() => {
            setRemoveTarget(null);
            refreshList();
            notifyTasksChanged();
          }}
        />
      )}

      {bulkReassignIds && myEmployeeId != null && (
        <TaskReassignModal
          bulk={{
            fromEmployeeId: myEmployeeId,
            taskIds: bulkReassignIds,
            upcomingOnly: true,
            label: `Move ${bulkReassignIds.length} future task${
              bulkReassignIds.length === 1 ? '' : 's'
            } to someone else`,
          }}
          employees={employees.filter((e) => e.id !== myEmployeeId && e.isActive !== false)}
          requireAssignee
          onClose={() => setBulkReassignIds(null)}
          onSaved={() => {
            setBulkReassignIds(null);
            setSelectedIds(new Set());
            refreshList();
            notifyTasksChanged();
          }}
        />
      )}

      {createOpen && (
        <CreateTaskModal
          branches={branches}
          myBranchIds={taskSummary.myBranchIds ?? []}
          employees={employees}
          roles={roles}
          isPracticeAdmin={isPracticeAdmin}
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            setCreateOpen(false);
            refreshList();
            notifyTasksChanged();
            const next = new URLSearchParams(searchParams);
            next.set('taskId', String(id));
            setSearchParams(next, { replace: false });
          }}
        />
      )}
    </div>
  );
}

function TaskLinkInline({
  link,
  labels,
}: {
  link: TaskLinkRow;
  labels: Record<string, string>;
}) {
  const label = taskLinkDisplayLabel(link, labels);
  if (link.entityType === 'patient') {
    return (
      <Link className="pims-task-card__link" to={`/schedule/patients?patientId=${encodeURIComponent(String(link.entityId))}`}>
        {label}
      </Link>
    );
  }
  if (link.entityType === 'client') {
    return (
      <Link className="pims-task-card__link" to={`/schedule/clients?clientId=${encodeURIComponent(String(link.entityId))}`}>
        {label}
      </Link>
    );
  }
  if (link.entityType === 'appointment') {
    return (
      <Link className="pims-task-card__link" to={buildSchedulerFocusAppointmentUrl(link.entityId)}>
        {label}
      </Link>
    );
  }
  return <span>{label}</span>;
}

type ModalProps = {
  branches: PracticeBranch[];
  /** Branches the signed-in employee belongs to (from /tasks/summary). */
  myBranchIds: number[];
  employees: Employee[];
  roles: EmployeeRole[];
  isPracticeAdmin: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
};

function CreateTaskModal({
  branches,
  myBranchIds,
  employees,
  roles,
  isPracticeAdmin,
  onClose,
  onCreated,
}: ModalProps) {
  const { token } = useAuth();
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);
  const [taskType, setTaskType] = useState<'todo' | 'callback'>('todo');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [dueLocal, setDueLocal] = useState('');
  const [startLocal, setStartLocal] = useState(() => applyStartToday());
  const [dueStartMode, setDueStartMode] = useState<DueStartMode>('today');
  const [dueAmount, setDueAmount] = useState('1');
  const [dueUnit, setDueUnit] = useState<DueScheduleUnit>('weeks');
  const [assignee, setAssignee] = useState('');
  const [queueRoleId, setQueueRoleId] = useState('');
  const [watchers, setWatchers] = useState<number[]>([]);
  const [priority, setPriority] = useState<TaskPriorityChoice>('normal');
  const [linkedKind, setLinkedKind] = useState<'patient' | 'client'>('patient');
  const [linkedPick, setLinkedPick] = useState<LinkPick | null>(null);
  const [clientPick, setClientPick] = useState<LinkPick | null>(null);
  const [patientPick, setPatientPick] = useState<LinkPick | null>(null);
  const [householdPets, setHouseholdPets] = useState<LinkPick[]>([]);
  const [petsLoading, setPetsLoading] = useState(false);
  const isCallback = taskType === 'callback';

  useEffect(() => {
    if (!isCallback || !clientPick) {
      setHouseholdPets([]);
      setPetsLoading(false);
      return;
    }
    let canceled = false;
    setPetsLoading(true);
    void fetchClientByIdStaff(clientPick.id)
      .then((raw) => {
        if (canceled) return;
        const pets = householdPetsFromClient(raw);
        setHouseholdPets(pets);
        setPatientPick((cur) => {
          if (!cur) return pets.length === 1 ? pets[0]! : cur;
          if (pets.length === 0) return cur;
          if (pets.some((p) => p.id === cur.id)) return cur;
          return null;
        });
      })
      .catch(() => {
        if (!canceled) setHouseholdPets([]);
      })
      .finally(() => {
        if (!canceled) setPetsLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [isCallback, clientPick?.id]);

  useEffect(() => {
    if (!isCallback || !patientPick || clientPick) return;
    const fromSource = patientPick.source ? clientPickFromPatientRecord(patientPick.source) : null;
    if (fromSource) {
      setClientPick(fromSource);
      return;
    }
    let canceled = false;
    void fetchPatientByIdStaff(patientPick.id)
      .then((raw) => {
        const next = clientPickFromPatientRecord(raw);
        if (!canceled && next) setClientPick(next);
      })
      .catch(() => undefined);
    return () => {
      canceled = true;
    };
  }, [isCallback, patientPick?.id, patientPick?.source, clientPick]);
  const [branchSel, setBranchSel] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const selectableBranches = useMemo(() => {
    const active = branches.filter((b) => b.isActive !== false);
    if (isPracticeAdmin) return active;
    if (myBranchIds.length === 0) return active;
    const allowed = new Set(myBranchIds);
    const mine = active.filter((b) => allowed.has(b.id));
    return mine.length > 0 ? mine : active;
  }, [branches, isPracticeAdmin, myBranchIds]);

  useEffect(() => {
    if (dueStartMode === 'today') {
      setStartLocal(applyStartToday());
      setDueLocal('');
      return;
    }
    const amt = Number(dueAmount);
    if (!Number.isFinite(amt) || amt < 1) return;
    setStartLocal(applyStartSchedule(amt, dueUnit));
    setDueLocal('');
  }, [dueAmount, dueUnit, dueStartMode]);

  const submit = async () => {
    const selectedBranchIds = selectableBranches.filter((b) => branchSel[b.id]).map((b) => b.id);
    if (!title.trim()) {
      setFormError('Enter a task title');
      return;
    }
    const assigneeId = assignee === '' ? null : Number(assignee);
    if (assignee !== '' && !Number.isFinite(assigneeId)) {
      setFormError('Invalid assignee');
      return;
    }

    const linksPayload: { entityType: TaskLinkEntityType; entityId: number }[] = [];
    if (isCallback) {
      if (!clientPick || !Number.isFinite(clientPick.id)) {
        setFormError('Link a client so staff can open the call from this callback.');
        return;
      }
      linksPayload.push({ entityType: 'client', entityId: clientPick.id });
      if (patientPick && Number.isFinite(patientPick.id)) {
        linksPayload.push({ entityType: 'patient', entityId: patientPick.id });
      }
    } else if (linkedPick && Number.isFinite(linkedPick.id)) {
      const et: TaskLinkEntityType = linkedKind === 'client' ? 'client' : 'patient';
      linksPayload.push({ entityType: et, entityId: linkedPick.id });
    }

    const startAt = fromDatetimeLocalValue(startLocal);
    const dueAt = fromDatetimeLocalValue(dueLocal);
    if (!startAt) {
      setFormError('Choose a start date and time');
      return;
    }
    const scheduleErr = validateTaskScheduleOrder(startAt, dueAt);
    if (scheduleErr) {
      setFormError(scheduleErr);
      return;
    }

    setBusy(true);
    setFormError(null);
    try {
      const created = await createTask({
        title: title.trim(),
        body: body.trim() || null,
        branchIds: selectedBranchIds,
        assignedToEmployeeId: assigneeId,
        ...(queueRoleId ? { queueRoleId: Number(queueRoleId) } : {}),
        startAt,
        dueAt,
        priority: priorityToApi(priority),
        watcherEmployeeIds: [...new Set(watchers)],
        links: linksPayload.length ? linksPayload : undefined,
        ...(isCallback ? { kind: 'callback' as TaskKind } : {}),
      });
      notifyTasksChanged();
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
          <h2 id="pims-tasks-create-title">{isCallback ? 'New callback' : 'Create task'}</h2>
          <button type="button" className="pims-tasks__modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="pims-tasks__modal-form">
          {formError && <p className="pims-tasks__error">{formError}</p>}
          <div className="pims-tasks__modal-field">
            <span>Type</span>
            <div className="pims-tasks__type-picks" role="radiogroup" aria-label="Task type">
              <button
                type="button"
                role="radio"
                aria-checked={!isCallback}
                className={`pims-tasks__type-pick${!isCallback ? ' pims-tasks__type-pick--on' : ''}`}
                disabled={busy}
                onClick={() => setTaskType('todo')}
              >
                <strong>To-do</strong>
                <span>General staff work. Mark done when it’s finished.</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={isCallback}
                className={`pims-tasks__type-pick${isCallback ? ' pims-tasks__type-pick--on' : ''}`}
                disabled={busy}
                onClick={() => setTaskType('callback')}
              >
                <strong>Callback</strong>
                <span>Call the client in Quo, bring in the transcript, then chart it.</span>
              </button>
            </div>
          </div>

          <label className="pims-tasks__modal-field">
            <span>{isCallback ? 'What to ask' : 'Task'}</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
              placeholder={isCallback ? 'e.g. How is the rash?' : 'What needs to be done?'}
            />
          </label>

          <label className="pims-tasks__modal-field">
            <span>{isCallback ? 'Who calls' : 'Assign to'}</span>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={busy}>
              <option value="">Unassigned</option>
              {employees.map((em) => (
                <option key={em.id} value={String(em.id)}>
                  {formatEmployeeDisplayName(em) || em.email}
                </option>
              ))}
            </select>
            <span className="pims-tasks__field-hint">
              The person is what matters. Leave unassigned to put it on the queue — then optionally a role and branch, like CL / Brunswick.
            </span>
          </label>

          <label className="pims-tasks__modal-field">
            <span>For role</span>
            <select value={queueRoleId} onChange={(e) => setQueueRoleId(e.target.value)} disabled={busy}>
              <option value="">Any role</option>
              {roles.map((r) => (
                <option key={r.id} value={String(r.id)}>
                  {queueRoleLabel(r)}
                </option>
              ))}
            </select>
            <span className="pims-tasks__field-hint">Optional. Used when this sits on the unassigned queue.</span>
          </label>

          <div className="pims-tasks__modal-field">
            <div className="pims-tasks__watchers-head">
              <span>Also notify (watchers)</span>
              <button
                type="button"
                className="pims-tasks__watchers-clear"
                disabled={busy || watchers.length === 0}
                onClick={() => setWatchers([])}
              >
                Clear watchers
              </button>
            </div>
            <div className="pims-tasks__checks pims-tasks__checks--scroll">
              {employees.map((em) => {
                const emName = formatEmployeeDisplayName(em) || em.email;
                const checked = watchers.includes(em.id);
                return (
                  <label key={em.id} className="pims-tasks__check">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={busy}
                      onChange={(e) => {
                        setWatchers((prev) =>
                          e.target.checked ? [...prev, em.id] : prev.filter((id) => id !== em.id)
                        );
                      }}
                    />
                    {emName}
                  </label>
                );
              })}
            </div>
            <span className="pims-tasks__field-hint">Optional. Use Clear watchers if none should be notified.</span>
          </div>

          <div className="pims-tasks__modal-field">
            <span id="due-start-label">When to start</span>
            <div className="pims-tasks__due-start" role="radiogroup" aria-labelledby="due-start-label">
              <label className="pims-tasks__due-start-option">
                <input
                  type="radio"
                  name="dueStartMode"
                  value="today"
                  checked={dueStartMode === 'today'}
                  onChange={() => setDueStartMode('today')}
                  disabled={busy}
                />
                Today
              </label>
              <label className="pims-tasks__due-start-option pims-tasks__due-start-option--relative">
                <input
                  type="radio"
                  name="dueStartMode"
                  value="relative"
                  checked={dueStartMode === 'relative'}
                  onChange={() => setDueStartMode('relative')}
                  disabled={busy}
                />
                <input
                  type="number"
                  min={1}
                  value={dueAmount}
                  onChange={(e) => setDueAmount(e.target.value)}
                  disabled={busy || dueStartMode !== 'relative'}
                  aria-label="Amount"
                />
                <select
                  value={dueUnit}
                  onChange={(e) => setDueUnit(e.target.value as DueScheduleUnit)}
                  disabled={busy || dueStartMode !== 'relative'}
                  aria-label="Time unit"
                >
                  <option value="days">days</option>
                  <option value="weeks">weeks</option>
                  <option value="months">months</option>
                </select>
                <span className="pims-tasks__due-schedule-suffix">from now</span>
              </label>
            </div>
            <span className="pims-tasks__field-hint">
              Choose Today or a time from now to set Start. Due stays blank unless you set it below.
            </span>
          </div>

          <div className="pims-tasks__modal-row2">
            <label className="pims-tasks__modal-field">
              <span>Start</span>
              <input
                type="datetime-local"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
                disabled={busy}
                required
              />
              <span className="pims-tasks__field-hint">When work should begin (required).</span>
            </label>
            <label className="pims-tasks__modal-field">
              <span>Due</span>
              <input type="datetime-local" value={dueLocal} onChange={(e) => setDueLocal(e.target.value)} disabled={busy} />
              <span className="pims-tasks__field-hint">Deadline. Clear to leave unset.</span>
            </label>
          </div>

          <label className="pims-tasks__modal-field">
            <span>Priority</span>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriorityChoice)}
              disabled={busy}
            >
              <option value="normal">Not Urgent</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>

          {isCallback ? (
            <>
              <div className="pims-tasks__modal-field">
                <span>Client</span>
                <TaskLinkEntityPicker
                  kind="client"
                  disabled={busy}
                  value={clientPick}
                  onChange={(next) => {
                    setClientPick(next);
                    if (!next) {
                      setPatientPick(null);
                      setHouseholdPets([]);
                    }
                  }}
                  practiceId={practiceId}
                />
                <span className="pims-tasks__field-hint">
                  Required. Pick a client to see their patients, or start with a patient below.
                </span>
              </div>
              <div className="pims-tasks__modal-field">
                <span>Patient (for the chart)</span>
                {clientPick ? (
                  petsLoading ? (
                    <span className="pims-tasks__field-hint">Loading patients…</span>
                  ) : householdPets.length === 0 ? (
                    <span className="pims-tasks__field-hint">No patients on this client.</span>
                  ) : (
                    <select
                      value={patientPick ? String(patientPick.id) : ''}
                      disabled={busy}
                      onChange={(e) => {
                        const id = Number(e.target.value);
                        setPatientPick(householdPets.find((p) => p.id === id) ?? null);
                      }}
                    >
                      <option value="">Choose a patient…</option>
                      {householdPets.map((p) => (
                        <option key={p.id} value={String(p.id)}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  )
                ) : (
                  <TaskLinkEntityPicker
                    kind="patient"
                    disabled={busy}
                    value={patientPick}
                    onChange={setPatientPick}
                    practiceId={practiceId}
                  />
                )}
                <span className="pims-tasks__field-hint">
                  {clientPick
                    ? 'Patients in this household.'
                    : 'Search a patient and the client fills in.'}
                </span>
              </div>
            </>
          ) : (
            <div className="pims-tasks__modal-field">
              <span>Linked to (optional)</span>
              <div className="pims-tasks__modal-inline pims-tasks__modal-inline--link">
                <select
                  value={linkedKind}
                  onChange={(e) => {
                    setLinkedKind(e.target.value as 'patient' | 'client');
                    setLinkedPick(null);
                  }}
                  disabled={busy}
                >
                  <option value="patient">Patient</option>
                  <option value="client">Client</option>
                </select>
                <TaskLinkEntityPicker
                  kind={linkedKind}
                  disabled={busy}
                  value={linkedPick}
                  onChange={setLinkedPick}
                  practiceId={practiceId}
                />
              </div>
            </div>
          )}

          <label className="pims-tasks__modal-field">
            <span>Notes</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              disabled={busy}
              placeholder={
                isCallback
                  ? "What to listen for, what to do if it's worse…"
                  : 'Details, instructions, context…'
              }
            />
          </label>

          <div className="pims-tasks__modal-field">
            <span>Branch</span>
            <div className="pims-tasks__checks">
              <label className="pims-tasks__check">
                <input
                  type="checkbox"
                  checked={selectableBranches.every((b) => !branchSel[b.id])}
                  onChange={() => setBranchSel({})}
                  disabled={busy}
                />
                Unassigned
              </label>
              {selectableBranches.map((b) => (
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
            <span className="pims-tasks__field-hint">
              Optional. Unassigned means no branch — or pick Brunswick (and others) to park it there.
            </span>
          </div>
        </div>
        <div className="pims-tasks__modal-actions pims-tasks__modal-actions--center">
          <button type="button" className="pims-tasks__modal-cancel" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="pims-tasks__modal-submit" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Creating…' : isCallback ? 'Create callback' : 'Create task'}
          </button>
        </div>
      </div>
    </div>
  );
}
