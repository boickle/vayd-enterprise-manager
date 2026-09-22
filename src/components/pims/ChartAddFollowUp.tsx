import { useEffect, useRef, useState } from 'react';
import { Bell, CheckSquare, Phone, Plus } from 'lucide-react';
import { createPatientReminder } from '../../api/careOutreach';
import { createTask, type TaskLinkInput } from '../../api/tasks';
import { fetchAllEmployees, type Employee } from '../../api/appointmentSettings';
import { listPracticeBranches } from '../../api/branchInventory';
import { searchItems, type SearchableItem } from '../../api/roomLoader';
import { formatEmployeeDisplayName } from '../../utils/employeeDisplayName';
import { fromDatetimeLocalValue, toDatetimeLocalValue } from '../../utils/taskDateTime';

type ComposeKind = 'reminder' | 'callback' | 'task';

type CatalogMatch = {
  type: 'inventory' | 'procedure' | 'lab';
  id: number;
  name: string;
};

type Props = {
  patientId: number;
  clientId: number | null;
  practiceId: number;
  onCreated: () => void;
  onNeedOpen?: () => void;
};

function catalogSearchId(item: SearchableItem): number | null {
  const record =
    item.itemType === 'inventory'
      ? item.inventoryItem
      : item.itemType === 'lab'
        ? item.lab
        : item.procedure;
  const id = Number(record?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromDateInput(value: string): string | null {
  if (!value.trim()) return null;
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function defaultTaskDueLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  d.setHours(10, 0, 0, 0);
  return toDatetimeLocalValue(d.toISOString());
}

export default function ChartAddFollowUp({
  patientId,
  clientId,
  practiceId,
  onCreated,
  onNeedOpen,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [compose, setCompose] = useState<ComposeKind | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  const start = (kind: ComposeKind) => {
    setCompose(kind);
    setMenuOpen(false);
    onNeedOpen?.();
  };

  return (
    <>
      <div className="pims-emr-add-followup" ref={wrapRef}>
        <button
          type="button"
          className="pims-emr-add-followup__btn"
          aria-expanded={menuOpen || compose != null}
          aria-haspopup="menu"
          onClick={() => {
            if (compose) {
              setCompose(null);
              setMenuOpen(false);
              return;
            }
            setMenuOpen((v) => !v);
          }}
        >
          <Plus size={13} aria-hidden />
          Add
        </button>
        {menuOpen && !compose ? (
          <div className="pims-emr-add-followup__menu" role="menu">
            <button type="button" role="menuitem" onClick={() => start('reminder')}>
              <Bell size={13} aria-hidden /> Reminder
            </button>
            <button type="button" role="menuitem" onClick={() => start('callback')}>
              <Phone size={13} aria-hidden /> Callback
            </button>
            <button type="button" role="menuitem" onClick={() => start('task')}>
              <CheckSquare size={13} aria-hidden /> Task
            </button>
          </div>
        ) : null}
      </div>
      {compose === 'reminder' ? (
        <ReminderForm
          patientId={patientId}
          practiceId={practiceId}
          onCancel={() => setCompose(null)}
          onSaved={() => {
            setCompose(null);
            onCreated();
          }}
        />
      ) : null}
      {compose === 'callback' || compose === 'task' ? (
        <StaffWorkForm
          kind={compose}
          patientId={patientId}
          clientId={clientId}
          practiceId={practiceId}
          onCancel={() => setCompose(null)}
          onSaved={() => {
            setCompose(null);
            onCreated();
          }}
        />
      ) : null}
    </>
  );
}

function ReminderForm({
  patientId,
  practiceId,
  onCancel,
  onSaved,
}: {
  patientId: number;
  practiceId: number;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [startReminding, setStartReminding] = useState(toDateInput(new Date().toISOString()));
  const [stopReminding, setStopReminding] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchableItem[]>([]);
  const [match, setMatch] = useState<CatalogMatch | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchSeq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || match) {
      setResults([]);
      return;
    }
    const seq = ++searchSeq.current;
    const timer = window.setTimeout(() => {
      void searchItems({ q, practiceId, limit: 8, patientId })
        .then((rows) => {
          if (seq === searchSeq.current) setResults(rows);
        })
        .catch(() => {
          if (seq === searchSeq.current) setResults([]);
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, match, practiceId, patientId]);

  const canSave = Boolean(description.trim()) && Boolean(dueDate);

  const save = async () => {
    const due = fromDateInput(dueDate);
    if (!description.trim() || !due) return;
    setSaving(true);
    setError(null);
    try {
      await createPatientReminder({
        patientId,
        description: description.trim(),
        dueDate: due,
        startReminding: fromDateInput(startReminding) ?? undefined,
        stopReminding: fromDateInput(stopReminding) ?? undefined,
        sourceCatalogItemType: match?.type ?? null,
        sourceCatalogItemId: match?.id ?? null,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create that reminder.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pims-emr-add-followup__form">
      <h4>Add reminder</h4>
      <p className="pims-emr-story__muted">
        Shows under Upcoming on the chart and on the client portal.
      </p>
      {error ? <p className="pims-emr-add-followup__error">{error}</p> : null}
      <label>
        <span>What to remind about</span>
        <input
          value={description}
          placeholder="e.g. Recheck ear infection"
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <div className="pims-emr-add-followup__row">
        <label>
          <span>Start reminding</span>
          <input
            type="date"
            value={startReminding}
            onChange={(e) => setStartReminding(e.target.value)}
          />
        </label>
        <label>
          <span>Due</span>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
        <label>
          <span>Stop reminding</span>
          <input
            type="date"
            value={stopReminding}
            onChange={(e) => setStopReminding(e.target.value)}
          />
        </label>
      </div>
      <label>
        <span>Catalog item (optional)</span>
        {match ? (
          <span className="pims-emr-add-followup__match">
            {match.name}{' '}
            <em>({match.type})</em>
            <button
              type="button"
              onClick={() => {
                setMatch(null);
                setQuery('');
              }}
            >
              Change
            </button>
          </span>
        ) : (
          <input
            value={query}
            placeholder="Search products, labs, procedures…"
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
      </label>
      {results.length > 0 && !match ? (
        <ul className="pims-emr-add-followup__results">
          {results.map((item) => {
            const id = catalogSearchId(item);
            if (id == null) return null;
            return (
              <li key={`${item.itemType}-${id}`}>
                <button
                  type="button"
                  onClick={() => {
                    setMatch({
                      type: item.itemType as CatalogMatch['type'],
                      id,
                      name: item.name,
                    });
                    setResults([]);
                    if (!description.trim()) setDescription(item.name);
                  }}
                >
                  {item.name} <em>({item.itemType})</em>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="pims-emr-add-followup__actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="is-primary"
          disabled={!canSave || saving}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save reminder'}
        </button>
      </div>
    </div>
  );
}

function StaffWorkForm({
  kind,
  patientId,
  clientId,
  practiceId,
  onCancel,
  onSaved,
}: {
  kind: 'callback' | 'task';
  patientId: number;
  clientId: number | null;
  practiceId: number;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const isCallback = kind === 'callback';
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [dueLocal, setDueLocal] = useState(defaultTaskDueLocal);
  const [assignee, setAssignee] = useState<number | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [branchIds, setBranchIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([fetchAllEmployees(), listPracticeBranches(practiceId)])
      .then(([emps, branches]) => {
        setEmployees(emps);
        setBranchIds(branches.map((b) => b.id));
      })
      .catch(() => setError('Could not load staff or branches.'));
  }, [practiceId]);

  const save = async () => {
    if (!title.trim()) return;
    if (branchIds.length === 0) {
      setError('Could not determine which branch this belongs to.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const due = fromDatetimeLocalValue(dueLocal);
      const links: TaskLinkInput[] = [{ entityType: 'patient', entityId: patientId }];
      if (clientId != null) links.push({ entityType: 'client', entityId: clientId });
      await createTask({
        title: title.trim(),
        body: body.trim() || null,
        ...(isCallback ? { kind: 'callback' as const } : {}),
        branchIds,
        assignedToEmployeeId: assignee,
        ...(due ? { dueAt: due } : {}),
        links,
      });
      onSaved();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : `Could not create that ${isCallback ? 'callback' : 'task'}.`,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pims-emr-add-followup__form">
      <h4>{isCallback ? 'Add callback' : 'Add task'}</h4>
      <p className="pims-emr-story__muted">
        {isCallback
          ? 'Staff only — someone calls the owner. Not on the client portal.'
          : 'Staff only — a to-do for the team. Not on the client portal.'}
      </p>
      {error ? <p className="pims-emr-add-followup__error">{error}</p> : null}
      <label>
        <span>{isCallback ? 'What to say' : 'What to do'}</span>
        <input
          value={title}
          placeholder={
            isCallback ? "e.g. Check how the rash is doing" : 'e.g. Send records to internist'
          }
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label>
        <span>Notes (optional)</span>
        <textarea
          rows={3}
          value={body}
          placeholder={
            isCallback
              ? "What to listen for, what to do if it's worse…"
              : 'Anything the assignee needs to know'
          }
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <div className="pims-emr-add-followup__row">
        <label>
          <span>{isCallback ? 'Who calls' : 'Who does it'}</span>
          <select
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
        <label>
          <span>{isCallback ? 'Call by' : 'Due'}</span>
          <input
            type="datetime-local"
            value={dueLocal}
            onChange={(e) => setDueLocal(e.target.value)}
          />
        </label>
      </div>
      <div className="pims-emr-add-followup__actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="is-primary"
          disabled={!title.trim() || saving}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : isCallback ? 'Save callback' : 'Save task'}
        </button>
      </div>
    </div>
  );
}

export function staffWorkKindLabel(kind: string | null | undefined): string {
  return kind === 'callback' ? 'Callback' : 'Task';
}
