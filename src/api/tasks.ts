import { http } from './http';

export type TaskStatus = 'open' | 'assigned' | 'done';
export type TaskSource = 'manual' | 'trigger' | 'system';

/**
 * Why a task left the board. Status is `done` either way — this says whether the
 * work happened. `removed` means the practice decided it no longer needed doing;
 * `auto` means the record behind it (a bill, a chart, a call) closed elsewhere.
 */
export type TaskResolution = 'completed' | 'removed' | 'auto';

const TASK_RESOLUTION_LABELS: Record<TaskResolution, string> = {
  completed: 'Done',
  removed: 'Removed',
  auto: 'Auto',
};

export function taskResolutionLabel(
  resolution: TaskResolution | null | undefined
): string {
  return resolution ? TASK_RESOLUTION_LABELS[resolution] ?? 'Done' : 'Done';
}

/** What a task is for, beyond being a to-do. Decides which tools the task screen offers. */
export type TaskKind =
  | 'callback'
  | 'forward_booking'
  | 'invoice'
  | 'order_list'
  | 'soap';

const TASK_KIND_LABELS: Record<TaskKind, string> = {
  callback: 'Callback',
  forward_booking: 'Forward booking',
  invoice: 'Invoice',
  order_list: 'Order list',
  soap: 'SOAP',
};

export function taskKindLabel(kind: TaskKind | null | undefined): string {
  return kind ? TASK_KIND_LABELS[kind] ?? 'To-do' : 'To-do';
}

export const TASK_LINK_ENTITY_TYPES = [
  'appointment',
  'patient',
  'client',
  'lab_order',
  'inventory_procedure',
  'employee',
  'referral',
  'reminder',
  'mail_order',
] as const;

export type TaskLinkEntityType = (typeof TASK_LINK_ENTITY_TYPES)[number];

export type TaskLinkInput = { entityType: TaskLinkEntityType; entityId: number };

export type TaskListItem = {
  id: number;
  practiceId: number;
  title: string;
  body: string | null;
  status: TaskStatus;
  assignedToEmployeeId: number | null;
  /** When nobody is assigned, who the queue is for (employee role id). */
  queueRoleId: number | null;
  defaultAssigneeEmployeeId: number | null;
  createdByEmployeeId: number;
  /** When work should begin (scheduling window start). */
  startAt: string | null;
  /** Deadline / end of window. */
  dueAt: string | null;
  priority: number | null;
  source: TaskSource;
  /** `callback` is the vet-med sense: ring the owner and see how the patient is doing. */
  kind: TaskKind | null;
  triggerDefinitionId: string | null;
  completedAt: string | null;
  /** Set once completedAt is. Null on tasks that are still live. */
  resolution: TaskResolution | null;
  /** Why it was removed, or which record closed it automatically. */
  resolutionNote: string | null;
  created: string;
  updated: string;
  branchIds: number[];
  /** Present on list rows — caller's relationship to the task. */
  involvement?: TaskInvolvementFlags;
};

export type TaskWatcherRow = {
  employeeId: number;
  addedByEmployeeId: number | null;
  created: string;
};

export type TaskLinkRow = {
  id: number;
  entityType: string;
  entityId: number;
};

export type TaskEscalation = {
  nextEscalationAt: string;
  lastEscalationSentAt: string | null;
  escalationCount: number;
  intervalSeconds: number;
};

export type TaskEventRow = {
  id: number;
  eventType: string;
  actorEmployeeId: number | null;
  payload: unknown;
  created: string;
};

export type TaskDetail = TaskListItem & {
  idempotencyKey?: string | null;
  watchers: TaskWatcherRow[];
  links: TaskLinkRow[];
  escalation: TaskEscalation | null;
  events: TaskEventRow[];
};

export type TaskListResponse = {
  items: TaskListItem[];
  total: number;
  limit: number;
  offset: number;
};

export type TaskInvolvementFilter = 'assigned' | 'watching' | 'created' | 'unassigned';

export type TaskInvolvementFlags = {
  assignee: boolean;
  creator: boolean;
  watcher: boolean;
};

export type ListTasksParams = {
  status?: TaskStatus;
  branchId?: number;
  includeDone?: boolean;
  involvement?: TaskInvolvementFilter;
  kind?: TaskKind;
  /** Queue role — typically used with involvement=unassigned. */
  roleId?: number;
  /** Open work assigned to this employee (self, or any employee when admin). */
  assignedToEmployeeId?: number;
  /** Only tasks linked to this patient — e.g. the callbacks open on one pet. */
  patientId?: number;
  limit?: number;
  offset?: number;
};

export type TaskSummaryBucket = {
  active: number;
  expired: number;
  upcoming: number;
  total: number;
};

