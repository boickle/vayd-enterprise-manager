import { useCallback, useRef, useState } from 'react';
import type { AlsoCloseFor, TaskDetail } from '../../api/tasks';
import { joinPeople, otherOpenMembers, sharedMemberLabel } from '../../utils/sharedTask';
import './SharedTaskPrompts.css';

/** What closing a copy should do: `{}` is just this copy; null means the person backed out. */
export type SharedCloseChoice = { alsoCloseFor?: AlsoCloseFor } | null;

type Pending = {
  names: string[];
  verb: 'close' | 'remove';
  resolve: (choice: SharedCloseChoice) => void;
};

/**
 * Closing one copy of a shared task: when other people's copies are still open, ask
 * "Also close it for Jen and Sam?" — [Close for everyone] [Just me]. Tasks with nobody
 * else open resolve straight away to "just this copy".
 *
 *   const { askAlsoClose, closePrompt } = useSharedTaskClosePrompt();
 *   const choice = await askAlsoClose(task);
 *   if (!choice) return;            // backed out
 *   await completeTask(task.id, choice);
 *   …
 *   return <>{…}{closePrompt}</>;
 */
export function useSharedTaskClosePrompt() {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const askAlsoClose = useCallback(
    (
      task: Pick<TaskDetail, 'shareGroup'> | null | undefined,
      verb: 'close' | 'remove' = 'close'
    ): Promise<SharedCloseChoice> => {
      const others = otherOpenMembers(task);
      if (others.length === 0) return Promise.resolve({});
      return new Promise<SharedCloseChoice>((resolve) => {
        const next = { names: others.map(sharedMemberLabel), verb, resolve };
        pendingRef.current = next;
        setPending(next);
      });
    },
    []
  );

  const finish = useCallback((choice: SharedCloseChoice) => {
    pendingRef.current?.resolve(choice);
    pendingRef.current = null;
    setPending(null);
  }, []);

  const closePrompt = pending ? (
    <SharedTaskCloseDialog
      names={pending.names}
      verb={pending.verb}
      onEveryone={() => finish({ alsoCloseFor: 'all' })}
      onJustMe={() => finish({})}
      onCancel={() => finish(null)}
    />
  ) : null;

  return { askAlsoClose, closePrompt };
}

export function SharedTaskCloseDialog({
  names,
  verb,
  onEveryone,
  onJustMe,
  onCancel,
}: {
  names: string[];
  verb: 'close' | 'remove';
  onEveryone: () => void;
  onJustMe: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="shared-task-prompt__backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        className="shared-task-prompt"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="shared-task-close-title"
      >
        <h2 id="shared-task-close-title">
          Also {verb} it for {joinPeople(names)}?
        </h2>
        <p>
          This task is shared. Each person has their own copy. Close it for everyone, or only take
          it off your own list.
        </p>
        <div className="shared-task-prompt__actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" onClick={onJustMe}>
            Just me
          </button>
          <button type="button" className="is-primary" onClick={onEveryone}>
            Close for everyone
          </button>
        </div>
      </div>
    </div>
  );
}
