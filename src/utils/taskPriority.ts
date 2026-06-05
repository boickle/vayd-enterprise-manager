/** API: null = not urgent; positive number = urgent (convention: 1). */
export const TASK_PRIORITY_URGENT = 1;

export type TaskPriorityChoice = 'normal' | 'urgent';

export function priorityChoiceFromApi(value: number | null | undefined): TaskPriorityChoice {
  if (value != null && value >= TASK_PRIORITY_URGENT) return 'urgent';
  return 'normal';
}

export function priorityToApi(choice: TaskPriorityChoice): number | null {
  return choice === 'urgent' ? TASK_PRIORITY_URGENT : null;
}

export function priorityChoiceLabel(choice: TaskPriorityChoice): string {
  return choice === 'urgent' ? 'Urgent' : 'Not Urgent';
}

export function priorityApiLabel(value: number | null | undefined): string {
  return priorityChoiceLabel(priorityChoiceFromApi(value));
}

export function isTaskPriorityUrgent(priority: number | null | undefined): boolean {
  return priorityChoiceFromApi(priority) === 'urgent';
}
