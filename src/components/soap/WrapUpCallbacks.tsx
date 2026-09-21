import { useCallback, useEffect, useMemo, useState } from 'react';
import { PhoneCall, Plus, Trash2 } from 'lucide-react';
import { createTask, listTasks, type TaskLinkInput, type TaskListItem } from '../../api/tasks';
import { fetchAllEmployees, type Employee } from '../../api/appointmentSettings';
import { listPracticeBranches } from '../../api/branchInventory';
import { formatEmployeeDisplayName } from '../../utils/employeeDisplayName';
import { toDatetimeLocalValue, fromDatetimeLocalValue } from '../../utils/taskDateTime';
import type { VisitWrapUpPet } from '../../api/visitWrapUp';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

/** Two days out is the usual "how is the rash doing" window. */
function defaultDueLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  d.setHours(10, 0, 0, 0);
  return toDatetimeLocalValue(d.toISOString());
}

type Props = {
  pets: VisitWrapUpPet[];
  clientId: number | null;
  /** Pre-selected assignee — the doctor's tech does the calling. */
  defaultAssigneeEmployeeId: number | null;
  disabled?: boolean;
};

/**
 * Callbacks the doctor sets up before leaving the visit.
 *
 * A callback is the vet-med kind: the tech rings the owner in a couple of days to see how
 * the patient is doing. The doctor writes it here and assigns it; the recorder and the
 * filing to the medical record happen on the task itself, when the call is actually made.
 */
export default function WrapUpCallbacks({
  pets,
  clientId,
  defaultAssigneeEmployeeId,
  disabled,
}: Props) {
  const [existing, setExisting] = useState<TaskListItem[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [branchIds, setBranchIds] = useState<number[]>([]);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [patientId, setPatientId] = useState<number | null>(pets[0]?.patientId ?? null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [assignee, setAssignee] = useState<number | null>(defaultAssigneeEmployeeId);
  const [dueLocal, setDueLocal] = useState(defaultDueLocal);

  useEffect(() => {
    setAssignee(defaultAssigneeEmployeeId);
  }, [defaultAssigneeEmployeeId]);

  const patientIds = useMemo(() => pets.map((p) => p.patientId), [pets]);

  const loadExisting = useCallback(async () => {
    try {
      const perPet = await Promise.all(
        patientIds.map((id) =>
          listTasks({ kind: 'callback', patientId: id, includeDone: true, limit: 50 })
        )
      );
      // A callback on two pets from one visit would come back twice.
      const byId = new Map<number, TaskListItem>();
      for (const page of perPet) for (const task of page.items) byId.set(task.id, task);
      setExisting([...byId.values()]);
    } catch {
      /* the compose form still works without the list */
    }
  }, [patientIds]);

  useEffect(() => {
    void loadExisting();
  }, [loadExisting]);

  // Only fetched once the doctor opens the form — most visits set no callback at all.
  useEffect(() => {
    if (!composing || employees.length > 0) return;
    void Promise.all([fetchAllEmployees(), listPracticeBranches(PRACTICE_ID)])
      .then(([emps, branches]) => {
        setEmployees(emps);
        setBranchIds(branches.map((b) => b.id));
      })
      .catch(() => setError('Could not load staff or branches.'));
  }, [composing, employees.length]);

  const reset = () => {
    setTitle('');
    setBody('');
    setDueLocal(defaultDueLocal());
    setPatientId(pets[0]?.patientId ?? null);
    setComposing(false);
  };

  const save = async () => {
    if (!title.trim() || patientId == null) return;
    if (branchIds.length === 0) {
      setError('Could not determine which branch this callback belongs to.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const links: TaskLinkInput[] = [{ entityType: 'patient', entityId: patientId }];
      if (clientId != null) links.push({ entityType: 'client', entityId: clientId });
      const due = fromDatetimeLocalValue(dueLocal);
      await createTask({
        title: title.trim(),
        body: body.trim() || null,
        kind: 'callback',
        branchIds,
        assignedToEmployeeId: assignee ?? null,
        ...(due ? { dueAt: due } : {}),
        links,
      });
      await loadExisting();
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create that callback.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="soap-wrapup-callbacks">
      {error && <div className="soap-error">{error}</div>}

      {existing.length > 0 && (
        <ul className="soap-wrapup-cb-list">
          {existing.map((task) => (
            <li key={task.id}>
              <PhoneCall size={13} aria-hidden />
              <span className="soap-wrapup-cb-title">{task.title}</span>
              <span className="soap-wrapup-hint">
                {task.dueAt ? `due ${new Date(task.dueAt).toLocaleDateString()}` : 'no due date'}
                {task.status === 'done' ? ' · done' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      {composing ? (
        <div className="soap-wrapup-cb-form">
          <label className="soap-wrapup-cb-field">
            <span>Which pet</span>
            <select
              className="soap-select"
              value={patientId ?? ''}
              onChange={(e) => setPatientId(Number(e.target.value) || null)}
            >
              {pets.map((p) => (
                <option key={p.patientId} value={p.patientId}>
                  {p.patientName}
                </option>
              ))}
            </select>
          </label>

          <label className="soap-wrapup-cb-field">
            <span>What to ask</span>
            <input
              className="soap-input"
              value={title}
              placeholder="e.g. Check how Fluffy's rash is doing"
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>

          <label className="soap-wrapup-cb-field">
            <span>Notes for whoever calls (optional)</span>
            <textarea
              className="soap-textarea"
              rows={3}
              value={body}
              placeholder="What to listen for, what to do if it's worse…"
              onChange={(e) => setBody(e.target.value)}
            />
          </label>

          <div className="soap-wrapup-cb-row">
            <label className="soap-wrapup-cb-field">
              <span>Who calls</span>
              <select
                className="soap-select"
                value={assignee ?? ''}
                onChange={(e) => setAssignee(Number(e.target.value) || null)}
              >
                <option value="">Queue (unassigned)</option>
                {employees.map((em) => (
                  <option key={em.id} value={em.id}>
                    {formatEmployeeDisplayName(em) || em.email}
                  </option>
                ))}
              </select>
            </label>
            <label className="soap-wrapup-cb-field">
              <span>Call by</span>
              <input
                type="datetime-local"
                className="soap-input"
                value={dueLocal}
                onChange={(e) => setDueLocal(e.target.value)}
              />
            </label>
          </div>

          <div className="soap-wrapup-cb-actions">
            <button type="button" className="soap-btn ghost" onClick={reset}>
              <Trash2 size={13} /> Discard
            </button>
            <button
              type="button"
              className="soap-btn"
              disabled={!title.trim() || patientId == null || saving}
              onClick={() => void save()}
            >
              <PhoneCall size={14} /> {saving ? 'Creating…' : 'Create callback'}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="soap-btn ghost small"
          disabled={Boolean(disabled) || pets.length === 0}
          onClick={() => setComposing(true)}
        >
          <Plus size={13} /> Add a callback
        </button>
      )}
    </div>
  );
}
