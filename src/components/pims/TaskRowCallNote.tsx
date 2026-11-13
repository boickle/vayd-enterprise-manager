import { useState } from 'react';
import { apiErrorMessage } from '../../api/http';
import { Link } from 'react-router';
import { fetchClientByIdStaff } from '../../api/clientsStaff';
import { resolveCall } from '../../api/calls';
import { createAndSignScoutChartNote, recordScoutChartCommunication } from '../../api/scoutChart';
import { completeTask, getTask, patchTask, type TaskListItem } from '../../api/tasks';
import {
  fileCallTaskCallId,
  householdPetsFromClient,
  readCallNoteDraft,
  writeCallNoteDraft,
  type CallNotePet,
} from '../../utils/taskCallNote';
import { useSharedTaskClosePrompt } from './SharedTaskClosePrompt';
import './TaskRowCallNote.css';

type Props = {
  task: TaskListItem;
  clientId: number;
  clientLabel: string;
  /** After Save or Mark done, so the list reloads. */
  onChanged: () => void;
};

/**
 * Quick call note on a "File call with …" row (owner, Nov 13, 2026). Type a short note, then
 * Save (kept on the task, not charted) or Mark done (charted, task closed). Mark done with an
 * empty box opens the task instead, so nobody closes a call without writing what happened.
 */
export default function TaskRowCallNote({ task, clientId, clientLabel, onChanged }: Props) {
  const saved = readCallNoteDraft(task.body);
  const [text, setText] = useState(saved);
  const [pets, setPets] = useState<CallNotePet[] | null>(null);
  const [toClient, setToClient] = useState(true);
  const [petIds, setPetIds] = useState<number[]>([]);
  const [busy, setBusy] = useState<'save' | 'done' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { askAlsoClose, closePrompt } = useSharedTaskClosePrompt();
  const note = text.trim();

  // The household's pets load when someone starts on the note, not for every row on the list.
  const loadPets = () => {
    if (pets !== null) return;
    setPets([]);
    void fetchClientByIdStaff(clientId)
      .then((raw) => setPets(householdPetsFromClient(raw)))
      .catch(() => setPets([]));
  };

  const save = async () => {
    setBusy('save');
    setError(null);
    try {
      await patchTask(task.id, { body: writeCallNoteDraft(task.body, text) });
      onChanged();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const chartAndDone = async () => {
    if (!toClient && petIds.length === 0) {
      setError('Pick the client or a pet so this can go on the record.');
      return;
    }
    setBusy('done');
    setError(null);
    try {
      const detail = await getTask(task.id);
      const choice = detail.status !== 'done' ? await askAlsoClose(detail) : {};
      if (!choice) return;
      const body = `Call — ${task.title}\n\n${note}`;
      let lastNoteId: string | null = null;
      for (const patientId of petIds) {
        const created = await createAndSignScoutChartNote({ patientId, clientId, body });
        lastNoteId = created.id;
      }
      if (toClient) {
        await recordScoutChartCommunication({
          clientId,
          patientIds: petIds,
          channel: 'log',
          body,
          typeLabel: 'Call note',
          includeOnMedicalRecord: false,
        });
      }
      const callId = fileCallTaskCallId(detail);
      if (callId) {
        await resolveCall(callId, {
          ...(lastNoteId ? { noteId: lastNoteId } : {}),
          filed: true,
        }).catch(() => undefined);
      }
      if (readCallNoteDraft(detail.body)) {
        await patchTask(task.id, { body: writeCallNoteDraft(detail.body, '') }).catch(
          () => undefined
        );
      }
      if (detail.status !== 'done') await completeTask(task.id, choice);
      onChanged();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const togglePet = (id: number) =>
    setPetIds((cur) => (cur.includes(id) ? cur.filter((p) => p !== id) : [...cur, id]));

  return (
    <div className="task-row-call-note">
      <textarea
        className="task-row-call-note__box"
        rows={3}
        value={text}
        placeholder='Short note in your words, e.g. "Called about balance, LMOM." Open the task for the Quo transcript.'
        onFocus={loadPets}
        onChange={(e) => setText(e.target.value)}
        disabled={Boolean(busy)}
        aria-label={`Call note for ${task.title}`}
      />
      <div className="task-row-call-note__to" role="group" aria-label="File this note to">
        <span className="task-row-call-note__to-label">File to:</span>
        <label>
          <input
            type="checkbox"
            checked={toClient}
            onChange={(e) => setToClient(e.target.checked)}
            disabled={Boolean(busy)}
          />
          {clientLabel}
        </label>
        {pets === null ? (
          <button type="button" className="task-row-call-note__more" onClick={loadPets}>
            + a pet
          </button>
        ) : (
          pets.map((p) => (
            <label key={p.id}>
              <input
                type="checkbox"
                checked={petIds.includes(p.id)}
                onChange={() => togglePet(p.id)}
                disabled={Boolean(busy)}
              />
              {p.name}
            </label>
          ))
        )}
      </div>
      {error ? <p className="task-row-call-note__error">{error}</p> : null}
      <div className="task-row-call-note__actions">
        <button
          type="button"
          className="pims-task-card__btn pims-task-card__btn--reassign"
          disabled={Boolean(busy) || text.trim() === saved.trim()}
          title="Keep this note on the task without charting it"
          onClick={() => void save()}
        >
          {busy === 'save' ? 'Saving…' : 'Save'}
        </button>
        {note ? (
          <button
            type="button"
            className="pims-task-card__btn pims-task-card__btn--done"
            disabled={Boolean(busy)}
            title="Chart this note and close the task"
            onClick={() => void chartAndDone()}
          >
            {busy === 'done' ? 'Filing…' : 'Mark done'}
          </button>
        ) : (
          <Link
            className="pims-task-card__btn pims-task-card__btn--done"
            to={`?taskId=${task.id}`}
            title="Write the note first. This opens the task, with the Quo transcript."
          >
            Mark done
          </Link>
        )}
      </div>
      {closePrompt}
    </div>
  );
}
