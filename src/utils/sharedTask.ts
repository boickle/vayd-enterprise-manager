import type { TaskDetail, TaskShareGroupMember } from '../api/tasks';
import { formatEmployeeDisplayName } from './employeeDisplayName';

/**
 * Shared tasks (SCH-E): one linked copy per person. These helpers say who else is on a
 * copy and phrase the "Shared with …" line and the close / reopen prompts.
 */

/** "Jen Ortiz", or "Jen Ortiz (inactive)" once they have left. */
export function sharedMemberLabel(member: TaskShareGroupMember): string {
  const name = formatEmployeeDisplayName(member) || `Employee #${member.employeeId}`;
  return member.isActive ? name : `${name} (inactive)`;
}

export function shareGroupMembers(
  task: Pick<TaskDetail, 'shareGroup'> | null | undefined
): TaskShareGroupMember[] {
  return task?.shareGroup?.members ?? [];
}

/** True when the task is one copy of a shared task with at least one other person. */
export function isSharedTask(task: Pick<TaskDetail, 'shareGroup'> | null | undefined): boolean {
  return shareGroupMembers(task).length > 1;
}

/** Everyone else whose copy is still open — the people "Also close it for …?" names. */
export function otherOpenMembers(
  task: Pick<TaskDetail, 'shareGroup'> | null | undefined
): TaskShareGroupMember[] {
  return shareGroupMembers(task).filter((m) => !m.isThisCopy && m.isOpen);
}

/** "Shared with Dr. Crispell · Jen" — every member, this copy's person first. */
export function sharedWithLabel(task: Pick<TaskDetail, 'shareGroup'> | null | undefined): string {
  const members = [...shareGroupMembers(task)].sort(
    (a, b) => Number(b.isThisCopy) - Number(a.isThisCopy)
  );
  return `Shared with ${members.map(sharedMemberLabel).join(' · ')}`;
}

/** "Jen and Sam", "Jen, Sam and Alex". */
export function joinPeople(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Previous members a closed shared task can be reopened for (still active). */
export function reopenableMembers(
  task: Pick<TaskDetail, 'shareGroup'> | null | undefined
): TaskShareGroupMember[] {
  return shareGroupMembers(task).filter((m) => m.isActive);
}
