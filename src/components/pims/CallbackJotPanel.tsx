import { useEffect, useMemo, useState } from 'react';
import { Check, FileText, Phone, Trash2, UserPlus, Wand2 } from 'lucide-react';
import { polishSpokenNotes } from '../../api/soapScribe';
import { createScoutChartNote, finalizeScoutChartNote } from '../../api/scoutChart';
import { completeTask, patchTask, removeTask, type TaskDetail } from '../../api/tasks';
import { fetchClientByIdStaff } from '../../api/clientsStaff';
import { resolveCall } from '../../api/calls';
import type { Employee } from '../../api/appointmentSettings';
import { formatEmployeeDisplayName } from '../../utils/employeeDisplayName';
import { clientReachPhones } from '../../utils/clientReachContacts';
import { buildPhoneDialHref, formatDisplayPhone } from '../../utils/quoContact';
import { markClientCallStarted, useClientCallActivity } from '../../hooks/useClientCallActivity';
import { useOutboundCallFromLine } from '../../hooks/useOutboundCallFromLine';
import { tidyQuoTranscript } from './ClientCallPill';

function linkedId(task: TaskDetail, type: 'patient' | 'client'): number | null {
  const hit = (task.links ?? []).find((l) => l.entityType === type);
  return hit ? hit.entityId : null;
}

function clientDisplayName(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const name = [o.firstName, o.lastName]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .join(' ');
  return name || null;
}

function appendTaskNote(existing: string | null | undefined, heading: string, body: string): string {
  const prior = (existing ?? '').trim();
  const block = `${heading}\n${body.trim()}`;
  return prior ? `${prior}\n\n${block}` : block;
}

function employeeId(em: Employee): number {
  return Number(em.id);
}

function staffChoices(employees: Employee[]): Employee[] {
  return employees
    .filter((em) => em.isDeleted !== true && em.isActive !== false && Number.isFinite(employeeId(em)))
    .slice()
    .sort((a, b) => {
      const an = formatEmployeeDisplayName(a) || a.email || '';
      const bn = formatEmployeeDisplayName(b) || b.email || '';
      return an.localeCompare(bn, undefined, { sensitivity: 'base' });
    });
}

type Props = {
  task: TaskDetail;
  employees?: Employee[];
  myEmployeeId?: number | null;
  patientName?: string | null;
  clientName?: string | null;
  onDone: () => void | Promise<void>;
};

/**
 * Finish flow for callbacks and to-dos: write (or pull a Quo transcript), then
 * Chart & complete, Chart & re-assign (staff notes stay off the chart), or Remove.
 */
