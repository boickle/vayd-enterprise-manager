import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Upload, X } from 'lucide-react';
import {
  importMembershipPlans,
  listBundles,
  type Bundle,
  type MembershipPlanFile,
  type PlanImportCopy,
  type PlanImportResult,
  type PlanImportRow,
} from '../../api/memberships';
import '../AppDialog.css';
import './MembershipApplyReviewDialog.css';
import './MembershipPlanUploadDialog.css';

type Target = number | 'new' | 'skip';

type Mapping = { key: string; sourceIndex: number; target: Target };

let mappingSeed = 0;
function mappingKey(): string {
  mappingSeed += 1;
  return `map-${mappingSeed}`;
}

function extractErr(e: unknown): string {
  const err = e as { response?: { data?: { message?: unknown } }; message?: string };
  const msg = err?.response?.data?.message ?? err?.message;
  if (Array.isArray(msg)) return msg.join(' ');
  return typeof msg === 'string' && msg ? msg : 'Something went wrong.';
}

const STATUS_LABEL: Record<PlanImportRow['status'], string> = {
  ready: 'Ready',
  no_changes: 'Already matches',
  blocked: 'Needs attention',
  saved: 'Saved',
  failed: 'Not saved',
};

function sentMappings(mappings: Mapping[]) {
  return mappings
    .filter((m) => m.target !== 'skip')
    .map((m) => ({
      sourceIndex: m.sourceIndex,
      ...(typeof m.target === 'number' ? { targetPackageId: m.target } : {}),
    }));
}