export type TaskSummaryResponse = {
  assigned: TaskSummaryBucket;
  watching: TaskSummaryBucket;
  unassigned?: TaskSummaryBucket;
  /** Branch ids the current employee belongs to (auto-healed to practice default when empty). */
  myBranchIds?: number[];
};

export async function listTasks(params?: ListTasksParams): Promise<TaskListResponse> {
  const { data } = await http.get<TaskListResponse>('/tasks', { params });
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    total: typeof data?.total === 'number' ? data.total : 0,
    limit: typeof data?.limit === 'number' ? data.limit : 50,
    offset: typeof data?.offset === 'number' ? data.offset : 0,
  };
}

export async function fetchTasksSummary(params?: {
  branchId?: number;
}): Promise<TaskSummaryResponse> {
  const { data } = await http.get<TaskSummaryResponse>('/tasks/summary', { params });
  const empty: TaskSummaryBucket = { active: 0, expired: 0, upcoming: 0, total: 0 };
  const assigned = data?.assigned ?? empty;
  const watching = data?.watching ?? empty;
  const unassigned = data?.unassigned ?? empty;
  return {
    assigned: {
      active: assigned.active ?? 0,
      expired: assigned.expired ?? 0,
      upcoming: assigned.upcoming ?? 0,
      total: assigned.total ?? 0,
    },
    watching: {
      active: watching.active ?? 0,
      expired: watching.expired ?? 0,
      upcoming: watching.upcoming ?? 0,
      total: watching.total ?? 0,
    },
    unassigned: {
      active: unassigned.active ?? 0,
      expired: unassigned.expired ?? 0,
      upcoming: unassigned.upcoming ?? 0,
      total: unassigned.total ?? 0,
    },
    myBranchIds: Array.isArray(data?.myBranchIds)
      ? data.myBranchIds.filter((id): id is number => Number.isFinite(Number(id))).map(Number)
      : [],
  };
}

export async function getTask(id: number): Promise<TaskDetail> {
  const { data } = await http.get<TaskDetail>(`/tasks/${id}`);
  return data;
}

export type CreateTaskBody = {
  title: string;
  branchIds?: number[];
  assignedToEmployeeId?: number | null;
  queueRoleId?: number | null;
  defaultAssigneeEmployeeId?: number | null;
  body?: string | null;
  startAt?: string | null;
  dueAt?: string | null;
  priority?: number | null;
  watcherEmployeeIds?: number[];
  links?: TaskLinkInput[];
  source?: TaskSource;
  kind?: TaskKind | null;
  triggerDefinitionId?: string | null;
  idempotencyKey?: string | null;
  escalationIntervalSeconds?: number | null;
};

export async function createTask(body: CreateTaskBody): Promise<TaskDetail> {
  const { data } = await http.post<TaskDetail>('/tasks', body);
  return data;
}

export type PatchTaskBody = Partial<{
  title: string;
  body: string | null;
  status: TaskStatus;
  assignedToEmployeeId: number | null;
  queueRoleId: number | null;
  defaultAssigneeEmployeeId: number | null;
  startAt: string | null;
  dueAt: string | null;
  priority: number | null;
  branchIds: number[];
  watcherEmployeeIds: number[];
  links: TaskLinkInput[];
  escalationIntervalSeconds: number | null;
  /** Only read alongside `status: 'done'`. Defaults to `completed`. */
  resolution: TaskResolution;
  /** Required by the API when resolution is `removed`. */
  resolutionNote: string;
}>;

export async function patchTask(id: number, body: PatchTaskBody): Promise<TaskDetail> {
  const { data } = await http.patch<TaskDetail>(`/tasks/${id}`, body);
  return data;
}

export async function completeTask(id: number): Promise<TaskDetail> {
  const { data } = await http.post<TaskDetail>(`/tasks/${id}/complete`);
  return data;
}

/**
 * Take a task off the board without claiming the work was done. The reason is
 * required — a removed task with no explanation is worse than one left open.
 */
export async function removeTask(id: number, reason: string): Promise<TaskDetail> {
  return patchTask(id, {
    status: 'done',
    resolution: 'removed',
    resolutionNote: reason.trim(),
  });
}

export type ReassignFromEmployeeBody = {
  fromEmployeeId: number;
  toEmployeeId: number;
  upcomingOnly?: boolean;
  taskIds?: number[];
  persistAsTaskForwarder?: boolean;
};

export type ReassignFromEmployeeResult = {
  reassigned: number;
  taskIds: number[];
};

export async function reassignFromEmployee(
  body: ReassignFromEmployeeBody,
): Promise<ReassignFromEmployeeResult> {
  const { data } = await http.post<ReassignFromEmployeeResult>(
    '/tasks/reassign-from-employee',
    body,
  );
  return {
    reassigned: typeof data?.reassigned === 'number' ? data.reassigned : 0,
    taskIds: Array.isArray(data?.taskIds) ? data.taskIds : [],
  };
}
