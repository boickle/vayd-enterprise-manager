import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Pencil,
  UserPlus,
  X,
} from 'lucide-react';
import {
  completeTask,
  getTask,
  patchTask,
  taskKindLabel,
  taskResolutionLabel,
  type TaskDetail,
  type TaskLinkEntityType,
  TASK_LINK_ENTITY_TYPES,
} from '../../api/tasks';
import { respondMailApproval } from '../../api/onlineStore';
import type { PracticeBranch } from '../../api/branchInventory';
import type { Employee, EmployeeRole } from '../../api/appointmentSettings';
import { formatEmployeeDisplayName } from '../../utils/employeeDisplayName';
import {
  formatTaskIso,
  fromDatetimeLocalValue,
  taskStartIso,
  toDatetimeLocalValue,
  validateTaskScheduleOrder,
} from '../../utils/taskDateTime';
import { priorityApiLabel } from '../../utils/taskPriority';
import { taskLinkDisplayLabel, useTaskLinkLabels } from '../../utils/taskLinkDisplay';
import { buildSchedulerFocusAppointmentUrl } from '../../utils/schedulerFocusAppointment';
import {
  taskDescriptionDisplayBody,
} from '../../utils/forwardBookingCreateLink';
import { TaskBodyContent } from './TaskBodyContent';
import { ForwardBookingFromTaskLink } from './ForwardBookingFromTaskLink';
import ForwardBookingTaskPanel from './ForwardBookingTaskPanel';
import InvoiceTaskPanel from './InvoiceTaskPanel';
import SoapTaskPanel from './SoapTaskPanel';
import LabResultTaskPanel from './LabResultTaskPanel';
import { getInvoice } from '../../api/visitWorkflow';
import { invoiceIdFromTask } from '../../utils/invoiceTask';
import { soapPathFromTaskLinks } from '../../utils/soapTask';
import OrderListTaskPanel from './OrderListTaskPanel';
import MailOrderTaskPanel from './MailOrderTaskPanel';
import CallbackJotPanel from './CallbackJotPanel';
import { taskPanelKind } from '../../utils/taskPanelKind';
import TaskReassignModal from './TaskReassignModal';
import TaskRemoveModal from './TaskRemoveModal';
import {
  mailOrderTaskStatusClass,
  mailOrderTaskStatusLabel,
} from '../../utils/mailOrderTaskStatus';
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
    removed: 'Removed',
    escalation_sent: 'Escalation reminder',
    body_changed: 'Description changed',
    due_changed: 'Due date changed',
    due_at_changed: 'Due date changed',
    start_at_changed: 'Start date changed',
    title_changed: 'Title changed',
  };
  return known[eventType] ?? eventType.replace(/_/g, ' ');
}

