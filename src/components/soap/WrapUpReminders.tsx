import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BellRing, Link2, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import {
  getVisitReminders,
  saveReminderPlan,
  type PastDueReminder,
  type ProposedReminder,
  type ReminderPlanExtra,
  type ReminderPlanOverride,
  type ReminderSourceType,
  type VisitReminderPet,
} from '../../api/visitWrapUp';
import {
  declineReminder,
  formatDeclinedDate,
  isOffRecordDeclineNote,
} from '../../api/declinedTreatments';
import { patchReminder } from '../../api/careOutreach';
import { listOrders } from '../../api/visitWorkflow';
import { searchItems, type SearchableItem } from '../../api/roomLoader';
import { appConfirm, appPrompt } from '../../utils/appDialog';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

/** `2027-09-19T…` → `2027-09-19` for a date input, and back. */
function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromDateInput(value: string): string | null {
  if (!value.trim()) return null;
  // Noon local, so a timezone shift can't roll the date back a day.
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Offset a `yyyy-mm-dd` due date by weeks and/or months (local noon). */
function offsetDateInput(dueYmd: string, weeks = 0, months = 0): string {
  if (!dueYmd.trim()) return '';
  const d = new Date(`${dueYmd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  if (months) d.setMonth(d.getMonth() + months);
  if (weeks) d.setDate(d.getDate() + weeks * 7);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function itemId(item: SearchableItem): number | null {
  const record =
    item.itemType === 'inventory'
      ? item.inventoryItem
      : item.itemType === 'lab'
        ? item.lab
        : item.procedure;
  const id = Number(record?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

type Props = {
  /** Anchor encounter — the preview covers every pet on the visit. */
  encounterId: string;
  disabled?: boolean;
};

/**
 * The reminders this visit is about to create, before it creates them.
 *
 * Reminders used to appear only after the chart was signed, straight from catalog rules,
 * so a wrong interval had to be chased down on the chart afterwards and a one-off recheck
 * could not be added at all. Editing here writes a plan on the encounter that completion
 * replays, which is why nothing saves once a chart is signed.
 */
export default function WrapUpReminders({ encounterId, disabled }: Props) {
  const [pets, setPets] = useState<VisitReminderPet[]>([]);
  const [visitDeclines, setVisitDeclines] = useState<
    Record<string, { key: string; label: string; declinedAt: string | null; onChart: boolean }[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingFor, setSavingFor] = useState<string | null>(null);
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [pastDueBusyId, setPastDueBusyId] = useState<number | null>(null);
  /** Which upcoming reminder row is open for date/name edits. */
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getVisitReminders(encounterId);
      setPets(data.pets);
      const declined = await Promise.all(
        data.pets.map(async (pet) => {
          const orders = await listOrders(pet.soapEncounterId).catch(() => []);
          return [
            pet.soapEncounterId,
            orders
              .filter((o) => o.state === 'declined')
              .map((o) => ({
                key: o.id,
                label: o.name.trim() || 'Declined treatment',
                declinedAt: o.updated ?? o.created ?? null,
                onChart: !isOffRecordDeclineNote(o.note),
              })),
          ] as const;
        }),
      );
      setVisitDeclines(Object.fromEntries(declined));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load reminders.');
    } finally {
      setLoading(false);
    }
  }, [encounterId]);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = useCallback(
    async (pet: VisitReminderPet, plan: VisitReminderPet['plan']) => {
      setSavingFor(pet.soapEncounterId);
      // Optimistic: the inputs are controlled, so waiting on the round trip would
      // fight the typist.
      setPets((prev) =>
        prev.map((p) => (p.soapEncounterId === pet.soapEncounterId ? { ...p, plan } : p))
      );
      try {
        const data = await saveReminderPlan(pet.soapEncounterId, plan);
        setPets(data.pets);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save that reminder.');
        void load();
      } finally {
        setSavingFor(null);
      }
    },
    [load]
  );

  const patchReminderRow = useCallback(
    (pet: VisitReminderPet, reminder: ProposedReminder, patch: ReminderPlanOverride) => {
      if (reminder.origin === 'manual') {
        const extras = pet.plan.extras.map((e) =>
          e.key === reminder.key ? { ...e, ...patch } : e
        );
        void persist(pet, { ...pet.plan, extras });
        return;
      }
      const overrides = {
        ...pet.plan.overrides,
        [reminder.key]: { ...(pet.plan.overrides[reminder.key] ?? {}), ...patch },
      };
      void persist(pet, { ...pet.plan, overrides });
    },
    [persist]
  );

  const removeReminder = useCallback(
    (pet: VisitReminderPet, reminder: ProposedReminder) => {
      if (reminder.origin === 'manual') {
        // Nothing generated it, so dropping it entirely is right — there is no
        // catalog proposal underneath for a "removed" flag to sit on.
        void persist(pet, {
          ...pet.plan,
          extras: pet.plan.extras.filter((e) => e.key !== reminder.key),
        });
        return;
      }
      patchReminderRow(pet, reminder, { removed: true });
    },
    [patchReminderRow, persist]
  );

  const addReminder = useCallback(
    (pet: VisitReminderPet, extra: ReminderPlanExtra) => {
      void persist(pet, { ...pet.plan, extras: [...pet.plan.extras, extra] });
      setAddingFor(null);
      setEditingKey(extra.key);
    },
    [persist]
  );

  const removePastDueFromState = useCallback((reminderId: number) => {
    setPets((prev) =>
      prev.map((p) => ({
        ...p,
        pastDueReminders: (p.pastDueReminders ?? []).filter((r) => r.id !== reminderId),
      }))
    );
  }, []);

  const handleDeclinePastDue = useCallback(
    async (reminder: PastDueReminder) => {
      const proceed = await appConfirm({
        title: 'Owner declined this?',
        message: `Record “${reminder.description}” under Declined on the chart.`,
        confirmLabel: 'Record decline',
        cancelLabel: 'Cancel',
      });
      if (!proceed) return;
      const note = await appPrompt({
        title: 'Decline note (optional)',
        message: 'Why was this declined?',
        placeholder: 'Optional',
        confirmLabel: 'Save',
        cancelLabel: 'Skip note',
      });
      setPastDueBusyId(reminder.id);
      setError(null);
      try {
        await declineReminder(reminder.id, note);
        removePastDueFromState(reminder.id);
        void load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not decline that reminder.');
      } finally {
        setPastDueBusyId(null);
      }
    },
    [load, removePastDueFromState]
  );

  const handleDeletePastDue = useCallback(
    async (reminder: PastDueReminder) => {
      const proceed = await appConfirm({
        title: 'Remove this reminder?',
        message: `“${reminder.description}” will leave the reminder list (not recorded as declined).`,
        confirmLabel: 'Remove',
        cancelLabel: 'Cancel',
      });
      if (!proceed) return;
      setPastDueBusyId(reminder.id);
      setError(null);
      try {
        await patchReminder(reminder.id, { isHidden: true });
        removePastDueFromState(reminder.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not remove that reminder.');
      } finally {
        setPastDueBusyId(null);
      }
    },
    [removePastDueFromState]
  );

  if (loading) return <p className="soap-wrapup-hint">Loading reminders…</p>;

  return (
    <div className="soap-wrapup-reminders">
      {error && <div className="soap-error">{error}</div>}

      {pets.map((pet) => {
        const active = pet.reminders.filter((r) => !r.removed);
        const dropped = pet.reminders.filter((r) => r.removed);
        const busy = disabled || pet.locked || savingFor === pet.soapEncounterId;

        return (
          <div className="soap-wrapup-rem-pet" key={pet.soapEncounterId}>
            <div className="soap-wrapup-rem-pet-head">
              <strong>{pet.patientName}</strong>
              <span className="soap-wrapup-hint">
                {pet.locked
                  ? 'Chart signed — these reminders have been created.'
                  : active.length === 0
                    ? 'Nothing on this visit generates a reminder.'
                    : `${active.length} reminder${active.length === 1 ? '' : 's'} will be created when the chart is signed.`}
              </span>
            </div>

            {(pet.pastDueReminders ?? []).length > 0 ? (
              <div className="soap-wrapup-rem-pastdue">
                <div className="soap-wrapup-rem-pastdue-head">
                  <strong>Past due on chart ({pet.pastDueReminders!.length})</strong>
                  <span className="soap-wrapup-hint">
                    Ones this visit will clear (catalog clear-tags / same wording) are
                    hidden. Decline (owner said no) or remove (cleanup only) for the rest.
                  </span>
                </div>
                {pet.pastDueReminders!.map((reminder) => {
                  const rowBusy = pastDueBusyId === reminder.id;
                  return (
                    <div className="soap-wrapup-rem-pastdue-row" key={reminder.id}>
                      <div className="soap-wrapup-rem-pastdue-text">
                        <strong>{reminder.description}</strong>
                        <span>
                          Due{' '}
                          {reminder.dueDate
                            ? formatDeclinedDate(reminder.dueDate)
                            : '—'}
                        </span>
                      </div>
                      <div className="soap-wrapup-rem-pastdue-actions">
                        <button
                          type="button"
                          className="soap-btn ghost small"
                          disabled={Boolean(rowBusy || disabled)}
                          title="Owner declined — stays on the chart as declined"
                          onClick={() => void handleDeclinePastDue(reminder)}
                        >
                          🚫 Decline
                        </button>
                        <button
                          type="button"
                          className="soap-btn ghost small danger"
                          disabled={Boolean(rowBusy || disabled)}
                          title="Remove from the reminder list only"
                          onClick={() => void handleDeletePastDue(reminder)}
                        >
                          <X size={13} /> Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {active.length > 0 ? (
              <ul className="soap-wrapup-rem-list">
                {active.map((reminder) => {
                  const isEditing = editingKey === reminder.key;
                  if (isEditing && !pet.locked) {
                    return (
                      <li key={reminder.key} className="soap-wrapup-rem-list-edit">
                        <ReminderRow
                          reminder={reminder}
                          disabled={Boolean(busy)}
                          onPatch={(patch) => patchReminderRow(pet, reminder, patch)}
                          onRemove={() => {
                            removeReminder(pet, reminder);
                            setEditingKey(null);
                          }}
                          onDone={() => setEditingKey(null)}
                        />
                      </li>
                    );
                  }
                  return (
                    <li key={reminder.key} className="soap-wrapup-rem-list-row">
                      <span className="soap-wrapup-rem-list-label">{reminder.description}</span>
                      {reminder.dueDate ? (
                        <em className="soap-wrapup-rem-list-due">
                          Due {toDateInput(reminder.dueDate)}
                        </em>
                      ) : null}
                      {!pet.locked ? (
                        <span className="soap-wrapup-rem-list-actions">
                          <button
                            type="button"
                            className="soap-btn ghost small"
                            disabled={Boolean(busy)}
                            title="Edit reminder"
                            onClick={() => setEditingKey(reminder.key)}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            className="soap-btn ghost small danger"
                            disabled={Boolean(busy)}
                            title="Do not create this reminder"
                            onClick={() => removeReminder(pet, reminder)}
                          >
                            <X size={13} />
                          </button>
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {dropped.length > 0 && (
              <div className="soap-wrapup-rem-dropped">
                {dropped.map((reminder) => (
                  <div className="soap-wrapup-rem-dropped-row" key={reminder.key}>
                    <span>{reminder.description} — will not be created</span>
                    <button
                      type="button"
                      className="soap-btn ghost small"
                      disabled={Boolean(busy)}
                      onClick={() => patchReminderRow(pet, reminder, { removed: false })}
                    >
                      <RotateCcw size={13} /> Put back
                    </button>
                  </div>
                ))}
              </div>
            )}

            {(() => {
              const fromChart = (pet.declinedItems ?? []).map((item) => {
                const catalogMatch =
                  item.catalogItemId != null
                    ? pet.reminders.find((r) => r.sourceCatalogItemId === item.catalogItemId)
                    : null;
                const label =
                  item.label && item.label.toLowerCase() !== 'declined item'
                    ? item.label
                    : catalogMatch?.description ||
                      catalogMatch?.sourceLabel ||
                      'Declined treatment';
                return {
                  key: `ti-${item.id}`,
                  label,
                  declinedAt: item.declinedAt,
                  onChart: item.onChart !== false,
                };
              });
              const fromVisit = visitDeclines[pet.soapEncounterId] ?? [];
              const seen = new Set(fromChart.map((d) => d.label.toLowerCase()));
              const merged = [
                ...fromChart,
                ...fromVisit.filter((d) => !seen.has(d.label.toLowerCase())),
              ];
              if (merged.length === 0) return null;
              return (
                <div className="soap-wrapup-rem-declined">
                  {merged.map((item) => (
                    <div className="soap-wrapup-rem-declined-row" key={item.key}>
                      <strong>{item.label}</strong>
                      <span>
                        Declined
                        {item.declinedAt ? ` ${formatDeclinedDate(item.declinedAt)}` : ''}
                      </span>
                      <em>
                        {item.onChart
                          ? 'Will show on the chart'
                          : 'Will not show on the chart'}
                      </em>
                    </div>
                  ))}
                </div>
              );
            })()}

            {!pet.locked &&
              (addingFor === pet.soapEncounterId ? (
                <AddReminderForm
                  patientId={pet.patientId}
                  onCancel={() => setAddingFor(null)}
                  onAdd={(extra) => addReminder(pet, extra)}
                />
              ) : (
                <button
                  type="button"
                  className="soap-btn ghost small"
                  disabled={Boolean(disabled)}
                  onClick={() => setAddingFor(pet.soapEncounterId)}
                >
                  <Plus size={13} /> Add a reminder for {pet.patientName}
                </button>
              ))}
          </div>
        );
      })}
    </div>
  );
}

function ReminderDateFields({
  dueYmd,
  startYmd,
  stopYmd,
  disabled,
  onDue,
  onStart,
  onStop,
}: {
  dueYmd: string;
  startYmd: string;
  stopYmd: string;
  disabled?: boolean;
  onDue: (ymd: string) => void;
  onStart: (ymd: string) => void;
  onStop: (ymd: string) => void;
}) {
  const canQuick = Boolean(dueYmd) && !disabled;
  return (
    <div className="soap-wrapup-rem-dates">
      <label>
        <span>Due</span>
        <input
          type="date"
          className="soap-input"
          value={dueYmd}
          disabled={disabled}
          onChange={(e) => onDue(e.target.value)}
        />
      </label>
      <label>
        <span>Start reminding</span>
        <div className="soap-wrapup-rem-date-stack">
          <input
            type="date"
            className="soap-input"
            value={startYmd}
            disabled={disabled}
            onChange={(e) => onStart(e.target.value)}
          />
          <span className="soap-wrapup-rem-quick">
            <button
              type="button"
              className="soap-wrapup-rem-quick-btn"
              disabled={!canQuick}
              title="One week before due"
              onClick={() => onStart(offsetDateInput(dueYmd, -1, 0))}
            >
              −1w
            </button>
            <button
              type="button"
              className="soap-wrapup-rem-quick-btn"
              disabled={!canQuick}
              title="One month before due"
              onClick={() => onStart(offsetDateInput(dueYmd, 0, -1))}
            >
              −1m
            </button>
          </span>
        </div>
      </label>
      <label>
        <span>Stop reminding</span>
        <div className="soap-wrapup-rem-date-stack">
          <input
            type="date"
            className="soap-input"
            value={stopYmd}
            disabled={disabled}
            onChange={(e) => onStop(e.target.value)}
          />
          <span className="soap-wrapup-rem-quick">
            <button
              type="button"
              className="soap-wrapup-rem-quick-btn"
              disabled={!canQuick}
              title="One week after due"
              onClick={() => onStop(offsetDateInput(dueYmd, 1, 0))}
            >
              +1w
            </button>
            <button
              type="button"
              className="soap-wrapup-rem-quick-btn"
              disabled={!canQuick}
              title="One month after due"
              onClick={() => onStop(offsetDateInput(dueYmd, 0, 1))}
            >
              +1m
            </button>
          </span>
        </div>
      </label>
    </div>
  );
}

function ReminderRow({
  reminder,
  disabled,
  onPatch,
  onRemove,
  onDone,
}: {
  reminder: ProposedReminder;
  disabled: boolean;
  onPatch: (patch: ReminderPlanOverride) => void;
  onRemove: () => void;
  onDone?: () => void;
}) {
  return (
    <div className="soap-wrapup-rem-row">
      <div className="soap-wrapup-rem-row-head">
        <input
          className="soap-input soap-wrapup-rem-desc"
          value={reminder.description}
          disabled={disabled}
          aria-label="Reminder description"
          onChange={(e) => onPatch({ description: e.target.value })}
        />
        {onDone ? (
          <button
            type="button"
            className="soap-btn ghost small"
            disabled={disabled}
            onClick={onDone}
          >
            Done
          </button>
        ) : null}
        <button
          type="button"
          className="soap-btn ghost small danger"
          disabled={disabled}
          title="Do not create this reminder"
          onClick={onRemove}
        >
          <Trash2 size={13} />
        </button>
      </div>

      <ReminderDateFields
        dueYmd={toDateInput(reminder.dueDate)}
        startYmd={toDateInput(reminder.startReminding)}
        stopYmd={toDateInput(reminder.stopReminding)}
        disabled={disabled}
        onDue={(ymd) => onPatch({ dueDate: fromDateInput(ymd) })}
        onStart={(ymd) => onPatch({ startReminding: fromDateInput(ymd) })}
        onStop={(ymd) => onPatch({ stopReminding: fromDateInput(ymd) })}
      />

      <div className="soap-wrapup-rem-meta">
        {reminder.sourceLabel && <span>From {reminder.sourceLabel}</span>}
        {reminder.origin === 'manual' && <span>Added by hand</span>}
        {reminder.edited && <span className="is-edited">Overrides the catalog rule</span>}
      </div>
    </div>
  );
}

/**
 * A reminder the doctor writes themselves, optionally tied to a catalog item.
 *
 * The match matters beyond display: reminder outreach suppresses a product the household
 * already has on autoship, and "liver panel" as free text can't be tied back to the lab
 * it means.
 */
export function AddReminderForm({
  patientId,
  onCancel,
  onAdd,
  initialDescription = '',
}: {
  patientId: number;
  onCancel: () => void;
  onAdd: (extra: ReminderPlanExtra) => void;
  initialDescription?: string;
}) {
  const [description, setDescription] = useState(initialDescription);
  const [dueDate, setDueDate] = useState('');
  const [startReminding, setStartReminding] = useState('');
  const [stopReminding, setStopReminding] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchableItem[]>([]);
  const [match, setMatch] = useState<{
    label: string;
    type: ReminderSourceType;
    id: number;
  } | null>(null);
  const searchSeq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || match) {
      setResults([]);
      return;
    }
    const seq = ++searchSeq.current;
    const timer = window.setTimeout(() => {
      void searchItems({ q, practiceId: PRACTICE_ID, limit: 8, patientId })
        .then((rows) => {
          if (seq === searchSeq.current) setResults(rows);
        })
        .catch(() => {
          if (seq === searchSeq.current) setResults([]);
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, match, patientId]);

  const canSave = useMemo(
    () => Boolean(description.trim()) && Boolean(dueDate),
    [description, dueDate]
  );

  return (
    <div className="soap-wrapup-rem-add">
      <label className="soap-wrapup-rem-add-field">
        <span>What to remind about</span>
        <input
          className="soap-input"
          value={description}
          placeholder="e.g. Recheck ear infection"
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <ReminderDateFields
        dueYmd={dueDate}
        startYmd={startReminding}
        stopYmd={stopReminding}
        onDue={setDueDate}
        onStart={setStartReminding}
        onStop={setStopReminding}
      />

      <label className="soap-wrapup-rem-add-field">
        <span>Match to a catalog item (optional)</span>
        {match ? (
          <div className="soap-wrapup-rem-match">
            <Link2 size={13} /> {match.label} <em>({match.type})</em>
            <button
              type="button"
              className="soap-btn ghost small"
              onClick={() => {
                setMatch(null);
                setQuery('');
              }}
            >
              Change
            </button>
          </div>
        ) : (
          <input
            className="soap-input"
            value={query}
            placeholder="Search products, labs, procedures…"
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
      </label>

      {results.length > 0 && !match && (
        <ul className="soap-wrapup-rem-results">
          {results.map((item) => {
            const id = itemId(item);
            if (id == null) return null;
            const type = item.itemType as ReminderSourceType;
            return (
              <li key={`${item.itemType}-${id}`}>
                <button
                  type="button"
                  onClick={() => {
                    setMatch({ label: item.name, type, id });
                    setResults([]);
                    if (!description.trim()) setDescription(item.name);
                  }}
                >
                  <span>{item.name}</span>
                  <em>{item.itemType}</em>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="soap-wrapup-rem-add-actions">
        <button type="button" className="soap-btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="soap-btn"
          disabled={!canSave}
          title={canSave ? '' : 'Needs a description and a due date'}
          onClick={() =>
            onAdd({
              key: `manual:${crypto.randomUUID()}`,
              description: description.trim(),
              startReminding: fromDateInput(startReminding),
              dueDate: fromDateInput(dueDate),
              stopReminding: fromDateInput(stopReminding),
              sourceCatalogItemType: match?.type ?? null,
              sourceCatalogItemId: match?.id ?? null,
            })
          }
        >
          <BellRing size={14} /> Add reminder
        </button>
      </div>
    </div>
  );
}
