import type { TaskKind } from '../api/tasks';
import { isForwardBookingTask } from './forwardBookingCreateLink';
import { isInvoiceAutomationTask } from './invoiceTask';
import { isOrderListAutomationTask } from './orderListTask';
import { isLabResultAutomationTask } from './labResultTask';
import { isSoapAutomationTask } from './soapTask';

/**
 * Which set of tools the task screen puts in front of whoever opens a task.
 *
 * Tasks created from now on carry `kind`, so this is a lookup. Rows that predate
 * the field fall back to the old signals — a mail-order link, the order-list
 * trigger, the labs-pending marker — and anything left over is a plain to-do.
 * Add a panel by adding a kind here and an entry in the task screen's registry,
 * not by adding another condition to the screen.
 */
export type TaskPanelKind =
  | 'mail_order'
  | 'order_list'
  | 'forward_booking'
  | 'invoice'
  | 'soap'
  | 'lab_result'
  | 'callback'
  | 'todo';

type PanelKindInput = {
  kind?: TaskKind | null;
  title?: string | null;
  body?: string | null;
  triggerDefinitionId?: string | null;
  idempotencyKey?: string | null;
  links?: ReadonlyArray<{ entityType: string; entityId: number }>;
};

const KIND_PANELS: Partial<Record<TaskKind, TaskPanelKind>> = {
  callback: 'callback',
  forward_booking: 'forward_booking',
  order_list: 'order_list',
  invoice: 'invoice',
  soap: 'soap',
  lab_result: 'lab_result',
};

export function taskPanelKind(task: PanelKindInput): TaskPanelKind {
  // A mail order carries its own approval flow and outranks everything else.
  if (task.links?.some((l) => l.entityType === 'mail_order')) return 'mail_order';

  // Older invoice rows may have a blank kind; the trigger / bill UUID still
  // means this is payment work, not a generic callback jot.
  if (isInvoiceAutomationTask(task)) return 'invoice';

  const declared = task.kind ? KIND_PANELS[task.kind] : undefined;
  if (declared) return declared;
  if (task.kind) return 'todo';

  if (isLabResultAutomationTask(task)) return 'lab_result';
  if (isSoapAutomationTask(task)) return 'soap';
  if (isOrderListAutomationTask(task)) return 'order_list';
  if (isForwardBookingTask(task)) return 'forward_booking';
  return 'callback';
}