/** The reason a task was removed, or which record closed it automatically. */
function resolutionDetail(eventType: string, payload: unknown): string | null {
  if (eventType !== 'completed' && eventType !== 'removed') return null;
  if (!payload || typeof payload !== 'object') return null;
  const note = (payload as Record<string, unknown>).note;
  return typeof note === 'string' && note.trim() ? note.trim() : null;
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
      return `/schedule/patients?patientId=${encodeURIComponent(String(entityId))}`;
    case 'client':
      return `/schedule/clients?clientId=${encodeURIComponent(String(entityId))}`;
    case 'appointment':
      return buildSchedulerFocusAppointmentUrl(entityId);
    case 'mail_order':
      return `/schedule/mail-orders?orderId=${encodeURIComponent(String(entityId))}`;
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

function queueRoleLabel(role: Pick<EmployeeRole, 'name' | 'roleValue'>): string {
  const name = (role.name ?? '').trim();
  if (/receptionist/i.test(name) || String(role.roleValue).toLowerCase() === 'receptionist') {
    return 'CL';
  }
  return name || `Role ${String(role.roleValue)}`;
}

type Props = {
  taskId: number;
  branches: PracticeBranch[];
  employees: Employee[];
  roles?: EmployeeRole[];
  myEmployeeId: number | null;
  isPracticeAdmin: boolean;
  /** Just came back from adding this task's forward booking — show the confirmation. */
  forwardBookingJustAdded?: boolean;
  onBack: () => void;
  onUpdated: () => void;
};

export default function PimsTaskDetailView({
  taskId,
  branches,
  employees,
  roles = [],
  myEmployeeId,
  isPracticeAdmin,
  forwardBookingJustAdded = false,
  onBack,
  onUpdated,
}: Props) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

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
      setTask((cur) => cur);
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

  const inQueue = task?.status === 'open' && task.assignedToEmployeeId == null;
  const canClaim = Boolean(inQueue && myEmployeeId != null && task?.status !== 'done');

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
    return (task.watchers ?? []).some((w) => w.employeeId === myEmployeeId);
  }, [task, myEmployeeId, canMutate]);

  const latestEscalation = task?.events?.[0]?.eventType === 'escalation_sent';
  const linkLabels = useTaskLinkLabels(task?.links);
  const patientLinks = useMemo(
    () => (task?.links ?? []).filter((l) => l.entityType === 'patient'),
    [task?.links],
  );
  const clientLink = task?.links?.find((l) => l.entityType === 'client') ?? null;
  const patientName = patientLinks[0] ? taskLinkDisplayLabel(patientLinks[0], linkLabels) : null;
  const clientName = clientLink ? taskLinkDisplayLabel(clientLink, linkLabels) : null;
  const invoiceId = task ? invoiceIdFromTask(task) : null;
  const [invoicePets, setInvoicePets] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => {
    if (!invoiceId) {
      setInvoicePets([]);
      return;
    }
    let canceled = false;
    void getInvoice(invoiceId)
      .then((invoice) => {
        if (canceled) return;
        const names = new Map<number, string>();
        if (invoice.patientId != null) names.set(invoice.patientId, `Patient #${invoice.patientId}`);
        for (const line of invoice.lines ?? []) {
          if (line.patientId == null) continue;
          const label = line.patientName?.trim() || `Patient #${line.patientId}`;
          names.set(line.patientId, label);
        }
        setInvoicePets([...names.entries()].map(([id, name]) => ({ id, name })));
      })
      .catch(() => {
        if (!canceled) setInvoicePets([]);
      });
    return () => {
      canceled = true;
    };
  }, [invoiceId]);

  const chartPets = useMemo(() => {
    const byId = new Map<number, string>();
    for (const pet of invoicePets) byId.set(pet.id, pet.name);
    for (const link of patientLinks) {
      byId.set(link.entityId, taskLinkDisplayLabel(link, linkLabels));
    }
    return [...byId.entries()].map(([id, name]) => ({ id, name }));
  }, [invoicePets, patientLinks, linkLabels]);
  const taskDescriptionBody = useMemo(
    () => taskDescriptionDisplayBody(task?.body),
    [task?.body]
  );
  /** Which tools this task gets. Add a kind, not another condition down here. */
  const panelKind = useMemo(() => (task ? taskPanelKind(task) : 'todo'), [task]);
  const showPanels =
    task != null && task.status !== 'done' && (canMutate || canClaim);
  /** Chart note / reassign / remove. Panels that own the whole task replace it. */
  const showJot =
    showPanels &&
    panelKind !== 'order_list' &&
    panelKind !== 'mail_order' &&
    panelKind !== 'soap' &&
    panelKind !== 'lab_result';

  const eventsChronological = useMemo(() => {
    if (!task?.events?.length) return [];
    return [...task.events].sort(
      (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime()
    );
  }, [task?.events]);

  const [approvalNote, setApprovalNote] = useState('');
  const mailOrderId = task?.links?.find((l) => l.entityType === 'mail_order')?.entityId ?? null;

  const handleMailApproval = async (
    outcome: 'approved' | 'rejected' | 'send_back',
    lineRefills?: Array<{ lineId: number; refills: number; expiration?: string | null }>,
    lineScripts?: Array<{ lineId: number; scriptText: string }>,
    approvalBasis?: 'standard' | 'chart' | 'refills',
  ) => {
    if (!task || mailOrderId == null || !canMutate) return;
    setBusy(true);
    setActionError(null);
    try {
      await respondMailApproval(task.practiceId, mailOrderId, {
        outcome,
        notes: approvalNote.trim() || undefined,
        approvalBasis: outcome === 'approved' ? approvalBasis || 'standard' : undefined,
        taskId: task.id,
        lineRefills,
        lineScripts,
      });
      setApprovalNote('');
      const d = await getTask(task.id);
      setTask(d);
      onUpdated();
    } catch (e: unknown) {
      setActionError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

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
    if (!task || myEmployeeId == null || !canClaim) return;
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

  const showClaim = canClaim;

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
                  className="pims-task-detail__btn pims-task-detail__btn--remove"
                  title="Remove — this no longer needs doing"
                  disabled={busy}
                  onClick={() => {
                    setActionError(null);
                    setRemoveOpen(true);
                  }}
                >
                  <X size={18} />
                  Remove
                </button>
              )}
              {canMutate && task.status !== 'done' && (
                <button
                  type="button"
                  className="pims-task-detail__btn pims-task-detail__btn--secondary"
                  title="Change who owns it, when it starts, or when it is due"
                  disabled={busy}
                  onClick={() => {
                    setActionError(null);
                    setReassignOpen(true);
                  }}
                >
                  <UserPlus size={18} />
                  Move
                </button>
              )}
              {canMutate && task.status !== 'done' && mailOrderId != null && (
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

      {(actionError || (loadError && task)) && (
        <p className="pims-task-detail__error">{actionError || loadError}</p>
      )}

      {editing ? (
        <TaskEditForm
          key={`${task.id}-${task.updated}`}
          task={task}
          branches={branches}
          employees={employees}
          roles={roles}
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
        {(chartPets.length > 0 || clientLink) && (
          <p className="pims-task-detail__subject">
            {chartPets.map((pet, i) => (
              <span key={pet.id} className="pims-task-detail__subject-pet">
                {i > 0 ? <span className="pims-task-detail__subject-sep">·</span> : null}
                <a
                  className="pims-task-detail__subject-link"
                  href={linkHref('patient', pet.id) ?? '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {pet.name}
                  <ExternalLink size={14} aria-hidden />
                  <span className="pims-task-detail__subject-hint">Chart</span>
                </a>
              </span>
            ))}
            {chartPets.length > 0 && clientLink ? (
              <span className="pims-task-detail__subject-sep">·</span>
            ) : null}
            {clientLink ? (
              <a
                className="pims-task-detail__subject-link"
                href={linkHref('client', clientLink.entityId) ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
              >
                {clientName}
                <ExternalLink size={14} aria-hidden />
              </a>
            ) : null}
          </p>
        )}
        <div className="pims-task-detail__meta">
          {task.status === 'done' ? (
            <span
              className={`pims-task-detail__status pims-task-detail__status--res-${
                task.resolution ?? 'completed'
              }`}
            >
              {taskResolutionLabel(task.resolution)}
            </span>
          ) : (
            <span
              className={`pims-task-detail__status pims-task-detail__status--${
                mailOrderId != null
                  ? mailOrderTaskStatusClass(task.status)
                  : task.status
              }`}
            >
              {mailOrderTaskStatusLabel(task.status, task.links)}
            </span>
          )}
          {(task.kind === 'callback' ||
            panelKind === 'invoice' ||
            panelKind === 'soap' ||
            panelKind === 'lab_result') && (
            <span className="pims-task-detail__kind">
              {panelKind === 'invoice'
                ? taskKindLabel('invoice')
                : panelKind === 'soap'
                  ? taskKindLabel('soap')
                  : panelKind === 'lab_result'
                    ? taskKindLabel('lab_result')
                    : taskKindLabel(task.kind)}
            </span>
          )}
          {task.source !== 'manual' && mailOrderId == null && (
            <span className="pims-task-detail__pill">
              {panelKind === 'order_list' ? 'Order list' : task.source}
            </span>
          )}
        </div>
        <p className="pims-task-detail__schedule">
          <span>
            <strong>Start</strong> {formatTaskIso(taskStartIso(task))}
          </span>
          <span className="pims-task-detail__subject-sep">·</span>
          <span>
            <strong>Due</strong> {formatTaskIso(task.dueAt)}
          </span>
        </p>
        {task.status === 'done' && task.resolutionNote ? (
          <p className="pims-task-detail__resolution">
            {task.resolution === 'removed' ? 'Removed: ' : 'Closed: '}
            {task.resolutionNote}
          </p>
        ) : null}
      </header>

      {panelKind === 'mail_order' && mailOrderId != null ? (
        <MailOrderTaskPanel
          practiceId={task.practiceId}
          mailOrderId={mailOrderId}
          taskId={task.id}
          canApprove={canMutate && task.status !== 'done'}
          busy={busy}
          approvalNote={approvalNote}
          onApprovalNoteChange={setApprovalNote}
          onApprove={(outcome, lineRefills, lineScripts, approvalBasis) =>
            void handleMailApproval(outcome, lineRefills, lineScripts, approvalBasis)
          }
          onPresentationSynced={() => {
            void getTask(task.id).then(setTask).catch(() => undefined);
          }}
        />
      ) : null}

      {panelKind === 'order_list' && showPanels ? (
        <OrderListTaskPanel
          task={task}
          branchName={
            task.branchIds?.[0] != null
              ? branchMap.get(task.branchIds[0]) ?? null
              : null
          }
          canMutate={canMutate}
          busy={busy}
          onDone={() => {
            void getTask(task.id).then(setTask).catch(() => undefined);
            onUpdated();
          }}
        />
      ) : null}

      {panelKind === 'forward_booking' && forwardBookingJustAdded ? (
        <div
          className={`pims-fb-added${task.status === 'done' ? ' pims-fb-added--done' : ''}`}
          role="status"
          aria-live="polite"
        >
          <p className="pims-fb-added__row pims-fb-added__row--1">
            <CheckCircle2 size={20} aria-hidden />
            <span>
              <strong>Forward booking added</strong>
              {patientName ? ` for ${patientName}` : ''}
            </span>
          </p>
          {task.status === 'done' ? (
            <p className="pims-fb-added__row pims-fb-added__row--2">
              <CheckCircle2 size={20} aria-hidden />
              <span>
                <strong>Marked complete</strong> — this task is off your list.
              </span>
            </p>
          ) : (
            <p className="pims-fb-added__row pims-fb-added__row--2 pims-fb-added__row--pending">
              The task could not be closed automatically — use Mark complete below.
            </p>
          )}
        </div>
      ) : null}

      {panelKind === 'forward_booking' && showPanels ? (
        <ForwardBookingTaskPanel
          task={task}
          patientName={patientName}
          canComplete={canMutate}
          busy={busy}
          onComplete={() => void handleComplete()}
        />
      ) : null}

      {panelKind === 'soap' && showPanels ? (
        <SoapTaskPanel
          task={task}
          patientName={patientName}
          canComplete={canMutate}
          busy={busy}
          onComplete={() => void handleComplete()}
        />
      ) : null}

      {panelKind === 'lab_result' ? (
        <LabResultTaskPanel
          task={task}
          patientName={patientName}
          readOnly={!showPanels}
          onUpdated={() => {
            void getTask(task.id).then(setTask).catch(() => undefined);
            onUpdated();
          }}
        />
      ) : null}

      {panelKind === 'invoice' ? (
        <InvoiceTaskPanel
          task={task}
          clientName={clientName}
          employees={employees}
          myEmployeeId={myEmployeeId}
          canComplete={canMutate && task.status !== 'done'}
          canAct={showPanels}
          busy={busy}
          onComplete={() => void handleComplete()}
          onUpdated={(updated) => {
            if (updated) setTask(updated);
            else void getTask(task.id).then(setTask).catch(() => undefined);
            onUpdated();
          }}
        />
      ) : null}

      {/* Callbacks stay jot-first. Invoice and booking keep charting off the main path. */}
      {showJot ? (
        panelKind === 'forward_booking' || panelKind === 'invoice' ? (
          <details className="pims-fb-task-note">
            <summary>Leave a chart note, reassign, or remove</summary>
            <CallbackJotPanel
              task={task}
              employees={employees}
              myEmployeeId={myEmployeeId}
              patientName={patientName}
              patients={chartPets}
              clientName={clientName}
              defaultChartToClient={panelKind === 'invoice'}
              onDone={() => {
                void getTask(task.id).then(setTask).catch(() => undefined);
                onUpdated();
              }}
            />
          </details>
        ) : (
          <CallbackJotPanel
            task={task}
            employees={employees}
            myEmployeeId={myEmployeeId}
            patientName={patientName}
            patients={chartPets}
            clientName={clientName}
            onDone={() => {
              void getTask(task.id).then(setTask).catch(() => undefined);
              onUpdated();
            }}
          />
        )
      ) : null}

      <section className="pims-task-detail__section">
        <h2 className="pims-task-detail__h2">Details</h2>
        <dl className="pims-task-detail__dl">
          {mailOrderId == null && panelKind !== 'invoice' && panelKind !== 'lab_result' ? (
          <div>
            <dt>Description</dt>
            <dd>
              {taskDescriptionBody ? <TaskBodyContent body={taskDescriptionBody} /> : null}
              {panelKind === 'forward_booking' &&
              (task.status === 'done' || !(canMutate || canClaim)) ? (
                <p className="pims-task-detail__forward-booking-link">
                  <ForwardBookingFromTaskLink links={task.links} taskId={task.id} />
                </p>
              ) : null}
              {!taskDescriptionBody &&
              !(
                panelKind === 'forward_booking' &&
                (task.status === 'done' || !(canMutate || canClaim))
              ) ? (
                <>—</>
              ) : null}
            </dd>
          </div>
          ) : null}
          {mailOrderId == null ? (
          <div>
            <dt>Branches</dt>
            <dd>
              {task.branchIds?.length
                ? task.branchIds.map((id) => branchMap.get(id) ?? `#${id}`).join(', ')
                : 'Unassigned'}
            </dd>
          </div>
          ) : null}
          <div>
            <dt>Assignee</dt>
            <dd>
              {task.assignedToEmployeeId != null
                ? employeeLabel(employeeMap, task.assignedToEmployeeId)
                : 'Unassigned'}
            </dd>
          </div>
          {task.queueRoleId != null && (
            <div>
              <dt>For role</dt>
              <dd>
                {roles.find((r) => r.id === task.queueRoleId)
                  ? queueRoleLabel(roles.find((r) => r.id === task.queueRoleId)!)
                  : `Role #${task.queueRoleId}`}
              </dd>
            </div>
          )}
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
              const soapHref =
                panelKind === 'soap' && l.entityType === 'appointment'
                  ? soapPathFromTaskLinks(task.links)
                  : null;
              const href = soapHref ?? linkHref(l.entityType, l.entityId);
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
                {resolutionDetail(ev.eventType, ev.payload) ? (
                  <div className="pims-task-detail__timeline-detail">
                    {resolutionDetail(ev.eventType, ev.payload)}
                  </div>
                ) : null}
                <div className="pims-task-detail__timeline-meta">
                  {formatIso(ev.created)}
                  {/* No employee means nobody did this — say so rather than
                      leaving a blank where a name would be. */}
                  {ev.actorEmployeeId != null ? (
                    <> · {employeeLabel(employeeMap, ev.actorEmployeeId)}</>
                  ) : (
                    <> · System</>
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
            if (updated) setTask(updated);
            setReassignOpen(false);
            onUpdated();
          }}
        />
      )}

      {removeOpen && (
        <TaskRemoveModal
          task={task}
          onClose={() => setRemoveOpen(false)}
          onRemoved={(updated) => {
            setTask(updated);
            setRemoveOpen(false);
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
  roles?: EmployeeRole[];
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
  roles = [],
  isPracticeAdmin,
  busy,
  setBusy,
  setActionError,
  onSaved,
  onCancel,
}: EditProps) {
  const [title, setTitle] = useState(task.title);
  const [body, setBody] = useState(task.body ?? '');
  const [startLocal, setStartLocal] = useState(() => toDatetimeLocalValue(taskStartIso(task)));
  const [dueLocal, setDueLocal] = useState(() => toDatetimeLocalValue(task.dueAt));
  const [branchSel, setBranchSel] = useState<Record<number, boolean>>(() => {
    const m: Record<number, boolean> = {};
    for (const id of task.branchIds ?? []) m[id] = true;
    return m;
  });
  const [assignee, setAssignee] = useState<string>(
    task.assignedToEmployeeId != null ? String(task.assignedToEmployeeId) : ''
  );
  const [queueRoleId, setQueueRoleId] = useState(
    task.queueRoleId != null ? String(task.queueRoleId) : '',
  );
  const [watchers, setWatchers] = useState<number[]>(() => (task.watchers ?? []).map((w) => w.employeeId));
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
        queueRoleId: queueRoleId ? Number(queueRoleId) : null,
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
            <label className="pims-task-detail__check">
              <input
                type="checkbox"
                checked={activeBranches.every((b) => !branchSel[b.id])}
                onChange={() => setBranchSel({})}
                disabled={busy}
              />
              Unassigned
            </label>
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
        </div>

        <label className="pims-task-detail__field">
          <span>Assignee</span>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={busy}>
            <option value="">Unassigned</option>
            {employees.map((em) => (
              <option key={em.id} value={String(em.id)}>
                {formatEmployeeDisplayName(em) || em.email}
              </option>
            ))}
          </select>
        </label>

        <label className="pims-task-detail__field">
          <span>For role</span>
          <select value={queueRoleId} onChange={(e) => setQueueRoleId(e.target.value)} disabled={busy}>
            <option value="">Any role</option>
            {roles.map((r) => (
              <option key={r.id} value={String(r.id)}>
                {queueRoleLabel(r)}
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

