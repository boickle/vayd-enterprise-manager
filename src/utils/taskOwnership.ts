import type { TaskListItem } from '../api/tasks';
import { resolveEmployeeIdFromToken } from './practiceIdFromToken';

/** Fired after task create, complete, or reassignment so the nav badge can refresh. */
export const VAYD_TASKS_CHANGED = 'vayd-tasks-changed';

export function notifyTasksChanged(): void {
  window.dispatchEvent(new Event(VAYD_TASKS_CHANGED));
}

export function normalizeEmployeeId(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function taskAssigneeEmployeeId(task: TaskListItem): number | null {
  return normalizeEmployeeId(task.assignedToEmployeeId);
}

export function isTaskOpen(task: TaskListItem): boolean {
  return task.status !== 'done';
}

/** Open tasks assigned to this employee. */
export function isOpenTaskAssignedToEmployee(task: TaskListItem, employeeId: number): boolean {
  return isOpenTaskAssignedToEmployeeIds(task, [employeeId]);
}

export function isOpenTaskAssignedToEmployeeIds(task: TaskListItem, employeeIds: number[]): boolean {
  if (!isTaskOpen(task) || employeeIds.length === 0) return false;
  const assignee = taskAssigneeEmployeeId(task);
  return assignee != null && employeeIds.includes(assignee);
}

export function filterOpenTasksAssignedToEmployee(items: TaskListItem[], employeeId: number): TaskListItem[] {
  return items.filter((t) => isOpenTaskAssignedToEmployee(t, employeeId));
}

export function filterOpenTasksAssignedToEmployeeIds(
  items: TaskListItem[],
  employeeIds: number[]
): TaskListItem[] {
  return items.filter((t) => isOpenTaskAssignedToEmployeeIds(t, employeeIds));
}

/** Resolve staff employee id(s) for task assignment filters. */
export function resolveMyEmployeeIds(options: {
  token: string | null;
  doctorId?: string | null;
  userEmail?: string | null;
  userId?: string | null;
  employees?: { id: number; email?: string | null }[];
}): number[] {
  const ids = new Set<number>();
  const jwt = resolveEmployeeIdFromToken(options.token);
  if (jwt != null) ids.add(jwt);

  const doctor = normalizeEmployeeId(options.doctorId);
  if (doctor != null) ids.add(doctor);

  const emps = options.employees ?? [];
  if (options.userEmail?.trim() && emps.length > 0) {
    const needle = options.userEmail.trim().toLowerCase();
    const match = emps.find((e) => e.email?.trim().toLowerCase() === needle);
    const id = normalizeEmployeeId(match?.id);
    if (id != null) ids.add(id);
  }

  const uid = normalizeEmployeeId(options.userId);
  if (uid != null && emps.some((e) => e.id === uid)) ids.add(uid);

  return [...ids];
}

function taskStartMs(task: TaskListItem): number | null {
  if (!task.startAt) return null;
  const d = new Date(task.startAt).getTime();
  return Number.isNaN(d) ? null : d;
}

function taskDueMs(task: TaskListItem): number | null {
  if (!task.dueAt) return null;
  const d = new Date(task.dueAt).getTime();
  return Number.isNaN(d) ? null : d;
}

function startOfTodayMs(now = Date.now()): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Due before today (past due). */
export function isExpiredOpenTask(task: TaskListItem, now = Date.now()): boolean {
  if (!isTaskOpen(task)) return false;
  const due = taskDueMs(task);
  if (due == null) return false;
  return due < startOfTodayMs(now);
}

/** In progress window: started (or no start yet) and not expired or upcoming. */
export function isActiveOpenTask(task: TaskListItem, now = Date.now()): boolean {
  if (!isTaskOpen(task)) return false;
  if (isExpiredOpenTask(task, now)) return false;
  if (isUpcomingOpenTask(task, now)) return false;
  return true;
}

function startOfDayMsForTimestamp(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Work has not begun yet: start is on a future calendar day, or (no start) due is after this week.
 * Start "today" counts as active even if the clock time is later today.
 */
export function isUpcomingOpenTask(task: TaskListItem, now = Date.now()): boolean {
  if (!isTaskOpen(task)) return false;
  const start = taskStartMs(task);
  if (start != null) {
    return startOfDayMsForTimestamp(start) > startOfTodayMs(now);
  }
  const due = taskDueMs(task);
  if (due == null) return false;
  const weekEnd = startOfTodayMs(now) + 7 * 24 * 60 * 60 * 1000;
  return due >= weekEnd;
}

export type TaskDueBucket = 'active' | 'expired' | 'upcoming';

export function classifyOpenTaskByDue(task: TaskListItem, now = Date.now()): TaskDueBucket | null {
  if (!isTaskOpen(task)) return null;
  if (isExpiredOpenTask(task, now)) return 'expired';
  if (isUpcomingOpenTask(task, now)) return 'upcoming';
  if (isActiveOpenTask(task, now)) return 'active';
  return null;
}

export type TaskBucketCounts = { active: number; expired: number; upcoming: number };

export function countTaskBuckets(items: TaskListItem[], now = Date.now()): TaskBucketCounts {
  const counts: TaskBucketCounts = { active: 0, expired: 0, upcoming: 0 };
  for (const t of items) {
    const bucket = classifyOpenTaskByDue(t, now);
    if (bucket) counts[bucket] += 1;
  }
  return counts;
}

/** Nav badge: open tasks assigned to you that are active or expired. */
export function navTasksBadgeCount(items: TaskListItem[], employeeIds: number[], now = Date.now()): number {
  return filterOpenTasksAssignedToEmployeeIds(items, employeeIds).filter((t) => {
    const bucket = classifyOpenTaskByDue(t, now);
    return bucket === 'active' || bucket === 'expired';
  }).length;
}

export function filterMyOpenTasksByBucket(items: TaskListItem[], bucket: TaskDueBucket, now = Date.now()): TaskListItem[] {
  return items.filter((t) => classifyOpenTaskByDue(t, now) === bucket);
}
