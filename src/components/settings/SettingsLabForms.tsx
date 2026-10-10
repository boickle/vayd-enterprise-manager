import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import {
  archiveLabFormTemplate,
  createLabFormTemplate,
  listLabCatalogItems,
  listLabFormTemplates,
  seedLabFormTemplates,
  updateLabFormTemplate,
  type LabCatalogItem,
  type LabFormElement,
  type LabFormMode,
  type LabFormTemplate,
} from '../../api/inHouseLabs';
import { IN_HOUSE_CATEGORY, LAB_FORM_SEEDS } from '../../utils/labFormSeeds';
import { appConfirm } from '../../utils/appDialog';
import './SettingsLabForms.css';

type Props = {
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
};

type Draft = {
  name: string;
  category: string;
  description: string;
  mode: LabFormMode;
  elements: LabFormElement[];
  labIds: number[];
  isPublished: boolean;
};

const BLANK_ELEMENT: LabFormElement = {
  key: '',
  name: '',
  valueType: 'number',
  min: null,
  max: null,
  units: null,
};

function toDraft(t: LabFormTemplate): Draft {
  return {
    name: t.name,
    category: t.category || IN_HOUSE_CATEGORY,
    description: t.description ?? '',
    mode: t.mode,
    elements: (t.elements ?? []).map((el) => ({ ...el })),
    labIds: (t.labs ?? []).map((l) => l.id),
    isPublished: t.isPublished,
  };
}

function newDraft(): Draft {
  return {
    name: '',
    category: IN_HOUSE_CATEGORY,
    description: '',
    mode: 'analytes',
    elements: [{ ...BLANK_ELEMENT }],
    labIds: [],
    isPublished: true,
  };
}

