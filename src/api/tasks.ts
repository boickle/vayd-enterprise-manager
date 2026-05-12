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
  dueAt: string | null;
  priority: number | null;
  source: TaskSource;
  triggerDefinitionId: string | null;
  completedAt: string | null;
  created: string;
  updated: string;
  branchIds: number[];
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

export type ListTasksParams = {
  status?: TaskStatus;
  branchId?: number;
  includeDone?: boolean;
  limit?: number;
  offset?: number;
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
