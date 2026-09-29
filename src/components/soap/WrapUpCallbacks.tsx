import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, PhoneCall, Plus, Trash2 } from 'lucide-react';
import { listTasks, type TaskListItem } from '../../api/tasks';
import { fetchAllEmployees, type Employee } from '../../api/appointmentSettings';
import { formatEmployeeDisplayName } from '../../utils/employeeDisplayName';
import { toDatetimeLocalValue, fromDatetimeLocalValue } from '../../utils/taskDateTime';
import {
  getVisitReminders,
  saveReminderPlan,
  type ReminderPlanCallback,
  type VisitReminderPet,
  type VisitWrapUpPet,
} from '../../api/visitWrapUp';

/** Two days out is the usual "how is the rash doing" window. */
function defaultDueLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  d.setHours(10, 0, 0, 0);
  return toDatetimeLocalValue(d.toISOString());
}

type PetAskRow = {
  key: string;
  patientId: number;
  title: string;
  body: string;
};

function newPetAskRow(patientId: number): PetAskRow {
  return {
    key: `pet:${crypto.randomUUID()}`,
    patientId,
    title: '',
    body: '',
  };
}

/** Plan-checkout / wrap-up draft — becomes a real task when the chart is signed. */
type PendingCallback = {
  key: string;
  title: string;
  body: string | null;
  dueAt: string | null;
  patientId: number;
  patientName: string;
  soapEncounterId: string;
  locked: boolean;
  plan: VisitReminderPet['plan'];
};

type Props = {
  /** Anchor encounter — loads leftover plan-checkout callback drafts for the household. */
  encounterId: string;
  pets: VisitWrapUpPet[];
  clientId: number | null;
  /** Pre-selected assignee — the doctor's tech does the calling. */
  defaultAssigneeEmployeeId: number | null;
  disabled?: boolean;
  /** When set, only show pending callbacks for this patient (for per-pet card embeds). */
  filterPatientId?: number;
};

/**
 * Callbacks the doctor sets up before leaving the visit.
 *
 * A callback is the vet-med kind: the tech rings the owner in a couple of days to see how
 * the patient is doing. One call day can cover several pets in the household — shared
 * assignee + due time, with a separate ask/notes (and task) per pet so the conversation
 * files to each chart without mixing pets.
 *
 * Plan-checkout "Add Callback" drafts (and older leftovers before the modal created tasks
 * immediately) live on the reminder plan until sign — they show here, not under reminders.
 */
