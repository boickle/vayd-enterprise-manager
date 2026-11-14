import { isTaskPriorityUrgent } from './taskPriority';

type UrgencyFields = {
  status: string;
  priority?: number | null;
  assignedToEmployeeId?: number | null;
  dueAt?: string | null;
};

/** Urgent = urgent priority, or due within 24 hours, or overdue. Being unassigned does not count. */
export function isUrgentTask(t: UrgencyFields, now: number = Date.now()): boolean {
  if (t.status === 'done') return false;
  if (isTaskPriorityUrgent(t.priority)) return true;
  if (!t.dueAt) return false;
  const due = new Date(t.dueAt).getTime();
  if (Number.isNaN(due)) return false;
  return due <= now + 24 * 60 * 60 * 1000;
}
