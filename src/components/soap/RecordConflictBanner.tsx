import type { RecordConflict } from '../../api/visitWorkflow';

/**
 * EMR-13: shown when a dose or prescription save is refused because someone else saved it first.
 * What the user typed stays in the form; they choose to reload the other person's version or to
 * save their own over it.
 */
export default function RecordConflictBanner({
  conflict,
  busy,
  onReload,
  onSaveMine,
}: {
  conflict: RecordConflict;
  busy?: boolean;
  onReload: () => void;
  onSaveMine: () => void;
}) {
  return (
    <div className="soap-dose-error" role="alert" data-cy="record-conflict">
      <p data-cy="record-conflict-message">
        Changed by {conflict.changedByName}, reload. Your entries are still on screen and have not
        been saved.
      </p>
      <button type="button" className="soap-btn small" disabled={busy} onClick={onReload} data-cy="record-conflict-reload">
        Reload their version
      </button>{' '}
      <button type="button" className="soap-btn small" disabled={busy} onClick={onSaveMine} data-cy="record-conflict-save-mine">
        Save mine anyway
      </button>
    </div>
  );
}
