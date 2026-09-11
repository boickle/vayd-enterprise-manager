import type { TaskLinkRow } from '../api/tasks';

export function isMailOrderTaskLink(link: Pick<TaskLinkRow, 'entityType'>): boolean {
  return link.entityType === 'mail_order';
}

export function mailOrderTaskStatusLabel(
  status: string,
  links?: Array<Pick<TaskLinkRow, 'entityType'>> | null,
): string {
  if (status !== 'done' && links?.some(isMailOrderTaskLink)) {
    return 'Approval Pending';
  }
  return status;
}

export function mailOrderTaskStatusClass(status: string): string {
  return status === 'done' ? 'done' : 'approval-pending';
}