function RowDetail({ row }: { row: PlanImportRow }) {
  const sections: Array<[string, string[], string]> = [
    ['Cannot match in this catalog', row.unmatched, 'remove'],
    ['Plan settings', row.settingChanges, 'change'],
    ['Benefits added', row.benefitsAdded, 'add'],
    ['Benefits changed', row.benefitsChanged, 'change'],
    ['Benefits taken off the plan', row.benefitsRemoved, 'remove'],
    ['Heads up', row.warnings, 'change'],
  ];
  const shown = sections.filter(([, items]) => items.length > 0);
  if (!shown.length && !row.error) {
    return <p className="settings-muted mship-upload__none">Nothing on this plan would change.</p>;
  }
  return (
    <div className="mship-review__detail">
      {row.error ? <p className="mship-upload__error">{row.error}</p> : null}
      {shown.map(([label, items, kind]) => (
        <div key={label} className="mship-review__kind">
          <p className={`mship-review__kind-label mship-review__kind-label--${kind}`}>{label}</p>
          <ul>
            {items.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * Upload a downloaded plans file: pick which plan each one goes onto, preview
 * every change, then save. Members are not touched; that stays a separate step.
 */
export default function MembershipPlanUploadDialog({
  preferTargetId,
  onClose,
}: {
  /** Opened from this plan: a one-plan file goes onto it unless staff pick otherwise. */
  preferTargetId?: number;
  /** `changed` is true when at least one plan was saved. */
  onClose: (changed: boolean) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<MembershipPlanFile | null>(null);
  const [fileName, setFileName] = useState('');
  const [plansHere, setPlansHere] = useState<Bundle[]>([]);
  const [copy, setCopy] = useState<PlanImportCopy>('everything');
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [preview, setPreview] = useState<PlanImportResult | null>(null);
  const [result, setResult] = useState<PlanImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const previewSeq = useRef(0);

  useEffect(() => {
    void listBundles({ kind: 'membership', includeArchived: true })
      .then(setPlansHere)
      .catch(() => setPlansHere([]));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        onClose(Boolean(result?.rows.some((r) => r.status === 'saved')));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose, result]);

  const sortedPlansHere = useMemo(
    () =>
      [...plansHere].sort(
        (a, b) => Number(a.isArchived) - Number(b.isArchived) || a.name.localeCompare(b.name)
      ),
    [plansHere]
  );

  async function chooseFile(picked: File | undefined) {
    if (!picked) return;
    setError(null);
    setPreview(null);
    setResult(null);
    setMappings([]);
    let parsed: MembershipPlanFile;
    try {
      parsed = JSON.parse(await picked.text());
    } catch {
      setFile(null);
      setError('That file could not be read. Pick a plans file downloaded from Scout.');
      return;
    }
    setFile(parsed);
    setFileName(picked.name);
    setBusy(true);
    try {
      const suggested = await importMembershipPlans({ file: parsed, copy });
      const next: Mapping[] = suggested.rows.map((row) => ({
        key: mappingKey(),
        sourceIndex: row.sourceIndex,
        target: row.targetPackageId ?? 'new',
      }));
      const ontoOpenPlan =
        preferTargetId != null && next.length === 1 && next[0].target !== preferTargetId;
      if (ontoOpenPlan) {
        next[0] = { ...next[0], target: preferTargetId };
        setPreview(
          await importMembershipPlans({
            file: parsed,
            copy,
            mappings: sentMappings(next),
            dryRun: true,
          })
        );
      } else {
        setPreview(suggested);
      }
      setMappings(next);
    } catch (e) {
      setFile(null);
      setError(extractErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function refreshPreview(nextMappings: Mapping[], nextCopy: PlanImportCopy) {
    if (!file) return;
    const seq = ++previewSeq.current;
    setBusy(true);
    setError(null);
    try {
      const sent = sentMappings(nextMappings);
      const next = sent.length
        ? await importMembershipPlans({ file, copy: nextCopy, mappings: sent, dryRun: true })
        : { ...(preview as PlanImportResult), rows: [] };
      if (seq === previewSeq.current) setPreview(next);
    } catch (e) {
      if (seq === previewSeq.current) setError(extractErr(e));
    } finally {
      if (seq === previewSeq.current) setBusy(false);
    }
  }

  function changeMappings(next: Mapping[]) {
    setMappings(next);
    void refreshPreview(next, copy);
  }

  function changeCopy(next: PlanImportCopy) {
    setCopy(next);
    void refreshPreview(mappings, next);
  }

  async function save() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await importMembershipPlans({ file, copy, mappings: sentMappings(mappings) });
      setResult(saved);
    } catch (e) {
      setError(extractErr(e));
    } finally {
      setBusy(false);
    }
  }

  /** Preview rows line up with the mappings that were sent, in order. */
  const rowFor = useMemo(() => {
    const out = new Map<string, PlanImportRow>();
    const source = result ?? preview;
    if (!source) return out;
    const sent = mappings.filter((m) => m.target !== 'skip');
    sent.forEach((m, i) => {
      const row = source.rows[i];
      if (row && row.sourceIndex === m.sourceIndex) out.set(m.key, row);
    });
    return out;
  }, [mappings, preview, result]);

  const readyCount = mappings.filter((m) => rowFor.get(m.key)?.status === 'ready').length;
  const savedRows = result?.rows.filter((r) => r.status === 'saved') ?? [];
  const failedRows = result?.rows.filter((r) => r.status === 'failed') ?? [];
  const needsApply = savedRows.filter(
    (r) =>
      r.activeMemberCount > 0 &&
      (r.benefitsAdded.length || r.benefitsChanged.length || r.benefitsRemoved.length)
  );

  const toggle = (key: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const close = () => onClose(savedRows.length > 0);

  const exportedOn = file?.exportedAt
    ? new Date(file.exportedAt).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : null;

  return (
    <div
      className="app-dialog-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) close();
      }}
    >
      <div
        className="app-dialog mship-review mship-upload"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mship-upload-title"
      >
        <header className="mship-review__head">
          <h2 id="mship-upload-title" className="app-dialog__title">
            {result ? 'Upload finished' : 'Upload membership plans'}
          </h2>
          {result ? (
            <p className="mship-review__summary">
              <strong>{savedRows.length}</strong> plan{savedRows.length === 1 ? '' : 's'} saved
              {failedRows.length ? `, ${failedRows.length} not saved` : ''}.
            </p>
          ) : (
            <p className="mship-review__summary">
              Pick a plans file downloaded from Scout. You choose which plan each one goes onto and
              see every change before anything is saved. Current members are not changed here.
            </p>
          )}
          {file && !result ? (
            <p className="mship-review__stats">
              {fileName} · {file.plans?.length ?? 0} plan{file.plans?.length === 1 ? '' : 's'}
              {file.environment ? ` · from ${file.environment}` : ''}
              {exportedOn ? ` · downloaded ${exportedOn}` : ''}
            </p>
          ) : null}
        </header>

        <div className="mship-review__body">
          {error ? <p className="mship-upload__error">{error}</p> : null}

          {!result ? (
            <div className="mship-upload__pick">
              <input
                ref={fileInput}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(e) => {
                  void chooseFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className="app-dialog__btn"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                <Upload size={14} aria-hidden /> {file ? 'Choose a different file' : 'Choose file'}
              </button>
              {busy ? <span className="settings-muted">Checking…</span> : null}
            </div>
          ) : null}

          {file && !result ? (
            <fieldset className="mship-upload__copy">
              <legend className="app-dialog__hint">
                What to copy onto plans that already exist
              </legend>
              <label>
                <input
                  type="radio"
                  name="mship-upload-copy"
                  checked={copy === 'everything'}
                  disabled={busy}
                  onChange={() => changeCopy('everything')}
                />
                <span>
                  <strong>Everything</strong> — benefits, price, discounts, ages, and signup card
                  text. Name, portal link and renewal plans are copied only onto the same plan.
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="mship-upload-copy"
                  checked={copy === 'benefits'}
                  disabled={busy}
                  onChange={() => changeCopy('benefits')}
                />
                <span>
                  <strong>Benefits only</strong> — the plan keeps its own name, price and settings.
                </span>
              </label>
            </fieldset>
          ) : null}

          {file && mappings.length ? (
            <ul className="mship-review__members mship-upload__rows">
              {mappings.map((m) => {
                const row = rowFor.get(m.key);
                const sourceName = file.plans?.[m.sourceIndex]?.name ?? `Plan ${m.sourceIndex + 1}`;
                const isOpen = open.has(m.key);
                const status = m.target === 'skip' ? null : row?.status;
                return (
                  <li key={m.key}>
                    <div className="mship-upload__row">
                      <button
                        type="button"
                        className="mship-upload__expand"
                        disabled={!row || m.target === 'skip'}
                        onClick={() => toggle(m.key)}
                        aria-label={isOpen ? 'Hide changes' : 'Show changes'}
                      >
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      <span className="mship-upload__source">{sourceName}</span>
                      <span className="mship-upload__arrow" aria-hidden>
                        →
                      </span>
                      {result ? (
                        <span className="mship-upload__target-name">
                          {row?.targetName ?? 'Skipped'}
                        </span>
                      ) : (
                        <select
                          className="settings-input mship-upload__target"
                          value={String(m.target)}
                          disabled={busy}
                          onChange={(e) => {
                            const v = e.target.value;
                            const target: Target = v === 'new' || v === 'skip' ? v : Number(v);
                            changeMappings(
                              mappings.map((x) => (x.key === m.key ? { ...x, target } : x))
                            );
                          }}
                        >
                          <option value="skip">Skip this plan</option>
                          <option value="new">Create as a new plan</option>
                          {sortedPlansHere.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                              {p.isArchived ? ' (archived)' : ''}
                              {p.activeMemberCount ? ` · ${p.activeMemberCount} members` : ''}
                            </option>
                          ))}
                        </select>
                      )}
                      {status ? (
                        <span className={`mship-upload__status mship-upload__status--${status}`}>
                          {STATUS_LABEL[status]}
                        </span>
                      ) : null}
                      {!result ? (
                        <span className="mship-upload__row-actions">
                          <button
                            type="button"
                            className="mship-upload__icon"
                            title="Also copy this plan onto another plan"
                            disabled={busy}
                            onClick={() => {
                              const idx = mappings.findIndex((x) => x.key === m.key);
                              const next = [...mappings];
                              next.splice(idx + 1, 0, {
                                key: mappingKey(),
                                sourceIndex: m.sourceIndex,
                                target: 'skip',
                              });
                              setMappings(next);
                            }}
                          >
                            <Plus size={14} aria-hidden />
                          </button>
                          {mappings.filter((x) => x.sourceIndex === m.sourceIndex).length > 1 ? (
                            <button
                              type="button"
                              className="mship-upload__icon"
                              title="Remove this line"
                              disabled={busy}
                              onClick={() =>
                                changeMappings(mappings.filter((x) => x.key !== m.key))
                              }
                            >
                              <X size={14} aria-hidden />
                            </button>
                          ) : null}
                        </span>
                      ) : null}
                    </div>
                    {row && m.target !== 'skip' && !isOpen ? (
                      <p className="mship-upload__summary">
                        {[
                          row.matchedBy !== 'none' && row.matchedBy !== 'chosen'
                            ? `matched by ${row.matchedBy}`
                            : null,
                          row.targetPackageId == null ? `new plan "${row.targetName}"` : null,
                          row.settingChanges.length
                            ? `${row.settingChanges.length} setting${row.settingChanges.length === 1 ? '' : 's'}`
                            : null,
                          row.benefitsAdded.length ? `${row.benefitsAdded.length} added` : null,
                          row.benefitsChanged.length
                            ? `${row.benefitsChanged.length} changed`
                            : null,
                          row.benefitsRemoved.length
                            ? `${row.benefitsRemoved.length} taken off`
                            : null,
                          row.unmatched.length ? `${row.unmatched.length} not in catalog` : null,
                          row.error && row.status !== 'blocked' ? row.error : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || 'no changes'}
                      </p>
                    ) : null}
                    {row && isOpen ? <RowDetail row={row} /> : null}
                  </li>
                );
              })}
            </ul>
          ) : null}

          {result && needsApply.length ? (
            <p className="mship-upload__next">
              Current members still have their old benefits on{' '}
              {needsApply.map((r) => r.targetName).join(', ')}. Open each plan and use{' '}
              <strong>Apply whole plan to current members</strong> when you are ready.
            </p>
          ) : null}
        </div>

        <div className="app-dialog__actions mship-review__actions">
          {result ? (
            <button
              type="button"
              className="app-dialog__btn app-dialog__btn--primary"
              onClick={close}
            >
              Done
            </button>
          ) : (
            <>
              <button type="button" className="app-dialog__btn" disabled={busy} onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="app-dialog__btn app-dialog__btn--primary"
                disabled={busy || readyCount === 0}
                onClick={() => void save()}
              >
                Save {readyCount} plan{readyCount === 1 ? '' : 's'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