export default function WrapUpCallbacks({
  encounterId,
  pets,
  clientId: _clientId,
  defaultAssigneeEmployeeId,
  disabled,
  filterPatientId,
}: Props) {
  const [existing, setExisting] = useState<TaskListItem[]>([]);
  const [pending, setPending] = useState<PendingCallback[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [assignee, setAssignee] = useState<number | null>(defaultAssigneeEmployeeId);
  const [dueLocal, setDueLocal] = useState(defaultDueLocal);
  const [petRows, setPetRows] = useState<PetAskRow[]>(() =>
    pets[0] ? [newPetAskRow(pets[0].patientId)] : []
  );

  useEffect(() => {
    setAssignee(defaultAssigneeEmployeeId);
  }, [defaultAssigneeEmployeeId]);

  const patientIds = useMemo(() => pets.map((p) => p.patientId), [pets]);
  const petNameById = useMemo(
    () => new Map(pets.map((p) => [p.patientId, p.patientName] as const)),
    [pets]
  );

  const loadPending = useCallback(async () => {
    try {
      const data = await getVisitReminders(encounterId);
      const rows: PendingCallback[] = [];
      for (const pet of data.pets) {
        for (const cb of pet.plan.callbacks ?? []) {
          rows.push({
            key: cb.key,
            title: cb.title,
            body: cb.body ?? null,
            dueAt: cb.dueAt ?? null,
            patientId: pet.patientId,
            patientName: pet.patientName,
            soapEncounterId: pet.soapEncounterId,
            locked: pet.locked,
            plan: pet.plan,
          });
        }
      }
      setPending(rows);
    } catch {
      /* compose form still works */
    }
  }, [encounterId]);

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
    void loadPending();
  }, [loadExisting, loadPending]);

  // Only fetched once the doctor opens the form — most visits set no callback at all.
  useEffect(() => {
    if ((!composing && !editingKey) || employees.length > 0) return;
    void fetchAllEmployees()
      .then((emps) => setEmployees(emps))
      .catch(() => setError('Could not load staff.'));
  }, [composing, editingKey, employees.length]);

  const persistPetCallbacks = async (
    row: PendingCallback,
    nextCallbacks: ReminderPlanCallback[]
  ) => {
    setSaving(true);
    setError(null);
    try {
      await saveReminderPlan(row.soapEncounterId, {
        overrides: row.plan.overrides ?? {},
        extras: row.plan.extras ?? [],
        callbacks: nextCallbacks,
      });
      await loadPending();
      setEditingKey(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update that callback.');
    } finally {
      setSaving(false);
    }
  };

  const deletePending = async (row: PendingCallback) => {
    const siblings = (row.plan.callbacks ?? []).filter((c) => c.key !== row.key);
    await persistPetCallbacks(row, siblings);
  };

  const savePendingEdit = async (
    row: PendingCallback,
    patch: { title: string; body: string; dueLocal: string }
  ) => {
    const title = patch.title.trim();
    if (!title) return;
    const due = fromDatetimeLocalValue(patch.dueLocal);
    const next = (row.plan.callbacks ?? []).map((c) =>
      c.key === row.key
        ? {
            ...c,
            title,
            body: patch.body.trim() || null,
            dueAt: due ?? null,
          }
        : c
    );
    await persistPetCallbacks(row, next);
  };

  const reset = () => {
    setDueLocal(defaultDueLocal());
    setPetRows(pets[0] ? [newPetAskRow(pets[0].patientId)] : []);
    setComposing(false);
  };

  const usedPatientIds = useMemo(() => new Set(petRows.map((r) => r.patientId)), [petRows]);
  const availableToAdd = pets.filter((p) => !usedPatientIds.has(p.patientId));

  const canSave =
    petRows.length > 0 &&
    petRows.every((r) => r.title.trim() && Number.isFinite(r.patientId));

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const due = fromDatetimeLocalValue(dueLocal);
      const { pets: reminderPets } = await getVisitReminders(encounterId);
      for (const row of petRows) {
        const remPet =
          reminderPets.find((p) => p.patientId === row.patientId) ??
          reminderPets.find(
            (p) =>
              p.soapEncounterId ===
              pets.find((x) => x.patientId === row.patientId)?.soapEncounterId
          );
        if (!remPet) {
          throw new Error('Could not load the reminder plan for that pet.');
        }
        const callback: ReminderPlanCallback = {
          key: `cb-${crypto.randomUUID()}`,
          title: row.title.trim(),
          body: row.body.trim() || null,
          dueAt: due ?? null,
          assignedToEmployeeId: assignee ?? null,
        };
        await saveReminderPlan(remPet.soapEncounterId, {
          overrides: remPet.plan.overrides ?? {},
          extras: remPet.plan.extras ?? [],
          callbacks: [...(remPet.plan.callbacks ?? []), callback],
        });
      }
      await loadPending();
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that callback.');
    } finally {
      setSaving(false);
    }
  };

  // When embedded in a per-pet card, only show callbacks for that pet.
  const visiblePending = filterPatientId != null
    ? pending.filter((r) => r.patientId === filterPatientId)
    : pending;

  return (
    <div className="soap-wrapup-callbacks">
      {error && <div className="soap-error">{error}</div>}

      {visiblePending.length > 0 && (
        <ul className="soap-wrapup-cb-list soap-wrapup-cb-list--pending">
          {visiblePending.map((row) =>
            editingKey === row.key ? (
              <li key={row.key} className="soap-wrapup-cb-pending-edit">
                <PendingCallbackEditor
                  row={row}
                  disabled={Boolean(disabled || row.locked || saving)}
                  onCancel={() => setEditingKey(null)}
                  onSave={(patch) => void savePendingEdit(row, patch)}
                />
              </li>
            ) : (
              <li key={row.key} className="soap-wrapup-cb-card">
                <div className="soap-wrapup-cb-card__when">
                  <span className="soap-wrapup-cb-card__when-label">Call by</span>
                  <strong className="soap-wrapup-cb-card__when-value">
                    {row.dueAt
                      ? new Date(row.dueAt).toLocaleString([], {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })
                      : 'No time set'}
                  </strong>
                </div>
                <div className="soap-wrapup-cb-card__body">
                  <div className="soap-wrapup-cb-card__top">
                    <span className="soap-wrapup-cb-card__pet">{row.patientName}</span>
                    {!row.locked && !disabled ? (
                      <span className="soap-wrapup-cb-card__actions">
                        <button
                          type="button"
                          className="soap-btn ghost small"
                          title="Edit callback"
                          onClick={() => setEditingKey(row.key)}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          className="soap-btn ghost small danger"
                          title="Remove this callback"
                          disabled={saving}
                          onClick={() => void deletePending(row)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </span>
                    ) : null}
                  </div>
                  <div className="soap-wrapup-cb-card__ask">
                    <PhoneCall size={14} aria-hidden />
                    <strong>{row.title}</strong>
                  </div>
                  {row.body?.trim() ? (
                    <p className="soap-wrapup-cb-card__notes">{row.body.trim()}</p>
                  ) : null}
                  <p className="soap-wrapup-cb-card__meta">
                    {row.locked
                      ? 'Already on the signed chart'
                      : 'Task is created when the chart is signed'}
                  </p>
                </div>
              </li>
            )
          )}
        </ul>
      )}

      {existing.length > 0 && (
        <ul className="soap-wrapup-cb-list">
          {existing.map((task) => (
            <li key={task.id} className="soap-wrapup-cb-card soap-wrapup-cb-card--open">
              <div className="soap-wrapup-cb-card__when">
                <span className="soap-wrapup-cb-card__when-label">Call by</span>
                <strong className="soap-wrapup-cb-card__when-value">
                  {task.dueAt
                    ? new Date(task.dueAt).toLocaleString([], {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })
                    : 'No time set'}
                </strong>
              </div>
              <div className="soap-wrapup-cb-card__body">
                <div className="soap-wrapup-cb-card__ask">
                  <PhoneCall size={14} aria-hidden />
                  <strong>{task.title}</strong>
                </div>
                <p className="soap-wrapup-cb-card__meta">
                  {task.status === 'done' ? 'Done' : 'Open task'}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {composing ? (
        <div className="soap-wrapup-cb-form">
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

          <p className="soap-wrapup-hint soap-wrapup-cb-pets-hint">
            One call day — a separate task per pet so each conversation files to that pet&apos;s
            record.
          </p>

          {petRows.map((row, index) => {
            const otherSelected = new Set(
              petRows.filter((r) => r.key !== row.key).map((r) => r.patientId)
            );
            const options = pets.filter(
              (p) => p.patientId === row.patientId || !otherSelected.has(p.patientId)
            );
            return (
              <div className="soap-wrapup-cb-pet" key={row.key}>
                <div className="soap-wrapup-cb-pet-head">
                  <label className="soap-wrapup-cb-field">
                    <span>Pet {petRows.length > 1 ? index + 1 : ''}</span>
                    <select
                      className="soap-select"
                      value={row.patientId}
                      onChange={(e) => {
                        const patientId = Number(e.target.value);
                        setPetRows((prev) =>
                          prev.map((r) => (r.key === row.key ? { ...r, patientId } : r))
                        );
                      }}
                    >
                      {options.map((p) => (
                        <option key={p.patientId} value={p.patientId}>
                          {p.patientName}
                        </option>
                      ))}
                    </select>
                  </label>
                  {petRows.length > 1 ? (
                    <button
                      type="button"
                      className="soap-btn ghost small danger"
                      title="Remove this pet from the callback"
                      onClick={() =>
                        setPetRows((prev) => prev.filter((r) => r.key !== row.key))
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  ) : null}
                </div>

                <label className="soap-wrapup-cb-field">
                  <span>What to ask</span>
                  <input
                    className="soap-input"
                    value={row.title}
                    placeholder={`e.g. Check how ${petNameById.get(row.patientId) ?? 'the pet'}'s rash is doing`}
                    onChange={(e) =>
                      setPetRows((prev) =>
                        prev.map((r) =>
                          r.key === row.key ? { ...r, title: e.target.value } : r
                        )
                      )
                    }
                  />
                </label>

                <label className="soap-wrapup-cb-field">
                  <span>Notes for whoever calls (optional)</span>
                  <textarea
                    className="soap-textarea"
                    rows={2}
                    value={row.body}
                    placeholder="What to listen for, what to do if it's worse…"
                    onChange={(e) =>
                      setPetRows((prev) =>
                        prev.map((r) =>
                          r.key === row.key ? { ...r, body: e.target.value } : r
                        )
                      )
                    }
                  />
                </label>
              </div>
            );
          })}

          {availableToAdd.length > 0 ? (
            <button
              type="button"
              className="soap-btn ghost small"
              onClick={() =>
                setPetRows((prev) => [...prev, newPetAskRow(availableToAdd[0].patientId)])
              }
            >
              <Plus size={13} /> Add pet
            </button>
          ) : null}

          <div className="soap-wrapup-cb-actions">
            <button type="button" className="soap-btn ghost" onClick={reset}>
              <Trash2 size={13} /> Discard
            </button>
            <button
              type="button"
              className="soap-btn"
              disabled={!canSave || saving}
              onClick={() => void save()}
            >
              <PhoneCall size={14} />{' '}
              {saving
                ? 'Saving…'
                : petRows.length > 1
                  ? `Save ${petRows.length} callbacks`
                  : 'Save callback'}
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

function PendingCallbackEditor({
  row,
  disabled,
  onCancel,
  onSave,
}: {
  row: PendingCallback;
  disabled?: boolean;
  onCancel: () => void;
  onSave: (patch: { title: string; body: string; dueLocal: string }) => void;
}) {
  const [title, setTitle] = useState(row.title);
  const [body, setBody] = useState(row.body ?? '');
  const [dueLocal, setDueLocal] = useState(
    row.dueAt ? toDatetimeLocalValue(row.dueAt) : defaultDueLocal()
  );

  return (
    <div className="soap-wrapup-cb-form soap-wrapup-cb-form--inline">
      <p className="soap-wrapup-hint">
        For <strong>{row.patientName}</strong> — updates the draft created from plan checkout.
      </p>
      <label className="soap-wrapup-cb-field">
        <span>What to ask</span>
        <input
          className="soap-input"
          value={title}
          disabled={disabled}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="soap-wrapup-cb-field">
        <span>Notes for whoever calls (optional)</span>
        <textarea
          className="soap-textarea"
          rows={2}
          value={body}
          disabled={disabled}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <label className="soap-wrapup-cb-field">
        <span>Call by</span>
        <input
          type="datetime-local"
          className="soap-input"
          value={dueLocal}
          disabled={disabled}
          onChange={(e) => setDueLocal(e.target.value)}
        />
      </label>
      <div className="soap-wrapup-cb-actions">
        <button type="button" className="soap-btn ghost" disabled={disabled} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="soap-btn"
          disabled={disabled || !title.trim()}
          onClick={() => onSave({ title, body, dueLocal })}
        >
          Save
        </button>
      </div>
    </div>
  );
}
