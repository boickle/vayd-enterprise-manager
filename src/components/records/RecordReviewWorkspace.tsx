import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ban, Bell, Check, ExternalLink, FileText, Plus, Trash2, X } from 'lucide-react';
import { createPatientReminder, listPatientOpenReminders } from '../../api/careOutreach';
import { createDeclinedItem } from '../../api/declinedTreatments';
import {
  matchReminderText,
  searchItems,
  submitReminderFeedback,
  type SearchableItem,
} from '../../api/roomLoader';
import type { OutsideRecordDeclined, OutsideRecordReminder } from '../../api/soapScribe';
import { VISIT_WORKFLOW_PRACTICE_ID } from '../../api/visitWorkflow';
import { appConfirm } from '../../utils/appDialog';
import './RecordReviewWorkspace.css';

export type WorkspaceDoc = {
  key: string;
  name: string;
  fileName: string;
  kind: 'pdf' | 'image' | 'text' | 'word' | 'other';
  previewUrl: string | null;
};

type CatalogMatch = { type: 'inventory' | 'procedure' | 'lab'; id: number; name: string };

type ReminderRow = {
  key: string;
  include: boolean;
  item: string;
  dueDate: string;
  lastDone: string;
  note: string;
  /** What the records said, used when there is no due date to go by. */
  recordStatus: OutsideRecordReminder['status'];
  /** The practice's reminder name for this service, used to find its catalog item. */
  practiceReminder: string;
  match: CatalogMatch | null;
  /** What the room loader matcher picked, so the CL's keep / change / unlink can teach it. */
  suggested: CatalogMatch | null;
  /** Open reminder already on our chart that looks like the same thing. */
  existing: { description: string; dueDate: string | null } | null;
  entered: boolean;
};

type DeclinedRow = {
  key: string;
  include: boolean;
  item: string;
  date: string;
  entered: boolean;
};

type Props = {
  /** Hidden rather than unmounted when closed, so checkmarks and entered rows survive. */
  open: boolean;
  patientId: number;
  patientName?: string | null;
  docs: WorkspaceDoc[];
  loadPreview: (key: string) => Promise<void>;
  summary: string;
  onSummaryChange: (next: string) => void;
  reminders: OutsideRecordReminder[];
  declined: OutsideRecordDeclined[];
  /** Writes the Previous Medical Records note; returns false when it failed. */
  writeSummaryNote: () => Promise<boolean>;
  onEntered: (counts: { summary: boolean; reminders: number; declined: number }) => void;
  onClose: () => void;
};

const GENERIC_WORDS = new Set([
  'booster',
  'boosters',
  'vaccine',
  'vaccination',
  'test',
  'testing',
  'annual',
  'year',
  'years',
  'yearly',
  'dose',
  'series',
  'recheck',
  'exam',
  'panel',
]);

const ALIASES: Record<string, string> = {
  leptospirosis: 'lepto',
  dhpp: 'da2pp',
  dapp: 'da2pp',
  distemper: 'da2pp',
  dhlpp: 'da2pp',
  fvrcp: 'fvrcp',
  bordatella: 'bordetella',
  kennel: 'bordetella',
  influenza: 'flu',
  civ: 'flu',
  lyme: 'lyme',
  heartworm: 'heartworm',
  hw: 'heartworm',
  '4dx': 'heartworm',
  fecal: 'fecal',
  parasite: 'fecal',
  dental: 'dental',
  bloodwork: 'bloodwork',
  cbc: 'bloodwork',
  chemistry: 'bloodwork',
};

function keyWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || GENERIC_WORDS.has(raw)) continue;
    if (/^\d+$/.test(raw)) continue;
    const word = ALIASES[raw] ?? raw;
    if (word.length >= 3) out.add(word);
  }
  return out;
}

function sameThing(a: string, b: string): boolean {
  const aw = keyWords(a);
  if (!aw.size) return false;
  for (const w of keyWords(b)) if (aw.has(w)) return true;
  return false;
}

