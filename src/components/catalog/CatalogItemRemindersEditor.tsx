import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, X } from 'lucide-react';
import {
  getCatalogItemReminders,
  listCatalogReminderDefinitions,
  putCatalogItemReminders,
  type CatalogItemReminderBundle,
  type CatalogReminderDefinition,
  type ReminderCatalogItemType,
} from '../../api/catalogReminders';
import { searchItems, type SearchableItem } from '../../api/roomLoader';

type Props = {
  practiceId: number;
  itemType: ReminderCatalogItemType;
  itemId: number;
  itemName: string;
};

type AssociatedCatalogItem = {
  type: ReminderCatalogItemType;
  id: number;
  name: string;
};

type CreateDraft = {
  reminderType: string;
  description: string;
  periodUnit: string;
  remindAt: string;
  dueAt: string;
  expireAt: string;
  adjustByQuantity: boolean;
  associated: AssociatedCatalogItem;
};

function emptyCreate(item: AssociatedCatalogItem): CreateDraft {
  return {
    reminderType: 'Reminder',
    description: '',
    periodUnit: 'Months',
    remindAt: '0',
    dueAt: '12',
    expireAt: '0',
    adjustByQuantity: false,
    associated: item,
  };
}

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

function selfAssociated(
  itemType: ReminderCatalogItemType,
  itemId: number,
  itemName: string,
): AssociatedCatalogItem {
  return {
    type: itemType,
    id: itemId,
    name: itemName.trim() || `Item #${itemId}`,
  };
}

const QUICK_UNITS = ['Months', 'Days'] as const;
const CUSTOM_UNITS = ['Weeks', 'Hours', 'Years'];

function isQuickUnit(unit: string): boolean {
  return unit === 'Months' || unit === 'Days';
}

/** "11 months", "1 month". */
function countWithUnit(amount: string | number, unit: string): string {
  return `${amount} ${unitWord(amount, unit)}`;
}

function unitWord(amount: string | number, unit: string): string {
  const raw = (unit || 'Months').trim() || 'Months';
  const n = Number(amount);
  const word =
    Number.isFinite(n) && n === 1 && raw.toLowerCase().endsWith('s')
      ? raw.slice(0, -1)
      : raw;
  return word.toLowerCase();
}

/** eVet links whole product families, so some items carry hundreds of clear rules. */
const CLEAR_PREVIEW_COUNT = 12;

