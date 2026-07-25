import { http } from './http';

export type TaskStatus = 'open' | 'assigned' | 'done';
export type TaskSource = 'manual' | 'trigger' | 'system';

export const TASK_LINK_ENTITY_TYPES = [
  'appointment',
  'patient',
  'client',
  'lab_order',
  'inventory_procedure',
  'employee',
  'referral',
  'reminder',
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
  defaultAssigneeEmployeeId: number | null;
  createdByEmployeeId: number;
  /** When work should begin (scheduling window start). */
  startAt: string | null;
  /** Deadline / end of window. */
  dueAt: string | null;
  priority: number | null;
  source: TaskSource;
  triggerDefinitionId: string | null;
  completedAt: string | null;
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

export type TaskInvolvementFilter = 'assigned' | 'watching' | 'created';

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

export async function fetchTasksSummary(params?: { branchId?: number }): Promise<TaskSummaryResponse> {
  const { data } = await http.get<TaskSummaryResponse>('/tasks/summary', { params });
  const empty: TaskSummaryBucket = { active: 0, expired: 0, upcoming: 0, total: 0 };
  const assigned = data?.assigned ?? empty;
  const watching = data?.watching ?? empty;
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
  branchIds: number[];
  assignedToEmployeeId?: number | null;
  defaultAssigneeEmployeeId?: number | null;
  body?: string | null;
  startAt?: string | null;
  dueAt?: string | null;
  priority?: number | null;
  watcherEmployeeIds?: number[];
  links?: TaskLinkInput[];
  source?: TaskSource;
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
  defaultAssigneeEmployeeId: number | null;
  startAt: string | null;
  dueAt: string | null;
  priority: number | null;
  branchIds: number[];
  watcherEmployeeIds: number[];
  links: TaskLinkInput[];
  escalationIntervalSeconds: number | null;
}>;

export async function patchTask(id: number, body: PatchTaskBody): Promise<TaskDetail> {
  const { data } = await http.patch<TaskDetail>(`/tasks/${id}`, body);
  return data;
}

export async function completeTask(id: number): Promise<TaskDetail> {
  const { data } = await http.post<TaskDetail>(`/tasks/${id}/complete`);
  return data;
}
