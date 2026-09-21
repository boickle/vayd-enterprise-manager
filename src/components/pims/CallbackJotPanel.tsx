import { useState } from 'react';
import { Check, FileText, Mic, Square, Wand2 } from 'lucide-react';
import { useBriefRecorder } from '../../hooks/useBriefRecorder';
import { polishSpokenNotes } from '../../api/soapScribe';
import { createScoutChartNote, finalizeScoutChartNote } from '../../api/scoutChart';
import { completeTask, type TaskDetail } from '../../api/tasks';

function linkedId(task: TaskDetail, type: 'patient' | 'client'): number | null {
  const hit = (task.links ?? []).find((l) => l.entityType === type);
  return hit ? hit.entityId : null;
}

type Props = {
  task: TaskDetail;
  patientName?: string | null;
  clientName?: string | null;
  /** Refresh the task after it is completed. */
  onDone: () => void | Promise<void>;
};

/**
 * Recording and filing a callback, on the task where the call is actually made.
 *
 * The conversation is the point of a callback — "the rash is worse, she stopped eating" is
 * clinical information — so the transcript is filed to the patient's medical record rather
 * than left on a task that disappears once it is done. Recording lives here, not in the
 * wrap-up, because the doctor sets the callback up days before anyone dials.
 */
export default function CallbackJotPanel({ task, patientName, clientName, onDone }: Props) {
  // No encounter to attach to, so the hook falls back to the browser's speech API.
  const recorder = useBriefRecorder(null);
  const [polishing, setPolishing] = useState(false);
  const [filing, setFiling] = useState(false);
  const [filed, setFiled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patientId = linkedId(task, 'patient');
  const clientId = linkedId(task, 'client');
  const text = recorder.transcript.trim();

  const polish = async () => {
    if (!text) return;
    setPolishing(true);
    setError(null);
    try {
      const summary = await polishSpokenNotes({
        transcript: text,
        kind: 'callback',
        patientName,
        clientName,
      });
      if (summary) recorder.setTranscript(summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not clean up that transcript.');
    } finally {
      setPolishing(false);
    }
  };

  const fileToChart = async () => {
    if (!text || patientId == null) return;
    setFiling(true);
    setError(null);
    try {
      const note = await createScoutChartNote({
        patientId,
        clientId,
        body: `Callback — ${task.title}\n\n${text}`,
      });
      // Finalize immediately: a callback note is a record of a conversation that already
      // happened, so there is nothing left to draft.
      await finalizeScoutChartNote(note.id);
      if (task.status !== 'done') await completeTask(task.id);
      setFiled(true);
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not file that call to the chart.');
    } finally {
      setFiling(false);
    }
  };

  if (filed) {
    return (
      <div className="pims-callback-jot is-done">
        <Check size={14} /> Call filed to {patientName ?? 'the patient'}&apos;s record and the
        callback marked done.
      </div>
    );
  }

  return (
    <div className="pims-callback-jot">
      <div className="pims-callback-jot__head">
        <h3>
          <Mic size={14} aria-hidden /> Record the call
        </h3>
        <span className="settings-muted">
          Goes into {patientName ?? 'the patient'}&apos;s medical record when you file it.
        </span>
      </div>

      {patientId == null && (
        <p className="settings-muted">
          This callback is not linked to a patient, so there is no chart to file it to.
        </p>
      )}

      <div className="pims-callback-jot__controls">
        {recorder.recording ? (
          <button type="button" className="soap-btn" onClick={() => void recorder.stop()}>
            <Square size={14} /> Stop ({Math.floor(recorder.elapsed / 60)}:
            {String(recorder.elapsed % 60).padStart(2, '0')})
          </button>
        ) : (
          <button type="button" className="soap-btn" onClick={() => void recorder.start()}>
            <Mic size={14} /> Start recording
          </button>
        )}
        <button
          type="button"
          className="soap-btn ghost"
          disabled={!text || polishing || recorder.recording}
          title={text ? 'Tidy the transcript into a note' : 'Nothing recorded yet'}
          onClick={() => void polish()}
        >
          <Wand2 size={14} /> {polishing ? 'Cleaning up…' : 'Clean up'}
        </button>
      </div>

      <textarea
        className="soap-textarea"
        rows={8}
        value={recorder.transcript + (recorder.interim ? ` ${recorder.interim}` : '')}
        placeholder="Record the call, or type what was said…"
        onChange={(e) => recorder.setTranscript(e.target.value)}
      />

      {(recorder.error || error) && <div className="soap-error">{recorder.error ?? error}</div>}

      <div className="pims-callback-jot__actions">
        <button
          type="button"
          className="soap-btn"
          disabled={!text || patientId == null || filing || recorder.recording}
          onClick={() => void fileToChart()}
        >
          <FileText size={14} />
          {filing ? 'Filing…' : 'File to chart & finish callback'}
        </button>
      </div>
    </div>
  );
}
