import { completeTask, patchTask } from '../api/tasks';
import { notifyTasksChanged } from './taskOwnership';

/**
 * Close a labs-pending task ("Forward book Biscuit once labs are back") from Schedule
 * follow-ups, with a note saying what was done, e.g. "Biscuit: added to the Wed, Dec 2
 * visit with Dr. Lloyd." Falls back to a plain complete if the API rejects the note.
 * Returns false when the task could not be closed (it stays open with "Mark complete").
 */
export async function completeFollowUpTask(taskId: number, note: string): Promise<boolean> {
  try {
    await patchTask(taskId, { status: 'done', resolution: 'completed', resolutionNote: note });
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