/** Empty string means "no range", which is different from zero. */
function numOrNull(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export default function SettingsLabForms({ onMessage }: Props) {
  const [templates, setTemplates] = useState<LabFormTemplate[]>([]);
  const [catalog, setCatalog] = useState<LabCatalogItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [labQuery, setLabQuery] = useState('');

  function say(msg: string, kind: 'success' | 'error') {
    onMessage?.(msg, kind);
  }

  async function load() {
    setLoading(true);
    try {
      const [rows, labs] = await Promise.all([
        listLabFormTemplates(true),
        listLabCatalogItems().catch(() => [] as LabCatalogItem[]),
      ]);
      setTemplates(rows);
      setCatalog(labs);
    } catch (err) {
      say(err instanceof Error ? err.message : 'Could not load lab forms.', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, LabFormTemplate[]>();
    for (const t of templates) {
      const key = t.category || IN_HOUSE_CATEGORY;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [templates]);

  const labMatches = useMemo(() => {
    const q = labQuery.trim().toLowerCase();
    if (!q) return [] as LabCatalogItem[];
    return catalog
      .filter((l) => l.name.toLowerCase().includes(q) || (l.code ?? '').toLowerCase().includes(q))
      .slice(0, 20);
  }, [catalog, labQuery]);

  function select(t: LabFormTemplate) {
    setSelectedId(t.id);
    setDraft(toDraft(t));
  }

  function startNew() {
    setSelectedId('new');
    setDraft(newDraft());
  }

  function patchDraft(patch: Partial<Draft>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }

  function patchElement(idx: number, patch: Partial<LabFormElement>) {
    setDraft((d) =>
      d
        ? {
            ...d,
            elements: d.elements.map((el, i) => (i === idx ? { ...el, ...patch } : el)),
          }
        : d
    );
  }

  function moveElement(idx: number, delta: number) {
    setDraft((d) => {
      if (!d) return d;
      const next = [...d.elements];
      const target = idx + delta;
      if (target < 0 || target >= next.length) return d;
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...d, elements: next };
    });
  }

  async function save() {
    if (!draft || selectedId == null) return;
    if (!draft.name.trim()) {
      say('Give the lab form a name.', 'error');
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: draft.name.trim(),
        category: draft.category.trim() || IN_HOUSE_CATEGORY,
        description: draft.description.trim() || null,
        mode: draft.mode,
        elements: draft.mode === 'summary' ? [] : draft.elements.filter((el) => el.name.trim()),
        labIds: draft.labIds,
        isPublished: draft.isPublished,
      };
      const saved =
        selectedId === 'new'
          ? await createLabFormTemplate(body)
          : await updateLabFormTemplate(selectedId, body);
      await load();
      setSelectedId(saved.id);
      setDraft(toDraft(saved));
      say(`Saved ${saved.name}.`, 'success');
    } catch (err) {
      say(err instanceof Error ? err.message : 'Could not save this form.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function archive(t: LabFormTemplate) {
    const ok = await appConfirm({
      title: `Archive ${t.name}?`,
      message:
        'Staff will no longer be able to pick this form. Results already in a chart keep their own copy and stay readable.',
      confirmLabel: 'Archive',
      danger: true,
    });
    if (!ok) return;
    try {
      await archiveLabFormTemplate(t.id);
      await load();
      if (selectedId === t.id) {
        setSelectedId(null);
        setDraft(null);
      }
      say(`Archived ${t.name}.`, 'success');
    } catch (err) {
      say(err instanceof Error ? err.message : 'Could not archive.', 'error');
    }
  }

  async function installStandard() {
    setSeeding(true);
    try {
      const res = await seedLabFormTemplates(LAB_FORM_SEEDS);
      await load();
      say(
        `Standard lab forms installed — ${res.created} added, ${res.updated} refreshed.`,
        'success'
      );
    } catch (err) {
      say(err instanceof Error ? err.message : 'Could not install the standard forms.', 'error');
    } finally {
      setSeeding(false);
    }
  }

  const selectedLabs = useMemo(
    () => catalog.filter((l) => draft?.labIds.includes(l.id)),
    [catalog, draft]
  );

  return (
    <div className="settings-card lab-forms">
      <h3 className="settings-card-title">In-house lab forms</h3>
      <p className="lab-forms__intro settings-muted">
        Forms staff fill in for tests you run yourself. Attach a form to the catalog items that use
        it, and ordering one of those tests puts a result on the in-house lab worklist so it still
        gets charted if it is run after the visit.
      </p>

      <div className="lab-forms__toolbar">
        <button type="button" className="btn" onClick={startNew}>
          <Plus size={14} aria-hidden /> New lab form
        </button>
        <button
          type="button"
          className="btn secondary"
          disabled={seeding}
          onClick={() => void installStandard()}
        >
          {seeding ? 'Installing…' : 'Install standard forms'}
        </button>
      </div>

      <div className="lab-forms__split">
        <div className="lab-forms__list-wrap">
          {loading ? (
            <p className="settings-muted">Loading…</p>
          ) : !templates.length ? (
            <p className="settings-muted">
              No lab forms yet. “Install standard forms” adds the usual in-house set.
            </p>
          ) : (
            grouped.map(([category, rows]) => (
              <div key={category} className="lab-forms__group">
                <p className="lab-forms__group-label">{category}</p>
                {rows.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`lab-forms__row${selectedId === t.id ? ' is-active' : ''}`}
                    onClick={() => select(t)}
                  >
                    <span className="lab-forms__row-name">{t.name}</span>
                    <span className="lab-forms__row-meta">
                      {t.mode === 'summary' ? 'Write-up' : `${t.elements?.length ?? 0} rows`}
                      {t.labs?.length
                        ? ` · ${t.labs.length} test${t.labs.length === 1 ? '' : 's'}`
                        : ''}
                    </span>
                    {!t.isPublished ? <span className="lab-forms__badge">Archived</span> : null}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="lab-forms__editor">
          {!draft ? (
            <p className="settings-muted lab-forms__empty-editor">
              Pick a lab form to edit, or create a new one.
            </p>
          ) : (
            <>
              <div className="lab-forms__field-row">
                <label className="lab-forms__field">
                  <span>Form name</span>
                  <input
                    className="settings-input"
                    value={draft.name}
                    placeholder="HEARTWORM 4DX PLUS"
                    onChange={(e) => patchDraft({ name: e.target.value })}
                  />
                </label>
                <label className="lab-forms__field">
                  <span>Category</span>
                  <input
                    className="settings-input"
                    value={draft.category}
                    placeholder={IN_HOUSE_CATEGORY}
                    onChange={(e) => patchDraft({ category: e.target.value })}
                  />
                </label>
              </div>

              <div className="lab-forms__field-row">
                <label className="lab-forms__field">
                  <span>Result style</span>
                  <select
                    className="settings-input"
                    value={draft.mode}
                    onChange={(e) => patchDraft({ mode: e.target.value as LabFormMode })}
                  >
                    <option value="analytes">Table of values</option>
                    <option value="summary">Written summary</option>
                  </select>
                </label>
                <label className="lab-forms__field lab-forms__field--check">
                  <input
                    type="checkbox"
                    checked={draft.isPublished}
                    onChange={(e) => patchDraft({ isPublished: e.target.checked })}
                  />
                  <span>Available to staff</span>
                </label>
              </div>

              <label className="lab-forms__field">
                <span>Internal note</span>
                <input
                  className="settings-input"
                  value={draft.description}
                  placeholder="Only staff see this."
                  onChange={(e) => patchDraft({ description: e.target.value })}
                />
              </label>

              {draft.mode === 'analytes' ? (
                <div className="lab-forms__rows">
                  <div className="lab-forms__rows-head">
                    <p className="lab-forms__section-title">Rows</p>
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() =>
                        patchDraft({ elements: [...draft.elements, { ...BLANK_ELEMENT }] })
                      }
                    >
                      <Plus size={13} aria-hidden /> Add row
                    </button>
                  </div>

                  {draft.elements.map((el, idx) => (
                    <div key={idx} className="lab-forms__element">
                      <div className="lab-forms__element-main">
                        <input
                          className="settings-input"
                          value={el.name}
                          placeholder="Analyte name"
                          aria-label={`Row ${idx + 1} name`}
                          onChange={(e) => patchElement(idx, { name: e.target.value })}
                        />
                        <select
                          className="settings-input"
                          value={el.valueType}
                          aria-label={`Row ${idx + 1} type`}
                          onChange={(e) =>
                            patchElement(idx, {
                              valueType: e.target.value as LabFormElement['valueType'],
                            })
                          }
                        >
                          <option value="number">Number</option>
                          <option value="text">Text</option>
                          <option value="select">Choices</option>
                        </select>
                      </div>

                      {el.valueType === 'number' ? (
                        <div className="lab-forms__element-range">
                          <input
                            className="settings-input"
                            value={el.min ?? ''}
                            placeholder="Min"
                            aria-label={`Row ${idx + 1} minimum`}
                            onChange={(e) => patchElement(idx, { min: numOrNull(e.target.value) })}
                          />
                          <input
                            className="settings-input"
                            value={el.max ?? ''}
                            placeholder="Max"
                            aria-label={`Row ${idx + 1} maximum`}
                            onChange={(e) => patchElement(idx, { max: numOrNull(e.target.value) })}
                          />
                          <input
                            className="settings-input"
                            value={el.units ?? ''}
                            placeholder="Units"
                            aria-label={`Row ${idx + 1} units`}
                            onChange={(e) => patchElement(idx, { units: e.target.value || null })}
                          />
                        </div>
                      ) : null}

                      {el.valueType === 'select' ? (
                        <div className="lab-forms__element-range">
                          <input
                            className="settings-input"
                            value={(el.options ?? []).join(', ')}
                            placeholder="Choices, comma separated"
                            aria-label={`Row ${idx + 1} choices`}
                            onChange={(e) =>
                              patchElement(idx, {
                                options: e.target.value
                                  .split(',')
                                  .map((s) => s.trim())
                                  .filter(Boolean),
                              })
                            }
                          />
                          <input
                            className="settings-input"
                            value={(el.abnormalOptions ?? []).join(', ')}
                            placeholder="Which choices are abnormal"
                            aria-label={`Row ${idx + 1} abnormal choices`}
                            onChange={(e) =>
                              patchElement(idx, {
                                abnormalOptions: e.target.value
                                  .split(',')
                                  .map((s) => s.trim())
                                  .filter(Boolean),
                              })
                            }
                          />
                        </div>
                      ) : null}

                      <div className="lab-forms__element-actions">
                        <button
                          type="button"
                          className="btn-link"
                          aria-label={`Move row ${idx + 1} up`}
                          disabled={idx === 0}
                          onClick={() => moveElement(idx, -1)}
                        >
                          <ArrowUp size={13} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="btn-link"
                          aria-label={`Move row ${idx + 1} down`}
                          disabled={idx === draft.elements.length - 1}
                          onClick={() => moveElement(idx, 1)}
                        >
                          <ArrowDown size={13} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="btn-link lab-forms__danger"
                          aria-label={`Remove row ${idx + 1}`}
                          onClick={() =>
                            patchDraft({
                              elements: draft.elements.filter((_, i) => i !== idx),
                            })
                          }
                        >
                          <Trash2 size={13} aria-hidden />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="settings-muted">
                  Staff write this one up free-hand, so it has no rows.
                </p>
              )}

              <div className="lab-forms__assign">
                <p className="lab-forms__section-title">Show this form for</p>
                <p className="settings-muted lab-forms__assign-hint">
                  Ordering one of these catalog tests creates a result waiting to be filled in.
                </p>

                {selectedLabs.length ? (
                  <div className="lab-forms__chips">
                    {selectedLabs.map((l) => (
                      <span key={l.id} className="lab-forms__chip">
                        {l.code ? `${l.code} — ` : ''}
                        {l.name}
                        <button
                          type="button"
                          aria-label={`Remove ${l.name}`}
                          onClick={() =>
                            patchDraft({
                              labIds: draft.labIds.filter((id) => id !== l.id),
                            })
                          }
                        >
                          <X size={12} aria-hidden />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="settings-muted">
                    Not attached to any test yet — staff can still pick it by hand.
                  </p>
                )}

                <input
                  className="settings-input"
                  value={labQuery}
                  placeholder="Search catalog tests to attach…"
                  onChange={(e) => setLabQuery(e.target.value)}
                />
                {labMatches.length ? (
                  <ul className="lab-forms__hits">
                    {labMatches.map((l) => {
                      const already = draft.labIds.includes(l.id);
                      return (
                        <li key={l.id}>
                          <button
                            type="button"
                            disabled={already}
                            onClick={() => {
                              patchDraft({ labIds: [...draft.labIds, l.id] });
                              setLabQuery('');
                            }}
                          >
                            <span>
                              {l.code ? `${l.code} — ` : ''}
                              {l.name}
                            </span>
                            {already ? <em>added</em> : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>

              <div className="lab-forms__actions">
                {selectedId !== 'new' && typeof selectedId === 'number' ? (
                  <button
                    type="button"
                    className="btn-link lab-forms__danger"
                    onClick={() => {
                      const t = templates.find((x) => x.id === selectedId);
                      if (t) void archive(t);
                    }}
                  >
                    Archive
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => {
                    setSelectedId(null);
                    setDraft(null);
                  }}
                >
                  Cancel
                </button>
                <button type="button" className="btn" disabled={saving} onClick={() => void save()}>
                  {saving ? 'Saving…' : 'Save lab form'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
