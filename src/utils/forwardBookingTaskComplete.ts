import type { ForwardBookingEntry } from '../api/forwardBooking';
import { completeTask, patchTask } from '../api/tasks';
import { notifyTasksChanged } from './taskOwnership';

export function forwardBookingTaskResolutionNote(entry: Pick<ForwardBookingEntry, 'patient'>): string {
  const name = entry.patient?.name?.trim();
  return name ? `Forward booking added for ${name}.` : 'Forward booking added.';
}

/**
 * The labs-pending task *is* "put this pet on the forward booking list", so once
 * the list entry exists the task is done. Close it with a note that says which
 * record did it; fall back to a plain complete if the API rejects the note.
 * Returns false when the task could not be closed (caller leaves it open with
 * "Mark complete" still available).
 */
export async function completeForwardBookingTask(
  taskId: number,
  entry: Pick<ForwardBookingEntry, 'patient'>
): Promise<boolean> {
  const resolutionNote = forwardBookingTaskResolutionNote(entry);
  try {
    await patchTask(taskId, { status: 'done', resolution: 'completed', resolutionNote });
    notifyTasksChanged();
    return true;
  } catch {
    /* fall through to the plain complete endpoint */
  }
  try {
    await completeTask(taskId);
    notifyTasksChanged();
    return true;
  } catch {
    return false;
  }
}
