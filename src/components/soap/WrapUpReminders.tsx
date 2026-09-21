import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BellRing, Link2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import {
  getVisitReminders,
  saveReminderPlan,
  type ProposedReminder,
  type ReminderPlanExtra,
  type ReminderPlanOverride,
  type ReminderSourceType,
  type VisitReminderPet,
} from '../../api/visitWrapUp';
import { formatDeclinedDate } from '../../api/declinedTreatments';
import { searchItems, type SearchableItem } from '../../api/roomLoader';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingFor, setSavingFor] = useState<string | null>(null);
  const [addingFor, setAddingFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getVisitReminders(encounterId);
      setPets(data.pets);
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

  const patchReminder = useCallback(
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
      patchReminder(pet, reminder, { removed: true });
    },
    [patchReminder, persist]
  );

  const addReminder = useCallback(
    (pet: VisitReminderPet, extra: ReminderPlanExtra) => {
      void persist(pet, { ...pet.plan, extras: [...pet.plan.extras, extra] });
      setAddingFor(null);
    },
    [persist]
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

            {active.map((reminder) => (
              <ReminderRow
                key={reminder.key}
                reminder={reminder}
                disabled={Boolean(busy)}
                onPatch={(patch) => patchReminder(pet, reminder, patch)}
                onRemove={() => removeReminder(pet, reminder)}
              />
            ))}

            {dropped.length > 0 && (
              <div className="soap-wrapup-rem-dropped">
                {dropped.map((reminder) => (
                  <div className="soap-wrapup-rem-dropped-row" key={reminder.key}>
                    <span>{reminder.description} — will not be created</span>
                    <button
                      type="button"
                      className="soap-btn ghost small"
                      disabled={Boolean(busy)}
                      onClick={() => patchReminder(pet, reminder, { removed: false })}
                    >
                      <RotateCcw size={13} /> Put back
                    </button>
                  </div>
                ))}
              </div>
            )}

            {(pet.declinedItems ?? []).length > 0 ? (
              <div className="soap-wrapup-rem-dropped">
                {(pet.declinedItems ?? []).map((item) => (
                  <div className="soap-wrapup-rem-dropped-row" key={item.id}>
                    <span>
                      {item.label} — declined
                      {item.declinedAt ? ` ${formatDeclinedDate(item.declinedAt)}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {(pet.plan.callbacks ?? []).length > 0 ? (
              <div className="soap-wrapup-rem-dropped">
                {(pet.plan.callbacks ?? []).map((cb) => (
                  <div className="soap-wrapup-rem-dropped-row" key={cb.key}>
                    <span>
                      Callback preview: {cb.title}
                      {cb.dueAt ? ` · due ${new Date(cb.dueAt).toLocaleDateString()}` : ''}
                      {' — created when the chart is signed'}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

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

function ReminderRow({
  reminder,
  disabled,
  onPatch,
  onRemove,
}: {
  reminder: ProposedReminder;
  disabled: boolean;
  onPatch: (patch: ReminderPlanOverride) => void;
  onRemove: () => void;
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

      <div className="soap-wrapup-rem-dates">
        <label>
          <span>Start reminding</span>
          <input
            type="date"
            className="soap-input"
            value={toDateInput(reminder.startReminding)}
            disabled={disabled}
            onChange={(e) => onPatch({ startReminding: fromDateInput(e.target.value) })}
          />
        </label>
        <label>
          <span>Due</span>
          <input
            type="date"
            className="soap-input"
            value={toDateInput(reminder.dueDate)}
            disabled={disabled}
            onChange={(e) => onPatch({ dueDate: fromDateInput(e.target.value) })}
          />
        </label>
        <label>
          <span>Stop reminding</span>
          <input
            type="date"
            className="soap-input"
            value={toDateInput(reminder.stopReminding)}
            disabled={disabled}
            onChange={(e) => onPatch({ stopReminding: fromDateInput(e.target.value) })}
          />
        </label>
      </div>

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
function AddReminderForm({
  patientId,
  onCancel,
  onAdd,
}: {
  patientId: number;
  onCancel: () => void;
  onAdd: (extra: ReminderPlanExtra) => void;
}) {
  const [description, setDescription] = useState('');
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

      <div className="soap-wrapup-rem-dates">
        <label>
          <span>Start reminding</span>
          <input
            type="date"
            className="soap-input"
            value={startReminding}
            onChange={(e) => setStartReminding(e.target.value)}
          />
        </label>
        <label>
          <span>Due</span>
          <input
            type="date"
            className="soap-input"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </label>
        <label>
          <span>Stop reminding</span>
          <input
            type="date"
            className="soap-input"
            value={stopReminding}
            onChange={(e) => setStopReminding(e.target.value)}
          />
        </label>
      </div>

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