/** Clearing matches patient reminders by description, so same-worded definitions are interchangeable. */
function normalizeDescription(s: string | null | undefined): string {
  return (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function uniqueClears(
  clears: CatalogItemReminderBundle['clearDefinitions'],
): CatalogItemReminderBundle['clearDefinitions'] {
  const seen = new Set<string>();
  return clears.filter((c) => {
    const key = normalizeDescription(c.description);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const CLEAR_SEARCH_LIMIT = 10;

function n(s: string, fallback = 0): number {
  const v = Number(s);
  return Number.isFinite(v) ? v : fallback;
}

/** Practices that never configured reminders in their PIMS get an empty bundle. */
function hasAnyRule(bundle: CatalogItemReminderBundle): boolean {
  return (
    bundle.creates.length > 0 ||
    bundle.clearDefinitions.length > 0 ||
    bundle.clearTags.length > 0
  );
}

export default function CatalogItemRemindersEditor({
  practiceId,
  itemType,
  itemId,
  itemName,
}: Props) {
  const [bundle, setBundle] = useState<CatalogItemReminderBundle | null>(null);
  const [definitions, setDefinitions] = useState<CatalogReminderDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editingDefId, setEditingDefId] = useState<number | null>(null);
  const selfItem = selfAssociated(itemType, itemId, itemName);
  const [createDraft, setCreateDraft] = useState<CreateDraft>(() =>
    emptyCreate(selfItem),
  );
  const [clearTagInput, setClearTagInput] = useState('');
  const [clearQuery, setClearQuery] = useState('');
  const [showAllClears, setShowAllClears] = useState(false);

  const uniqueDefinitions = useMemo(() => {
    const byKey = new Map<string, CatalogReminderDefinition>();
    for (const d of definitions) {
      const key = normalizeDescription(d.description);
      if (key && !byKey.has(key)) byKey.set(key, d);
    }
    return [...byKey.values()].sort((a, b) => a.description.localeCompare(b.description));
  }, [definitions]);

  const shownClears = useMemo(
    () => uniqueClears(bundle?.clearDefinitions ?? []),
    [bundle?.clearDefinitions],
  );

  const clearMatches = useMemo(() => {
    const q = normalizeDescription(clearQuery);
    if (!q) return [];
    const already = new Set(
      (bundle?.clearDefinitions ?? []).map((c) => normalizeDescription(c.description)),
    );
    return uniqueDefinitions
      .filter((d) => {
        const key = normalizeDescription(d.description);
        return key.includes(q) && !already.has(key);
      })
      .slice(0, CLEAR_SEARCH_LIMIT);
  }, [bundle?.clearDefinitions, clearQuery, uniqueDefinitions]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, defs] = await Promise.all([
        getCatalogItemReminders(practiceId, itemType, itemId),
        listCatalogReminderDefinitions(practiceId),
      ]);
      setBundle(b);
      setDefinitions(defs.filter((d) => d.isActive !== false));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load reminders');
    } finally {
      setLoading(false);
    }
  }, [practiceId, itemType, itemId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function persist(next: {
    creates: CatalogItemReminderBundle['creates'];
    clearDefinitions: CatalogItemReminderBundle['clearDefinitions'];
    clearTags: string[];
  }) {
    setSaving(true);
    setError(null);
    try {
      const saved = await putCatalogItemReminders(practiceId, itemType, itemId, {
        creates: next.creates.map((c) => ({
          definitionId: c.definitionId || undefined,
          reminderType: c.reminderType,
          description: c.description,
          periodUnit: c.periodUnit,
          remindAt: c.remindAt,
          dueAt: c.dueAt,
          expireAt: c.expireAt,
          adjustByQuantity: c.adjustByQuantity,
          associatedCatalogItemType: c.associatedCatalogItemType ?? itemType,
          associatedCatalogItemId: c.associatedCatalogItemId ?? itemId,
        })),
        clearDefinitionIds: uniqueClears(next.clearDefinitions).map((c) => c.definitionId),
        clearTags: next.clearTags,
      });
      setBundle(saved);
      const defs = await listCatalogReminderDefinitions(practiceId);
      setDefinitions(defs.filter((d) => d.isActive !== false));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save reminders');
    } finally {
      setSaving(false);
    }
  }

  function openEdit(c: CatalogItemReminderBundle['creates'][number]) {
    setCreateDraft({
      reminderType: c.reminderType,
      description: c.description,
      periodUnit: c.periodUnit,
      remindAt: String(c.remindAt ?? 0),
      dueAt: String(c.dueAt ?? 0),
      expireAt: String(c.expireAt ?? 0),
      adjustByQuantity: Boolean(c.adjustByQuantity),
      associated: associatedOf(c),
    });
    setEditingDefId(c.definitionId);
    setAddOpen(true);
  }

  function associatedOf(c: CatalogItemReminderBundle['creates'][number]): AssociatedCatalogItem {
    return {
      type: c.associatedCatalogItemType ?? itemType,
      id: c.associatedCatalogItemId ?? itemId,
      name:
        c.associatedCatalogItemName ||
        (c.associatedCatalogItemId === itemId || c.associatedCatalogItemId == null
          ? selfItem.name
          : `Item #${c.associatedCatalogItemId}`),
    };
  }

  async function saveCreateReminder() {
    if (!bundle || !createDraft.description.trim()) {
      setError('Description is required');
      return;
    }
    const row = {
      reminderType: createDraft.reminderType.trim() || 'Reminder',
      description: createDraft.description.trim(),
      periodUnit: createDraft.periodUnit,
      remindAt: n(createDraft.remindAt),
      dueAt: n(createDraft.dueAt, 12),
      expireAt: n(createDraft.expireAt),
      adjustByQuantity: createDraft.adjustByQuantity,
      associatedCatalogItemType: createDraft.associated.type,
      associatedCatalogItemId: createDraft.associated.id,
      associatedCatalogItemName: createDraft.associated.name,
    };
    await persist({
      creates:
        editingDefId != null
          ? bundle.creates.map((c) =>
              c.definitionId === editingDefId ? { ...c, ...row } : c,
            )
          : [...bundle.creates, { id: 0, definitionId: 0, ...row }],
      clearDefinitions: bundle.clearDefinitions,
      clearTags: bundle.clearTags,
    });
    setCreateDraft(emptyCreate(selfItem));
    setEditingDefId(null);
    setAddOpen(false);
  }

  function closeDialog() {
    setAddOpen(false);
    setEditingDefId(null);
  }

  async function removeCreate(definitionId: number) {
    if (!bundle) return;
    await persist({
      creates: bundle.creates.filter((c) => c.definitionId !== definitionId),
      clearDefinitions: bundle.clearDefinitions,
      clearTags: bundle.clearTags,
    });
  }

  async function addClearDefinition(def: CatalogReminderDefinition) {
    if (!bundle) return;
    const key = normalizeDescription(def.description);
    if (bundle.clearDefinitions.some((c) => normalizeDescription(c.description) === key)) {
      setClearQuery('');
      return;
    }
    await persist({
      creates: bundle.creates,
      clearDefinitions: [
        ...bundle.clearDefinitions,
        {
          id: 0,
          definitionId: def.id,
          reminderType: def.reminderType,
          description: def.description,
        },
      ],
      clearTags: bundle.clearTags,
    });
    setClearQuery('');
  }

  async function removeClearDefinition(description: string) {
    if (!bundle) return;
    const key = normalizeDescription(description);
    await persist({
      creates: bundle.creates,
      clearDefinitions: bundle.clearDefinitions.filter(
        (c) => normalizeDescription(c.description) !== key
      ),
      clearTags: bundle.clearTags,
    });
  }

  async function addClearTag() {
    if (!bundle) return;
    const tag = clearTagInput.trim().toLowerCase();
    if (!tag) return;
    if (bundle.clearTags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      setClearTagInput('');
      return;
    }
    await persist({
      creates: bundle.creates,
      clearDefinitions: bundle.clearDefinitions,
      clearTags: [...bundle.clearTags, tag],
    });
    setClearTagInput('');
  }

  async function removeClearTag(tag: string) {
    if (!bundle) return;
    await persist({
      creates: bundle.creates,
      clearDefinitions: bundle.clearDefinitions,
      clearTags: bundle.clearTags.filter((t) => t !== tag),
    });
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <h4 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>Reminders</h4>
      <p className="settings-muted" style={{ marginBottom: 12, fontSize: 13 }}>
        When this item is signed on a SOAP, create these patient reminders and clear
        associated ones (or any reminder whose description contains the tags below).
        Rules synced from eVet stay until someone edits them here.
      </p>
      {error && (
        <div className="settings-message settings-error-message" style={{ marginBottom: 8 }}>
          {error}
        </div>
      )}
      {bundle && (bundle.scoutEdited || hasAnyRule(bundle)) && (
        <p className="settings-muted" style={{ marginBottom: 12, fontSize: 12 }}>
          {bundle.scoutEdited
            ? 'Managed in Scout — the eVet sync no longer changes these rules.'
            : 'Synced from eVet. Saving any change here takes ownership, and eVet stops overwriting this item.'}
        </p>
      )}
      {loading ? (
        <p className="settings-muted">Loading reminders…</p>
      ) : !bundle ? (
        <p className="settings-muted" style={{ fontSize: 13 }}>
          Could not load reminders. Retry by reopening this item.
        </p>
      ) : (
        <>
          <div className="catalog-reminders__block">
            <div className="catalog-reminders__block-head">
              <strong className="catalog-reminders__block-title">Create on administration</strong>
              <button
                type="button"
                className="btn secondary"
                style={{ padding: '6px 12px', fontSize: 13 }}
                disabled={saving}
                onClick={() => {
                  setCreateDraft(emptyCreate(selfItem));
                  setEditingDefId(null);
                  setAddOpen(true);
                }}
              >
                Add reminder
              </button>
            </div>
            {bundle.creates.length === 0 ? (
              <p className="settings-muted catalog-reminders__empty">
                No reminders configured.
              </p>
            ) : (
              <ul className="catalog-reminders__list">
                {bundle.creates.map((c) => {
                  const associated = associatedOf(c);
                  const isSelf =
                    associated.type === selfItem.type && associated.id === selfItem.id;
                  return (
                    <li key={c.definitionId} className="catalog-reminders__card">
                      <div className="catalog-reminders__card-body">
                        <div className="catalog-reminders__card-title">
                          <span className="catalog-reminders__type">{c.reminderType}</span>
                          <span className="catalog-reminders__desc">{c.description}</span>
                        </div>
                        <dl className="catalog-reminders__meta">
                          <div>
                            <dt>Associated</dt>
                            <dd>
                              {associated.name}
                              <span className="settings-muted">
                                {isSelf ? ' (this item)' : ` · ${associated.type}`}
                              </span>
                            </dd>
                          </div>
                          <div>
                            <dt>After it&apos;s given</dt>
                            <dd>
                              <span className="catalog-reminders__timing">
                                Remind <strong>{countWithUnit(c.remindAt, c.periodUnit)}</strong>
                              </span>
                              <span className="catalog-reminders__timing">
                                Due <strong>{countWithUnit(c.dueAt, c.periodUnit)}</strong>
                              </span>
                              <span className="catalog-reminders__timing">
                                Expire <strong>{countWithUnit(c.expireAt, c.periodUnit)}</strong>
                              </span>
                            </dd>
                          </div>
                        </dl>
                      </div>
                      <div className="catalog-reminders__actions">
                        <button
                          type="button"
                          className="catalog-reminders__icon-btn"
                          disabled={saving}
                          title="Edit reminder"
                          aria-label={`Edit ${c.description}`}
                          onClick={() => openEdit(c)}
                        >
                          <Pencil size={18} strokeWidth={2} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="catalog-reminders__icon-btn catalog-reminders__icon-btn--remove"
                          disabled={saving}
                          title="Remove reminder"
                          aria-label={`Remove ${c.description}`}
                          onClick={() => void removeCreate(c.definitionId)}
                        >
                          <X size={20} strokeWidth={2} aria-hidden />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div style={{ marginBottom: 14 }}>
            <strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
              Also clear these reminders
            </strong>
            <div style={{ marginBottom: 8, maxWidth: 420 }}>
              <input
                className="settings-input"
                value={clearQuery}
                placeholder={`Search ${uniqueDefinitions.length} reminders, e.g. lepto`}
                disabled={saving}
                onChange={(e) => setClearQuery(e.target.value)}
              />
              {clearMatches.length > 0 ? (
                <div className="inv-stock-link__results">
                  {clearMatches.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className="inv-stock-link__result"
                      disabled={saving}
                      onClick={() => void addClearDefinition(d)}
                    >
                      {d.description}
                      <span className="settings-muted"> · {d.reminderType}</span>
                    </button>
                  ))}
                </div>
              ) : clearQuery.trim() ? (
                <p className="settings-muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
                  No other reminders match. Use “Also clear reminders containing” below for a
                  word match.
                </p>
              ) : null}
            </div>
            {shownClears.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {(showAllClears
                  ? shownClears
                  : shownClears.slice(0, CLEAR_PREVIEW_COUNT)
                ).map((c) => (
                  <li key={c.definitionId} style={{ marginBottom: 4 }}>
                    {c.description}{' '}
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: '2px 8px', fontSize: 12 }}
                      disabled={saving}
                      onClick={() => void removeClearDefinition(c.description)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {shownClears.length > CLEAR_PREVIEW_COUNT && (
              <button
                type="button"
                className="btn"
                style={{ marginTop: 8, padding: '2px 8px', fontSize: 12 }}
                onClick={() => setShowAllClears((v) => !v)}
              >
                {showAllClears
                  ? 'Show fewer'
                  : `Show all ${shownClears.length}`}
              </button>
            )}
          </div>

          <div>
            <strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
              Also clear reminders containing
            </strong>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <input
                className="settings-input"
                style={{ maxWidth: 220 }}
                value={clearTagInput}
                placeholder="e.g. rabies"
                onChange={(e) => setClearTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void addClearTag();
                  }
                }}
              />
              <button
                type="button"
                className="btn"
                disabled={saving || !clearTagInput.trim()}
                onClick={() => void addClearTag()}
              >
                Add tag
              </button>
            </div>
            <p className="settings-muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
              Ignores capitals, so rabies also clears reminders that say Rabies.
            </p>
            {bundle.clearTags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {bundle.clearTags.map((tag) => (
                  <span
                    key={tag}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 8px',
                      background: '#f1f5f9',
                      borderRadius: 6,
                      fontSize: 13,
                    }}
                  >
                    {tag}
                    <button
                      type="button"
                      style={{
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        padding: 0,
                        fontSize: 14,
                        lineHeight: 1,
                      }}
                      disabled={saving}
                      aria-label={`Remove ${tag}`}
                      onClick={() => void removeClearTag(tag)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {addOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={editingDefId != null ? 'Edit reminder' : 'Add reminder'}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 80,
            background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={closeDialog}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 10,
              padding: 20,
              width: 'min(560px, 100%)',
              boxShadow: '0 12px 40px rgba(15,23,42,0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 12px', fontSize: 17 }}>
              {editingDefId != null ? 'Edit reminder' : 'Add reminder'}
            </h3>
            <div style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
              <label className="settings-label">
                Type
                <input
                  className="settings-input"
                  value={createDraft.reminderType}
                  onChange={(e) =>
                    setCreateDraft((d) => ({ ...d, reminderType: e.target.value }))
                  }
                />
              </label>
              <label className="settings-label">
                Description
                <input
                  className="settings-input"
                  value={createDraft.description}
                  onChange={(e) =>
                    setCreateDraft((d) => ({ ...d, description: e.target.value }))
                  }
                />
              </label>
            </div>
            <fieldset className="catalog-reminders__timing-box">
              <legend>Timing</legend>
              <p className="settings-muted catalog-reminders__timing-lead">
                Counted from when this item is given.
              </p>
              <div className="catalog-reminders__unit-picks" role="group" aria-label="Timing unit">
                {QUICK_UNITS.map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    className={`catalog-reminders__unit-pick${
                      createDraft.periodUnit === unit ? ' is-on' : ''
                    }`}
                    onClick={() => setCreateDraft((d) => ({ ...d, periodUnit: unit }))}
                  >
                    {unit}
                  </button>
                ))}
                <button
                  type="button"
                  className={`catalog-reminders__unit-pick${
                    isQuickUnit(createDraft.periodUnit) ? '' : ' is-on'
                  }`}
                  onClick={() =>
                    setCreateDraft((d) =>
                      isQuickUnit(d.periodUnit) ? { ...d, periodUnit: 'Weeks' } : d,
                    )
                  }
                >
                  Custom
                </button>
              </div>
              {!isQuickUnit(createDraft.periodUnit) ? (
                <label className="settings-label" style={{ marginBottom: 10 }}>
                  Custom unit
                  <select
                    className="settings-input"
                    value={createDraft.periodUnit}
                    onChange={(e) =>
                      setCreateDraft((d) => ({ ...d, periodUnit: e.target.value }))
                    }
                  >
                    {[
                      ...new Set([
                        ...CUSTOM_UNITS,
                        ...(isQuickUnit(createDraft.periodUnit) ? [] : [createDraft.periodUnit]),
                      ]),
                    ].map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="catalog-reminders__offsets">
                {(
                  [
                    ['remindAt', 'Remind'],
                    ['dueAt', 'Due'],
                    ['expireAt', 'Expire'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="settings-label catalog-reminders__offset">
                    {label}
                    <span className="catalog-reminders__offset-row">
                      <input
                        className="settings-input"
                        type="number"
                        aria-label={`${label} after, in ${createDraft.periodUnit.toLowerCase()}`}
                        value={createDraft[key]}
                        onChange={(e) =>
                          setCreateDraft((d) => ({ ...d, [key]: e.target.value }))
                        }
                      />
                      <span className="catalog-reminders__offset-unit">
                        {unitWord(createDraft[key], createDraft.periodUnit)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="catalog-reminders__timing-summary">
                Remind {countWithUnit(createDraft.remindAt, createDraft.periodUnit)} after
                it&apos;s given, due at{' '}
                {countWithUnit(createDraft.dueAt, createDraft.periodUnit)}, expires at{' '}
                {countWithUnit(createDraft.expireAt, createDraft.periodUnit)}.
              </p>
            </fieldset>
            <label className="settings-checkbox-item" style={{ marginBottom: 14 }}>
              <input
                type="checkbox"
                checked={createDraft.adjustByQuantity}
                onChange={(e) =>
                  setCreateDraft((d) => ({
                    ...d,
                    adjustByQuantity: e.target.checked,
                  }))
                }
              />
              <span>Adjust by quantity</span>
            </label>
            <label className="settings-label" style={{ display: 'block', marginBottom: 14 }}>
              Associated catalog item
              <span className="settings-muted" style={{ display: 'block', fontWeight: 400, margin: '4px 0 8px' }}>
                Usually this product. Pick another when giving this item should
                remind for a different one (initial Lyme → annual Lyme).
              </span>
              <CatalogAssociatedItemPicker
                practiceId={practiceId}
                selfItem={selfItem}
                value={createDraft.associated}
                disabled={saving}
                onChange={(associated) =>
                  setCreateDraft((d) => ({ ...d, associated }))
                }
              />
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={closeDialog}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={saving}
                onClick={() => void saveCreateReminder()}
              >
                {saving ? 'Saving…' : 'Save reminder'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CatalogAssociatedItemPicker({
  practiceId,
  selfItem,
  value,
  disabled,
  onChange,
}: {
  practiceId: number;
  selfItem: AssociatedCatalogItem;
  value: AssociatedCatalogItem;
  disabled?: boolean;
  onChange: (next: AssociatedCatalogItem) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchableItem[]>([]);
  const [open, setOpen] = useState(false);
  const searchSeq = useRef(0);
  const isSelf = value.type === selfItem.type && value.id === selfItem.id;

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const seq = ++searchSeq.current;
    const timer = window.setTimeout(() => {
      void searchItems({ q, practiceId, limit: 8 })
        .then((rows) => {
          if (seq === searchSeq.current) setResults(rows);
        })
        .catch(() => {
          if (seq === searchSeq.current) setResults([]);
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, practiceId]);

  return (
    <div style={{ minWidth: 220 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span>
          {value.name}
          {isSelf ? (
            <span className="settings-muted"> (this item)</span>
          ) : (
            <span className="settings-muted"> ({value.type})</span>
          )}
        </span>
        <button
          type="button"
          className="btn"
          style={{ padding: '2px 8px', fontSize: 12 }}
          disabled={disabled}
          onClick={() => {
            setOpen((v) => !v);
            setQuery('');
            setResults([]);
          }}
        >
          {open ? 'Done' : 'Change'}
        </button>
      </div>
      {open && (
        <div style={{ marginTop: 8 }}>
          <input
            className="settings-input"
            value={query}
            placeholder="Search catalog…"
            disabled={disabled}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            className="btn"
            style={{ marginTop: 6, padding: '2px 8px', fontSize: 12 }}
            disabled={disabled || isSelf}
            onClick={() => {
              onChange(selfItem);
              setOpen(false);
              setQuery('');
            }}
          >
            Use this item
          </button>
          {results.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 0, listStyle: 'none' }}>
              {results.map((item) => {
                const id = catalogSearchId(item);
                if (id == null) return null;
                const type = item.itemType as ReminderCatalogItemType;
                return (
                  <li key={`${item.itemType}-${id}`}>
                    <button
                      type="button"
                      className="btn"
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        marginBottom: 4,
                        fontSize: 12,
                      }}
                      disabled={disabled}
                      onClick={() => {
                        onChange({ type, id, name: item.name });
                        setOpen(false);
                        setQuery('');
                      }}
                    >
                      {item.name}{' '}
                      <span className="settings-muted">({item.itemType})</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
