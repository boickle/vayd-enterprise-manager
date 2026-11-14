import { useEffect, useState } from 'react';
import { FileText, Phone, X } from 'lucide-react';
import { fetchCallByRowId, markCallReviewOpened, resolveCall, type ClientCall } from '../../api/calls';
import { fetchClientByIdStaff } from '../../api/clientsStaff';
import { callRowIdFromTask } from '../../utils/callTask';
import { petsFromClient } from '../../utils/callPets';
import { CallTranscriptModal, tidyQuoTranscript, type CallPillPatient } from './ClientCallPill';
import './CallFilingTaskPanel.css';

type TaskInput = {
  triggerDefinitionId?: string | null;
  idempotencyKey?: string | null;
  links?: ReadonlyArray<{ entityType: string; entityId: number }>;
};

type Props = {
  task: TaskInput;
  /** May file or dismiss (assignee, creator, admin, or someone who can claim it). */
  canAct: boolean;
  /** The pet the task is about, ticked in the filing window. */
  defaultPatientId?: number | null;
  /** The call was filed or dismissed; the server has already closed this task (TA-A6). */
  onDone: (message: string) => void;
};

type Loaded = { state: 'loading' } | { state: 'missing' } | { state: 'ready'; call: ClientCall & { clientName?: string | null } };

function callTimeEt(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const s = d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${s.replace(/ /g, ' ')} ET`;
}

function directionLabel(direction: string | null | undefined): string {
  const d = String(direction ?? '').toLowerCase();
  if (d === 'incoming' || d === 'inbound') return 'Incoming call';
  if (d === 'outgoing' || d === 'outbound') return 'Outgoing call';
  return 'Call';
}

function durationLabel(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '';
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * T-B2: a "Call not filed" task is about a call that already happened, so it shows that call —
 * who, when, Quo's summary and transcript — with the call dock's own choices. File to chart
 * opens the dock's filing window (CallTranscriptModal); Don't file dismisses the call. Either
 * one closes this task on the server.
 */
export default function CallFilingTaskPanel({ task, canAct, defaultPatientId, onDone }: Props) {
  const rowId = callRowIdFromTask(task);
  const [loaded, setLoaded] = useState<Loaded>(() =>
    rowId == null ? { state: 'missing' } : { state: 'loading' },
  );
  const [patients, setPatients] = useState<CallPillPatient[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (rowId == null) {
      setLoaded({ state: 'missing' });
      return;
    }
    let cancelled = false;
    setLoaded({ state: 'loading' });
    void fetchCallByRowId(rowId).then((call) => {
      if (cancelled) return;
      setLoaded(call ? { state: 'ready', call } : { state: 'missing' });
    });
    return () => {
      cancelled = true;
    };
  }, [rowId]);

  const clientId = loaded.state === 'ready' ? loaded.call.clientId : null;
  useEffect(() => {
    if (clientId == null) {
      setPatients([]);
      return;
    }
    let cancelled = false;
    void fetchClientByIdStaff(clientId)
      .then((raw) => {
        if (!cancelled) setPatients(petsFromClient(raw));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (loaded.state === 'loading') {
    return (
      <section className="pims-fb-task pims-call-task" aria-label="Call to file">
        <p className="pims-fb-task__lead">Loading the call…</p>
      </section>
    );
  }

  if (loaded.state === 'missing') {
    return (
      <section className="pims-fb-task pims-call-task" aria-label="Call to file">
        <p className="pims-fb-task__lead">
          <strong>Open the call dock to file this call.</strong> This task doesn’t say which call
          it is. Your unfiled calls wait in the call dock at the bottom right; File or Don’t file
          there closes this task.
        </p>
      </section>
    );
  }

  const call = loaded.call;
  const who = call.clientName?.trim() || call.counterpartyPhone?.trim() || 'Unknown caller';
  const transcript = tidyQuoTranscript(call.transcriptText ?? '');
  const when = callTimeEt(call.startedAt ?? call.completedAt);
  const duration = durationLabel(call.durationSeconds);
  const decided = call.filedAt ? 'filed' : call.dismissedAt ? 'dismissed' : null;
  // Filing needs a chart, as in the dock; with no client the only choice is Don't file.
  const canFile = canAct && !decided && call.clientId != null && Boolean(transcript.trim());

  const dontFile = async () => {
    setSkipping(true);
    setError(null);
    try {
      await resolveCall(call.callId);
      onDone('Call marked Don’t file. This task is closed.');
    } catch {
      setError('Could not dismiss that call. Try again, or use the call dock.');
      setSkipping(false);
    }
  };

  return (
    <section className="pims-fb-task pims-call-task" aria-label="Call to file">
      <h2 className="pims-call-task__title">
        <Phone size={16} aria-hidden /> Call to file
      </h2>
      <p className="pims-call-task__who">{who}</p>
      <p className="pims-call-task__meta">
        {directionLabel(call.direction)}
        {when ? ` · ${when}` : ''}
        {duration ? ` · ${duration}` : ''}
        {call.clientName && call.counterpartyPhone ? ` · ${call.counterpartyPhone}` : ''}
      </p>
      {call.triageReason?.trim() ? (
        <p className="pims-call-task__summary">{call.triageReason.trim()}</p>
      ) : null}
      {transcript ? (
        <div className="pims-call-task__transcript" aria-label="Transcript">
          {transcript}
        </div>
      ) : (
        <p className="pims-fb-task__hint">Quo has not sent a transcript for this call.</p>
      )}

      {decided ? (
        <p className="pims-fb-task__hint">
          This call was already {decided}. The task closes on its own.
        </p>
      ) : canAct ? (
        <>
          <div className="pims-fb-task__actions">
            {canFile ? (
              <button
                type="button"
                className="pims-task-detail__btn pims-task-detail__btn--primary"
                disabled={skipping}
                onClick={() => {
                  // An opened call is never auto-cleared as non-clinical (COM-CALL, Nov 11).
                  void markCallReviewOpened(call.callId).catch(() => undefined);
                  setReviewing(true);
                }}
              >
                <FileText size={16} aria-hidden />
                File to chart
              </button>
            ) : null}
            <button
              type="button"
              className="pims-task-detail__btn pims-task-detail__btn--secondary"
              disabled={skipping}
              onClick={() => void dontFile()}
            >
              <X size={16} aria-hidden />
              {skipping ? 'Skipping…' : 'Don’t file'}
            </button>
          </div>
          <p className="pims-fb-task__hint">
            The same choices as the call dock. Filing or Don’t file closes this task.
          </p>
        </>
      ) : null}
      {error ? <div className="soap-error">{error}</div> : null}

      {reviewing && call.clientId != null ? (
        <CallTranscriptModal
          call={call}
          clientId={call.clientId}
          clientName={call.clientName ?? null}
          patients={patients}
          defaultPatientId={defaultPatientId ?? (patients.length === 1 ? patients[0].id : null)}
          onClose={() => setReviewing(false)}
          onFiled={(noteId, patientId) => {
            setReviewing(false);
            const pet = patients.find((p) => p.id === patientId)?.name;
            onDone(
              noteId
                ? `Call filed to ${pet ? `${pet}’s` : 'the'} chart. This task is closed.`
                : 'Call filed. This task is closed.',
            );
          }}
        />
      ) : null}
    </section>
  );
}