function todayYmd(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function ymdToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function isoToYmd(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: 'numeric' });
}

function formatYmd(value: string): string {
  const [y, m, d] = value.split('-');
  return y && m && d ? `${m}/${d}/${y}` : value;
}

const STATUS_ORDER = ['overdue', 'soon', 'ok', 'none'];

function dueStatus(
  dueDate: string,
  recordStatus: OutsideRecordReminder['status'] = 'not_on_record'
): { label: string; tone: string } {
  if (!dueDate) {
    if (recordStatus === 'overdue') return { label: 'Overdue · no date', tone: 'overdue' };
    if (recordStatus === 'not_on_record') return { label: 'Not on record', tone: 'none' };
    return { label: 'No due date', tone: 'none' };
  }
  const today = todayYmd();
  if (dueDate < today) return { label: 'Overdue', tone: 'overdue' };
  const soon = new Date();
  soon.setDate(soon.getDate() + 90);
  const soonYmd = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(
    soon.getDate()
  ).padStart(2, '0')}`;
  if (dueDate <= soonYmd) return { label: 'Due soon', tone: 'soon' };
  return { label: 'Up to date', tone: 'ok' };
}

function catalogId(item: SearchableItem): number | null {
  const record =
    item.itemType === 'inventory'
      ? item.inventoryItem
      : item.itemType === 'lab'
        ? item.lab
        : item.procedure;
  const id = Number(record?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function toMatch(item: SearchableItem): CatalogMatch | null {
  const id = catalogId(item);
  if (id == null || !['inventory', 'procedure', 'lab'].includes(item.itemType)) return null;
  return { type: item.itemType as CatalogMatch['type'], id, name: item.name };
}

function sameItem(a: CatalogMatch | null, b: CatalogMatch | null): boolean {
  return Boolean(a && b && a.type === b.type && a.id === b.id);
}

/** Practice-wide, so the next pet's records match the same way. Best effort. */
function teachMatcher(row: ReminderRow): void {
  const reminderText = (row.practiceReminder || row.item).trim();
  const { match, suggested } = row;
  if (!reminderText || (!match && !suggested)) return;
  const base = { reminderText, practiceId: VISIT_WORKFLOW_PRACTICE_ID };
  const body =
    match && (!suggested || sameItem(match, suggested))
      ? { ...base, isCorrect: true, itemType: match.type, itemId: match.id }
      : {
          ...base,
          isCorrect: false,
          itemType: suggested!.type,
          itemId: suggested!.id,
          ...(match ? { correctItemType: match.type, correctItemId: match.id } : {}),
        };
  void submitReminderFeedback(body).catch(() => undefined);
}

function newKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function errorText(err: unknown, fallback: string): string {
  const response = (err as { response?: { data?: { message?: unknown } } })?.response;
  const message = response?.data?.message;
  if (typeof message === 'string' && message.trim()) return message;
  return err instanceof Error && err.message ? err.message : fallback;
}

export default function RecordReviewWorkspace({
  open,
  patientId,
  patientName,
  docs,
  loadPreview,
  summary,
  onSummaryChange,
  reminders,
  declined,
  writeSummaryNote,
  onEntered,
  onClose,
}: Props) {
  const [activeKey, setActiveKey] = useState<string | null>(docs[0]?.key ?? null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [tab, setTab] = useState<'reminders' | 'summary'>('reminders');
  const [rows, setRows] = useState<ReminderRow[]>(() =>
    reminders
      .filter((r) => !declined.some((d) => sameThing(r.item, d.item)))
      .map((r) => ({
        key: newKey('rem'),
        include: Boolean(r.dueDate),
        item: r.item,
        dueDate: r.dueDate,
        lastDone: r.lastDone,
        note: r.note,
        recordStatus: r.status,
        practiceReminder: r.practiceReminder ?? '',
        match: null,
        suggested: null,
        existing: null,
        entered: false,
      }))
      .sort(
        (a, b) =>
          STATUS_ORDER.indexOf(dueStatus(a.dueDate, a.recordStatus).tone) -
            STATUS_ORDER.indexOf(dueStatus(b.dueDate, b.recordStatus).tone) ||
          a.dueDate.localeCompare(b.dueDate)
      )
  );
  const [declinedRows, setDeclinedRows] = useState<DeclinedRow[]>(() =>
    declined.map((d) => ({
      key: newKey('dec'),
      include: true,
      item: d.item,
      date: d.date,
      entered: false,
    }))
  );
  const [noteDone, setNoteDone] = useState(false);
  const [includeSummary, setIncludeSummary] = useState(true);
  const [includeReminders, setIncludeReminders] = useState(true);
  /** The CL has to open the summary once before it goes on the Timeline. */
  const [summaryViewed, setSummaryViewed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chartChecked, setChartChecked] = useState(false);
  const initialRows = useRef(
    rows.map((row) => ({ key: row.key, text: (row.practiceReminder || row.item).trim() }))
  );

  const active = docs.find((d) => d.key === activeKey) ?? null;

  useEffect(() => {
    if (open && tab === 'summary') setSummaryViewed(true);
  }, [open, tab]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, saving]);

  useEffect(() => {
    if (!open || !active || active.previewUrl || active.kind === 'word' || active.kind === 'other')
      return;
    setPreviewError(null);
    loadPreview(active.key).catch((err) =>
      setPreviewError(errorText(err, `Could not open ${active.name}.`))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active?.key, active?.previewUrl]);

  /** Flag anything already open on our chart, and link the obvious catalog item. */
  useEffect(() => {
    let cancelled = false;
    void listPatientOpenReminders(patientId)
      .then((open) => {
        if (cancelled) return;
        setRows((prev) =>
          prev.map((row) => {
            const hit = open.find((o) => sameThing(row.item, o.description));
            if (!hit) return row;
            return {
              ...row,
              include: false,
              existing: { description: hit.description, dueDate: hit.dueDate ?? null },
            };
          })
        );
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setChartChecked(true);
      });
    const lookups = initialRows.current.filter((r) => r.text);
    void matchReminderText(
      lookups.map((r) => r.text),
      patientId
    )
      .then((matches) => {
        if (cancelled) return;
        const byKey = new Map<string, CatalogMatch>();
        matches.forEach((m, i) => {
          // Fuzzy name matches pair boosters with antibody tests; only trust links staff made.
          if (m.source !== 'catalog' && m.source !== 'learned') return;
          if (!m.itemType || !m.itemId || !m.itemName || !lookups[i]) return;
          byKey.set(lookups[i].key, { type: m.itemType, id: m.itemId, name: m.itemName });
        });
        setRows((prev) =>
          prev.map((row) => {
            const suggested = byKey.get(row.key) ?? null;
            if (!suggested || row.match) return row;
            return { ...row, match: suggested, suggested };
          })
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  const patchRow = (key: string, next: Partial<ReminderRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...next } : r)));
  const patchDeclined = (key: string, next: Partial<DeclinedRow>) =>
    setDeclinedRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...next } : r)));

  const pendingReminders = includeReminders ? rows.filter((r) => r.include && !r.entered) : [];
  const pendingDeclined = includeReminders
    ? declinedRows.filter((r) => r.include && !r.entered)
    : [];
  const invalidReminder = pendingReminders.find((r) => !r.item.trim() || !ymdToIso(r.dueDate));
  const invalidDeclined = pendingDeclined.find((r) => !r.item.trim());
  const wantSummary = includeSummary && !noteDone;
  const wantReminders = pendingReminders.length + pendingDeclined.length > 0;
  const mustReviewSummary = wantSummary && !summaryViewed;
  const canEnter =
    !saving &&
    !invalidReminder &&
    !invalidDeclined &&
    (wantSummary || wantReminders) &&
    (!wantSummary || Boolean(summary.trim()));
  const enterLabel =
    wantSummary && wantReminders
      ? 'Enter Reminders & Summary in Record'
      : wantSummary
        ? 'Enter Summary Only'
        : 'Enter Reminders Only';

  const enterInRecord = async () => {
    const parts = [
      wantSummary ? 'the Previous Medical Records summary note' : null,
      pendingReminders.length
        ? `${pendingReminders.length} reminder${pendingReminders.length === 1 ? '' : 's'}`
        : null,
      pendingDeclined.length
        ? `${pendingDeclined.length} declined item${pendingDeclined.length === 1 ? '' : 's'}`
        : null,
    ].filter(Boolean);
    const ok = await appConfirm({
      title: 'Enter in medical record?',
      message: `This adds ${parts.join(', ')} to ${patientName?.trim() || 'this patient'}’s chart. Reminders show under Upcoming and on the client portal.`,
      confirmLabel: enterLabel,
    });
    if (!ok) return;
    setSaving(true);
    setError(null);
    let summaryWritten = noteDone;
    try {
      if (wantSummary) {
        const wrote = await writeSummaryNote();
        if (!wrote) {
          setError('Could not add the summary note. Nothing else was entered.');
          return;
        }
        setNoteDone(true);
        summaryWritten = true;
      }
      const failed: string[] = [];
      let remindersDone = rows.filter((r) => r.entered).length;
      for (const row of pendingReminders) {
        try {
          await createPatientReminder({
            patientId,
            description: row.item.trim(),
            dueDate: ymdToIso(row.dueDate)!,
            sourceCatalogItemType: row.match?.type ?? null,
            sourceCatalogItemId: row.match?.id ?? null,
          });
          patchRow(row.key, { entered: true });
          teachMatcher(row);
          remindersDone += 1;
        } catch (err) {
          failed.push(`${row.item.trim()} (${errorText(err, 'failed')})`);
        }
      }
      let declinedDone = declinedRows.filter((r) => r.entered).length;
      for (const row of pendingDeclined) {
        try {
          await createDeclinedItem({
            patientId,
            label: row.item.trim(),
            declinedAt: ymdToIso(row.date) ?? undefined,
            note: 'From previous medical records',
          });
          patchDeclined(row.key, { entered: true });
          declinedDone += 1;
        } catch (err) {
          failed.push(`${row.item.trim()} (${errorText(err, 'failed')})`);
        }
      }
      if (failed.length) {
        setError(
          `${summaryWritten ? 'Summary note added, but these' : 'These'} did not save: ${failed.join('; ')}. Fix them and press the button again — nothing is entered twice.`
        );
        return;
      }
      onEntered({ summary: summaryWritten, reminders: remindersDone, declined: declinedDone });
    } finally {
      setSaving(false);
    }
  };

  const remindersCount = rows.filter((r) => r.include).length;
  const pendingDeclinedCount = declinedRows.filter((r) => r.include && !r.entered).length;

  if (!open) return null;

  return createPortal(
    <div className="rrw" role="dialog" aria-modal="true" aria-label="Review records">
      <div className="rrw__panel">
        <header className="rrw__top">
          <div>
            <h2>Review previous records{patientName ? ` · ${patientName}` : ''}</h2>
            <p>
              Check the summary and reminders against the documents, then enter them in the medical
              record.
            </p>
          </div>
          <button
            type="button"
            className="rrw__icon-btn"
            aria-label="Close review"
            disabled={saving}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className="rrw__body">
          <section className="rrw__docs" aria-label="Documents">
            <div className="rrw__doc-tabs" role="tablist">
              {docs.map((doc, i) => (
                <button
                  key={doc.key}
                  type="button"
                  role="tab"
                  aria-selected={doc.key === activeKey}
                  className={`rrw__doc-tab${doc.key === activeKey ? ' is-active' : ''}`}
                  title={doc.fileName}
                  onClick={() => setActiveKey(doc.key)}
                >
                  <FileText size={13} aria-hidden />
                  <span>
                    {i + 1}. {doc.name}
                  </span>
                </button>
              ))}
            </div>
            <div className="rrw__viewer">
              {!active ? (
                <p className="rrw__muted">No documents.</p>
              ) : previewError ? (
                <p className="rrw__error">{previewError}</p>
              ) : active.kind === 'word' || active.kind === 'other' ? (
                <p className="rrw__muted">
                  No preview for this file type.
                  {active.previewUrl ? (
                    <>
                      {' '}
                      <a href={active.previewUrl} download={active.fileName}>
                        Download it
                      </a>{' '}
                      to look.
                    </>
                  ) : null}
                </p>
              ) : !active.previewUrl ? (
                <p className="rrw__muted">Opening {active.name}…</p>
              ) : active.kind === 'image' ? (
                <div className="rrw__image">
                  <img src={active.previewUrl} alt={active.name} />
                </div>
              ) : (
                <iframe key={active.key} src={active.previewUrl} title={active.name} />
              )}
            </div>
            {active?.previewUrl ? (
              <a className="rrw__open" href={active.previewUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={12} aria-hidden /> Open in a new tab
              </a>
            ) : null}
          </section>

          <section className="rrw__side">
            <div className="rrw__side-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'reminders'}
                className={tab === 'reminders' ? 'is-active' : ''}
                onClick={() => setTab('reminders')}
              >
                <Bell size={14} aria-hidden /> Reminders
                <span className="rrw__count">{remindersCount}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'summary'}
                className={tab === 'summary' ? 'is-active' : ''}
                onClick={() => setTab('summary')}
              >
                <FileText size={14} aria-hidden /> Summary
                {noteDone ? (
                  <span className="rrw__tab-flag is-done" title="Added to the medical record">
                    <Check size={12} aria-hidden /> Added
                  </span>
                ) : !includeSummary ? (
                  <span className="rrw__tab-flag is-off">Not entering</span>
                ) : summaryViewed ? (
                  <span className="rrw__tab-flag is-done" title="Reviewed">
                    <Check size={12} aria-hidden /> Reviewed
                  </span>
                ) : (
                  <span className="rrw__tab-flag is-todo">Review</span>
                )}
              </button>
            </div>

            <div className="rrw__side-scroll">
              {tab === 'summary' ? (
                <div className="rrw__summary">
                  {noteDone ? (
                    <em className="rrw__done">Added to the medical record.</em>
                  ) : (
                    <label className="rrw__toggle">
                      <input
                        type="checkbox"
                        checked={includeSummary}
                        disabled={saving}
                        onChange={(e) => setIncludeSummary(e.target.checked)}
                      />
                      Add this summary to the medical record
                    </label>
                  )}
                  <span>Goes on the Timeline as “Previous Medical Records”. Edit as needed.</span>
                  <textarea
                    value={summary}
                    aria-label="Summary"
                    disabled={saving || noteDone || !includeSummary}
                    onChange={(e) => onSummaryChange(e.target.value)}
                  />
                </div>
              ) : (
                <>
                  <label className="rrw__toggle">
                    <input
                      type="checkbox"
                      checked={includeReminders}
                      disabled={saving}
                      onChange={(e) => setIncludeReminders(e.target.checked)}
                    />
                    Add the checked reminders{declinedRows.length ? ' and declined items' : ''} to
                    the chart
                  </label>
                  <p className="rrw__muted">
                    Checked reminders are added to the chart. Uncheck anything wrong, fix dates
                    against the documents, or add one that was missed.
                    {chartChecked ? '' : ' Checking the chart for reminders already on file…'}
                  </p>
                  {rows.length === 0 ? (
                    <p className="rrw__muted">No reminders were found in these records.</p>
                  ) : null}
                  <ul className="rrw__rows">
                    {rows.map((row) => {
                      const status = dueStatus(row.dueDate, row.recordStatus);
                      return (
                        <li
                          key={row.key}
                          className={`rrw__row${row.include ? '' : ' is-off'}${
                            row.entered ? ' is-entered' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={row.include}
                            disabled={saving || row.entered}
                            aria-label={`Enter ${row.item || 'reminder'}`}
                            onChange={(e) => patchRow(row.key, { include: e.target.checked })}
                          />
                          <div className="rrw__row-main">
                            <div className="rrw__row-line">
                              <input
                                className="rrw__item"
                                value={row.item}
                                placeholder="What is due (e.g. Rabies 3 yr)"
                                disabled={saving || row.entered}
                                onChange={(e) => patchRow(row.key, { item: e.target.value })}
                              />
                              <span className={`rrw__pill is-${status.tone}`}>
                                {row.entered ? 'Entered' : status.label}
                              </span>
                            </div>
                            <div className="rrw__row-line">
                              <label className="rrw__date">
                                <span>Due</span>
                                <input
                                  type="date"
                                  value={row.dueDate}
                                  disabled={saving || row.entered}
                                  onChange={(e) => patchRow(row.key, { dueDate: e.target.value })}
                                />
                              </label>
                              {row.lastDone ? (
                                <span className="rrw__muted">
                                  Last done {formatYmd(row.lastDone)}
                                </span>
                              ) : null}
                              {row.note ? <span className="rrw__muted">· {row.note}</span> : null}
                            </div>
                            <CatalogLink
                              patientId={patientId}
                              match={row.match}
                              isSuggestion={sameItem(row.match, row.suggested)}
                              disabled={saving || row.entered}
                              seed={row.item}
                              onChange={(match) => patchRow(row.key, { match })}
                            />
                            {row.existing ? (
                              <p className="rrw__warn">
                                Already on the chart: {row.existing.description}
                                {row.existing.dueDate
                                  ? ` (due ${isoToYmd(row.existing.dueDate)})`
                                  : ''}
                                . Check it only if this is a different reminder.
                              </p>
                            ) : null}
                            {row.include && !row.entered && !row.dueDate ? (
                              <p className="rrw__warn">Add a due date to enter this one.</p>
                            ) : null}
                          </div>
                          {row.entered ? (
                            <Check size={16} className="rrw__ok" aria-hidden />
                          ) : (
                            <button
                              type="button"
                              className="rrw__icon-btn"
                              aria-label={`Remove ${row.item || 'reminder'}`}
                              disabled={saving}
                              onClick={() =>
                                setRows((prev) => prev.filter((r) => r.key !== row.key))
                              }
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <button
                    type="button"
                    className="rrw__btn"
                    disabled={saving}
                    onClick={() =>
                      setRows((prev) => [
                        ...prev,
                        {
                          key: newKey('rem'),
                          include: true,
                          item: '',
                          dueDate: '',
                          lastDone: '',
                          note: '',
                          recordStatus: 'not_on_record',
                          practiceReminder: '',
                          match: null,
                          suggested: null,
                          existing: null,
                          entered: false,
                        },
                      ])
                    }
                  >
                    <Plus size={13} aria-hidden /> Add a reminder
                  </button>

                  {declinedRows.length ? (
                    <>
                      <h3 className="rrw__subhead">
                        <Ban size={14} aria-hidden /> Declined
                      </h3>
                      <ul className="rrw__rows">
                        {declinedRows.map((row) => (
                          <li
                            key={row.key}
                            className={`rrw__row${row.include ? '' : ' is-off'}${
                              row.entered ? ' is-entered' : ''
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={row.include}
                              disabled={saving || row.entered}
                              aria-label={`Enter declined ${row.item}`}
                              onChange={(e) =>
                                patchDeclined(row.key, { include: e.target.checked })
                              }
                            />
                            <div className="rrw__row-main">
                              <div className="rrw__row-line">
                                <input
                                  className="rrw__item"
                                  value={row.item}
                                  disabled={saving || row.entered}
                                  onChange={(e) => patchDeclined(row.key, { item: e.target.value })}
                                />
                                {row.entered ? (
                                  <span className="rrw__pill is-ok">Entered</span>
                                ) : null}
                              </div>
                              <label className="rrw__date">
                                <span>Declined</span>
                                <input
                                  type="date"
                                  value={row.date}
                                  disabled={saving || row.entered}
                                  onChange={(e) => patchDeclined(row.key, { date: e.target.value })}
                                />
                              </label>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </>
              )}
            </div>

            <footer className="rrw__foot">
              {error ? <p className="rrw__error">{error}</p> : null}
              {invalidReminder ? (
                <p className="rrw__warn">Every checked reminder needs a name and a due date.</p>
              ) : null}
              {mustReviewSummary && !saving ? (
                <p className="rrw__muted">
                  Open the Summary tab to check it before it goes on the Timeline, or uncheck
                  Summary to enter reminders only.
                </p>
              ) : null}
              <div className="rrw__foot-bar">
                <div className="rrw__choices" aria-label="What to enter">
                  <label className="rrw__toggle">
                    <input
                      type="checkbox"
                      checked={includeReminders}
                      disabled={saving}
                      onChange={(e) => setIncludeReminders(e.target.checked)}
                    />
                    Reminders ({rows.filter((r) => r.include && !r.entered).length}
                    {pendingDeclinedCount ? ` + ${pendingDeclinedCount} declined` : ''})
                  </label>
                  <label className="rrw__toggle">
                    <input
                      type="checkbox"
                      checked={noteDone || includeSummary}
                      disabled={saving || noteDone}
                      onChange={(e) => setIncludeSummary(e.target.checked)}
                    />
                    {noteDone ? 'Summary (added)' : 'Summary'}
                  </label>
                </div>
                {mustReviewSummary ? (
                  <button
                    type="button"
                    className="rrw__btn rrw__btn--primary"
                    disabled={saving}
                    onClick={() => setTab('summary')}
                  >
                    <FileText size={14} aria-hidden />
                    Review Summary First
                  </button>
                ) : (
                  <button
                    type="button"
                    className="rrw__btn rrw__btn--primary"
                    disabled={!canEnter}
                    onClick={() => void enterInRecord()}
                  >
                    <Check size={14} aria-hidden />
                    {saving ? 'Entering…' : enterLabel}
                  </button>
                )}
              </div>
            </footer>
          </section>
        </div>
      </div>
    </div>,
    document.body
  );
}

function CatalogLink({
  patientId,
  match,
  isSuggestion,
  seed,
  disabled,
  onChange,
}: {
  patientId: number;
  match: CatalogMatch | null;
  isSuggestion: boolean;
  seed: string;
  disabled: boolean;
  onChange: (match: CatalogMatch | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchableItem[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const mine = ++seq.current;
    const timer = window.setTimeout(() => {
      void searchItems({ q, practiceId: VISIT_WORKFLOW_PRACTICE_ID, limit: 8, patientId })
        .then((rows) => {
          if (mine === seq.current) setResults(rows);
        })
        .catch(() => {
          if (mine === seq.current) setResults([]);
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [open, query, patientId]);

  if (!open) {
    return (
      <div className="rrw__catalog">
        {match ? (
          <>
            <span>
              {isSuggestion ? 'Suggested catalog item' : 'Catalog'}: <strong>{match.name}</strong>{' '}
              <em>({match.type})</em>
            </span>
            {disabled ? null : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setQuery(seed);
                    setOpen(true);
                  }}
                >
                  Change
                </button>
                <button type="button" onClick={() => onChange(null)}>
                  Unlink
                </button>
              </>
            )}
          </>
        ) : disabled ? null : (
          <button
            type="button"
            onClick={() => {
              setQuery(seed);
              setOpen(true);
            }}
          >
            Link a catalog item (optional)
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rrw__catalog is-open">
      <input
        value={query}
        placeholder="Search products, labs, procedures…"
        onChange={(e) => setQuery(e.target.value)}
      />
      <button type="button" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {results.length ? (
        <ul>
          {results.map((item) => {
            const next = toMatch(item);
            if (!next) return null;
            return (
              <li key={`${next.type}-${next.id}`}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(next);
                    setOpen(false);
                  }}
                >
                  {item.name} <em>({item.itemType})</em>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