export default function CallbackJotPanel({
  task,
  employees = [],
  myEmployeeId = null,
  patientName,
  clientName: clientNameProp,
  onDone,
}: Props) {
  const isCallback = task.kind === 'callback';
  const noun = isCallback ? 'callback' : 'task';
  const chartHeading = isCallback ? 'Callback' : 'Task';
  const fromLine = useOutboundCallFromLine();
  const patientId = linkedId(task, 'patient');
  const clientId = linkedId(task, 'client');
  const call = useClientCallActivity(clientId);

  const [phones, setPhones] = useState<{ label: string; phone: string }[]>([]);
  const [clientName, setClientName] = useState(clientNameProp ?? null);
  const [phone, setPhone] = useState('');
  const [transcript, setTranscript] = useState('');
  const [appliedCallId, setAppliedCallId] = useState<string | null>(null);
  const [staffNote, setStaffNote] = useState('');
  const [reassignTo, setReassignTo] = useState('');
  const [polishing, setPolishing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [doneLabel, setDoneLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (clientId == null) return;
    let canceled = false;
    void fetchClientByIdStaff(clientId)
      .then((raw) => {
        if (canceled) return;
        const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
        const nextPhones = clientReachPhones(rec);
        setPhones(nextPhones);
        setPhone((cur) => cur || nextPhones[0]?.phone || '');
        const name = clientDisplayName(raw);
        if (name) setClientName(name);
      })
      .catch(() => undefined);
    return () => {
      canceled = true;
    };
  }, [clientId]);

  const assigneeChoices = useMemo(() => staffChoices(employees), [employees]);

  const quoText = useMemo(
    () => tidyQuoTranscript(call.call?.transcriptText ?? ''),
    [call.call?.transcriptText],
  );

  useEffect(() => {
    const id = call.call?.callId ?? null;
    if (!id || !quoText.trim() || appliedCallId === id) return;
    setTranscript(quoText);
    setAppliedCallId(id);
  }, [call.call?.callId, quoText, appliedCallId]);

  const text = transcript.trim();
  const phase = call.phase;
  const calling = Boolean(call.optimistic || phase === 'ringing' || phase === 'active');
  const summarizing = phase === 'transcribing';
  const canChart = Boolean(text && patientId != null);

  const startCall = (number: string) => {
    if (!number.trim() || clientId == null) return;
    markClientCallStarted(clientId, clientName, patientId);
    window.location.href = buildPhoneDialHref(number, { fromLine });
  };

  const polish = async () => {
    if (!text) return;
    setPolishing(true);
    setError(null);
    try {
      const summary = await polishSpokenNotes({
        transcript: text,
        kind: isCallback ? 'callback' : 'review',
        patientName,
        clientName,
      });
      if (summary) setTranscript(summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not clean up that transcript.');
    } finally {
      setPolishing(false);
    }
  };

  const fileNote = async () => {
    if (!text || patientId == null) {
      throw new Error(`Nothing to chart, or this ${noun} is not linked to a patient.`);
    }
    const note = await createScoutChartNote({
      patientId,
      clientId,
      body: `${chartHeading} — ${task.title}\n\n${text}`,
    });
    await finalizeScoutChartNote(note.id);
    if (call.call?.callId) {
      await resolveCall(call.call.callId, { noteId: note.id, filed: true }).catch(() => undefined);
    }
    return note.id;
  };

  const actorName = () => {
    const who = myEmployeeId != null ? employees.find((e) => employeeId(e) === myEmployeeId) : null;
    return who ? formatEmployeeDisplayName(who) || who.email : 'Staff';
  };

  const employeeLabel = (list: Employee[], id: number) => {
    const who = list.find((e) => employeeId(e) === id);
    return who ? formatEmployeeDisplayName(who) || who.email : `employee #${id}`;
  };

  const claimIfNeeded = async () => {
    if (task.assignedToEmployeeId != null || myEmployeeId == null) return;
    await patchTask(task.id, { assignedToEmployeeId: myEmployeeId });
  };

  const chartAndComplete = async () => {
    setBusy('complete');
    setError(null);
    try {
      await claimIfNeeded();
      await fileNote();
      const extra = staffNote.trim();
      if (extra) {
        await patchTask(task.id, {
          body: appendTaskNote(task.body, `Staff note from ${actorName()} (not charted)`, extra),
        });
      }
      if (task.status !== 'done') await completeTask(task.id);
      setDoneLabel(
        isCallback
          ? `Call filed to ${patientName ?? 'the patient'}'s record and the callback is done.`
          : `Filed to ${patientName ?? 'the patient'}'s record and the task is done.`,
      );
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not file that to the chart.');
    } finally {
      setBusy(null);
    }
  };

  const resolveAssignee = (): { toId: number; toName: string } | null => {
    const toId = reassignTo ? Number(reassignTo) : NaN;
    if (!Number.isFinite(toId) || toId <= 0) {
      setError('Pick who to re-assign this to.');
      return null;
    }
    const to = assigneeChoices.find((e) => employeeId(e) === toId);
    return {
      toId,
      toName: to ? formatEmployeeDisplayName(to) || to.email : `employee #${toId}`,
    };
  };

  const applyAssignee = async (toId: number, extraBody?: string) => {
    const updated = await patchTask(task.id, {
      assignedToEmployeeId: toId,
      ...(extraBody != null ? { body: extraBody } : {}),
    });
    if (Number(updated.assignedToEmployeeId) !== toId) {
      throw new Error(
        `The conversation was saved, but the task is still assigned to ${
          updated.assignedToEmployeeId != null
            ? employeeLabel(assigneeChoices, updated.assignedToEmployeeId)
            : 'the queue'
        }. Pick them again and use Re-assign.`,
      );
    }
    return updated;
  };

  const chartAndReassign = async () => {
    const dest = resolveAssignee();
    if (!dest) return;
    setBusy('chart-reassign');
    setError(null);
    try {
      await fileNote();
      const extra = staffNote.trim();
      const body = extra
        ? appendTaskNote(task.body, `Staff note from ${actorName()} (not charted)`, extra)
        : undefined;
      await applyAssignee(dest.toId, body);
      setDoneLabel(`Charted and re-assigned to ${dest.toName}.`);
      setStaffNote('');
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not chart and re-assign that.');
    } finally {
      setBusy(null);
    }
  };

  const reassignOnly = async () => {
    const dest = resolveAssignee();
    if (!dest) return;
    setBusy('reassign');
    setError(null);
    try {
      let body = task.body ?? '';
      if (text) {
        body = appendTaskNote(
          body,
          isCallback
            ? `Call notes from ${actorName()} (not charted yet)`
            : `Notes from ${actorName()} (not charted yet)`,
          text,
        );
      }
      if (staffNote.trim()) {
        body = appendTaskNote(body, `Staff note from ${actorName()} (not charted)`, staffNote.trim());
      }
      await applyAssignee(dest.toId, body !== (task.body ?? '') ? body : undefined);
      setDoneLabel(`Re-assigned to ${dest.toName} without charting.`);
      setStaffNote('');
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not re-assign that.');
    } finally {
      setBusy(null);
    }
  };

  const removeCallback = async () => {
    setBusy('remove');
    setError(null);
    try {
      await claimIfNeeded();
      const extra = staffNote.trim();
      const reason = extra || `${chartHeading} removed without filing to the record.`;
      const body = appendTaskNote(
        task.body,
        `Removed by ${actorName()} (not charted)`,
        reason,
      );
      await patchTask(task.id, { body });
      // Removed is not completed: the call never happened. Record it as such so
      // the Completed list does not claim this work was done.
      if (task.status !== 'done') await removeTask(task.id, reason);
      setDoneLabel(`${chartHeading} removed. Nothing was filed to the chart.`);
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove that callback.');
    } finally {
      setBusy(null);
      setConfirmRemove(false);
    }
  };

  if (doneLabel) {
    return (
      <div className="pims-callback-jot is-done">
        <Check size={14} /> {doneLabel}
      </div>
    );
  }

  return (
    <div className="pims-callback-jot">
      {isCallback ? (
        <>
          <div className="pims-callback-jot__head">
            <h3>
              <Phone size={14} aria-hidden /> Call the client
            </h3>
            <span className="settings-muted">
              Opens Quo, the same way calling from the chart does. The transcript comes back here
              when the call ends.
            </span>
          </div>

          {clientId == null ? (
            <p className="settings-muted">
              This callback is not linked to a client, so there is no number to dial.
            </p>
          ) : phones.length === 0 ? (
            <p className="settings-muted">No phone number on file for this client.</p>
          ) : (
            <div className="pims-callback-jot__controls">
              {phones.length > 1 ? (
                <select
                  className="soap-input"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  aria-label="Number to call"
                >
                  {phones.map((p) => (
                    <option key={p.phone} value={p.phone}>
                      {p.label}: {formatDisplayPhone(p.phone)}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="pims-callback-jot__phone">{formatDisplayPhone(phones[0]!.phone)}</span>
              )}
              <button
                type="button"
                className="pims-callback-jot__btn pims-callback-jot__btn--primary"
                disabled={!phone}
                onClick={() => startCall(phone || phones[0]?.phone || '')}
              >
                <Phone size={14} /> Open Quo call
              </button>
            </div>
          )}

          {calling ? (
            <p className="pims-callback-jot__live">
              Calling{clientName ? ` ${clientName}` : ''}… the dock follows this call.
            </p>
          ) : summarizing ? (
            <p className="pims-callback-jot__live">Quo is writing the transcript — usually a minute or two.</p>
          ) : null}
        </>
      ) : (
        <div className="pims-callback-jot__head">
          <h3>
            <FileText size={14} aria-hidden /> Update and chart
          </h3>
          <span className="settings-muted">
            Write what you did. Chart & complete files it to the record. Staff notes stay on the
            task only.
          </span>
        </div>
      )}

      <textarea
        className="soap-textarea"
        rows={8}
        value={transcript}
        placeholder={
          isCallback
            ? 'The Quo transcript appears here after you hang up. You can also type what was said. This is what gets charted.'
            : 'What you want on the chart — the conversation, the plan, what you told the owner.'
        }
        onChange={(e) => setTranscript(e.target.value)}
      />

      <div className="pims-callback-jot__controls">
        <button
          type="button"
          className="pims-callback-jot__btn"
          disabled={!text || polishing || Boolean(busy)}
          onClick={() => void polish()}
        >
          <Wand2 size={14} /> {polishing ? 'Cleaning up…' : 'Clean up'}
        </button>
      </div>

      <div className="pims-callback-jot__handoff">
        <label className="pims-callback-jot__field">
          <span>Staff notes (not charted)</span>
          <textarea
            className="soap-textarea"
            rows={3}
            value={staffNote}
            placeholder="Instructions for the next person — these stay on the task, not the record."
            onChange={(e) => setStaffNote(e.target.value)}
            disabled={Boolean(busy)}
          />
        </label>
        <label className="pims-callback-jot__field">
          <span>Re-assign to</span>
          <select
            className="soap-input"
            value={reassignTo}
            onChange={(e) => setReassignTo(e.target.value)}
            disabled={Boolean(busy)}
            aria-label="Re-assign to"
          >
            <option value="">Who should get this…</option>
            {assigneeChoices.map((em) => (
              <option key={employeeId(em)} value={String(employeeId(em))}>
                {formatEmployeeDisplayName(em) || em.email}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? <div className="pims-callback-jot__error">{error}</div> : null}

      {confirmRemove ? (
        <div className="pims-callback-jot__confirm">
          <p>Remove this {noun} without filing anything to the chart?</p>
          <div className="pims-callback-jot__actions">
            <button
              type="button"
              className="pims-callback-jot__btn"
              disabled={Boolean(busy)}
              onClick={() => setConfirmRemove(false)}
            >
              Keep it
            </button>
            <button
              type="button"
              className="pims-callback-jot__btn pims-callback-jot__btn--danger"
              disabled={Boolean(busy)}
              onClick={() => void removeCallback()}
            >
              <Trash2 size={14} />
              {busy === 'remove' ? 'Removing…' : 'Remove'}
            </button>
          </div>
        </div>
      ) : (
        <div className="pims-callback-jot__actions">
          <button
            type="button"
            className="pims-callback-jot__btn"
            disabled={!reassignTo || Boolean(busy)}
            title="Hand this off without filing. The next person charts it."
            onClick={() => void reassignOnly()}
          >
            <UserPlus size={14} />
            {busy === 'reassign' ? 'Sending…' : 'Re-assign'}
          </button>
          <button
            type="button"
            className="pims-callback-jot__btn pims-callback-jot__btn--primary"
            disabled={!canChart || Boolean(busy)}
            title={
              patientId == null
                ? 'Link a patient so this can go on the chart'
                : !text
                  ? 'Add the conversation first'
                  : `File this and close the ${noun}`
            }
            onClick={() => void chartAndComplete()}
          >
            <FileText size={14} />
            {busy === 'complete' ? 'Filing…' : 'Chart & complete'}
          </button>
          <button
            type="button"
            className="pims-callback-jot__btn"
            disabled={!canChart || !reassignTo || Boolean(busy)}
            title={
              patientId == null
                ? 'Link a patient so this can go on the chart'
                : !text
                  ? 'Add the conversation first'
                  : !reassignTo
                    ? 'Pick who should get this'
                    : 'File the conversation, keep staff notes on the task, and hand it to someone else'
            }
            onClick={() => void chartAndReassign()}
          >
            <FileText size={14} />
            {busy === 'chart-reassign' ? 'Sending…' : 'Chart & re-assign'}
          </button>
          <button
            type="button"
            className="pims-callback-jot__btn pims-callback-jot__btn--danger"
            disabled={Boolean(busy)}
            onClick={() => {
              setError(null);
              setConfirmRemove(true);
            }}
          >
            <Trash2 size={14} />
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
