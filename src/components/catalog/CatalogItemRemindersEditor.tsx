import { useCallback, useEffect, useState } from 'react';
import {
  getInventoryItemReminders,
  listCatalogReminderDefinitions,
  putInventoryItemReminders,
  type CatalogItemReminderBundle,
  type CatalogReminderDefinition,
} from '../../api/catalogReminders';

type Props = {
  practiceId: number;
  inventoryItemId: number;
};

type CreateDraft = {
  reminderType: string;
  description: string;
  periodUnit: string;
  remindAt: string;
  dueAt: string;
  expireAt: string;
  adjustByQuantity: boolean;
};

const EMPTY_CREATE: CreateDraft = {
  reminderType: 'Wellness',
  description: '',
  periodUnit: 'Months',
  remindAt: '0',
  dueAt: '12',
  expireAt: '0',
  adjustByQuantity: false,
};

const PERIOD_UNITS = ['Hours', 'Days', 'Weeks', 'Months', 'Years'];

/** eVet links whole product families, so some items carry hundreds of clear rules. */
const CLEAR_PREVIEW_COUNT = 12;

function n(s: string, fallback = 0): number {
  const v = Number(s);
  return Number.isFinite(v) ? v : fallback;
}

export default function CatalogItemRemindersEditor({
  practiceId,
  inventoryItemId,
}: Props) {
  const [bundle, setBundle] = useState<CatalogItemReminderBundle | null>(null);
  const [definitions, setDefinitions] = useState<CatalogReminderDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateDraft>(EMPTY_CREATE);
  const [clearTagInput, setClearTagInput] = useState('');
  const [associateDefId, setAssociateDefId] = useState('');
  const [showAllClears, setShowAllClears] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, defs] = await Promise.all([
        getInventoryItemReminders(practiceId, inventoryItemId),
        listCatalogReminderDefinitions(practiceId),
      ]);
      setBundle(b);
      setDefinitions(defs.filter((d) => d.isActive !== false));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load reminders');
    } finally {
      setLoading(false);
    }
  }, [practiceId, inventoryItemId]);

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
      const saved = await putInventoryItemReminders(practiceId, inventoryItemId, {
        creates: next.creates.map((c) => ({
          definitionId: c.definitionId,
          reminderType: c.reminderType,
          description: c.description,
          periodUnit: c.periodUnit,
          remindAt: c.remindAt,
          dueAt: c.dueAt,
          expireAt: c.expireAt,
          adjustByQuantity: c.adjustByQuantity,
        })),
        clearDefinitionIds: next.clearDefinitions.map((c) => c.definitionId),
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

  async function addCreateReminder() {
    if (!bundle || !createDraft.description.trim()) {
      setError('Description is required');
      return;
    }
    await persist({
      creates: [
        ...bundle.creates,
        {
          id: 0,
          definitionId: 0,
          reminderType: createDraft.reminderType.trim() || 'Wellness',
          description: createDraft.description.trim(),
          periodUnit: createDraft.periodUnit,
          remindAt: n(createDraft.remindAt),
          dueAt: n(createDraft.dueAt, 12),
          expireAt: n(createDraft.expireAt),
          adjustByQuantity: createDraft.adjustByQuantity,
        },
      ],
      clearDefinitions: bundle.clearDefinitions,
      clearTags: bundle.clearTags,
    });
    setCreateDraft(EMPTY_CREATE);
    setAddOpen(false);
  }

  async function removeCreate(definitionId: number) {
    if (!bundle) return;
    await persist({
      creates: bundle.creates.filter((c) => c.definitionId !== definitionId),
      clearDefinitions: bundle.clearDefinitions,
      clearTags: bundle.clearTags,
    });
  }

  async function addClearDefinition() {
    if (!bundle || !associateDefId) return;
    const defId = Number(associateDefId);
    if (!Number.isFinite(defId)) return;
    if (bundle.clearDefinitions.some((c) => c.definitionId === defId)) return;
    const def = definitions.find((d) => d.id === defId);
    if (!def) return;
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
    setAssociateDefId('');
  }

  async function removeClearDefinition(definitionId: number) {
    if (!bundle) return;
    await persist({
      creates: bundle.creates,
      clearDefinitions: bundle.clearDefinitions.filter(
        (c) => c.definitionId !== definitionId
      ),
      clearTags: bundle.clearTags,
    });
  }

  async function addClearTag() {
    if (!bundle) return;
    const tag = clearTagInput.trim();
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
      </p>
      {error && (
        <div className="settings-message settings-error-message" style={{ marginBottom: 8 }}>
          {error}
        </div>
      )}
      {bundle && (
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
          <div style={{ marginBottom: 14 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                marginBottom: 8,
              }}
            >
              <strong style={{ fontSize: 13 }}>Create on administration</strong>
              <button
                type="button"
                className="btn"
                disabled={saving}
                onClick={() => setAddOpen(true)}
              >
                Add reminder
              </button>
            </div>
            {bundle.creates.length === 0 ? (
              <p className="settings-muted" style={{ fontSize: 13 }}>
                No reminders configured.
              </p>
            ) : (
              <table className="inv-catalog-table" style={{ width: '100%', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Description</th>
                    <th>Period</th>
                    <th>Remind / Due / Expire</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {bundle.creates.map((c) => (
                    <tr key={c.definitionId}>
                      <td>{c.reminderType}</td>
                      <td>{c.description}</td>
                      <td>{c.periodUnit}</td>
                      <td>
                        {c.remindAt} / {c.dueAt} / {c.expireAt}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn"
                          disabled={saving}
                          onClick={() => void removeCreate(c.definitionId)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div style={{ marginBottom: 14 }}>
            <strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
              Also clear these reminders
            </strong>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <select
                className="settings-input"
                style={{ maxWidth: 280 }}
                value={associateDefId}
                onChange={(e) => setAssociateDefId(e.target.value)}
              >
                <option value="">Select definition…</option>
                {definitions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.description} ({d.reminderType})
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn"
                disabled={saving || !associateDefId}
                onClick={() => void addClearDefinition()}
              >
                Add association
              </button>
            </div>
            {bundle.clearDefinitions.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {(showAllClears
                  ? bundle.clearDefinitions
                  : bundle.clearDefinitions.slice(0, CLEAR_PREVIEW_COUNT)
                ).map((c) => (
                  <li key={c.definitionId} style={{ marginBottom: 4 }}>
                    {c.description}{' '}
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: '2px 8px', fontSize: 12 }}
                      disabled={saving}
                      onClick={() => void removeClearDefinition(c.definitionId)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {bundle.clearDefinitions.length > CLEAR_PREVIEW_COUNT && (
              <button
                type="button"
                className="btn"
                style={{ marginTop: 8, padding: '2px 8px', fontSize: 12 }}
                onClick={() => setShowAllClears((v) => !v)}
              >
                {showAllClears
                  ? 'Show fewer'
                  : `Show all ${bundle.clearDefinitions.length}`}
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
          aria-label="Add reminder"
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
          onClick={() => setAddOpen(false)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 10,
              padding: 20,
              width: 'min(480px, 100%)',
              boxShadow: '0 12px 40px rgba(15,23,42,0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 12px', fontSize: 17 }}>Add reminder</h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 10,
                marginBottom: 12,
              }}
            >
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
                Period unit
                <select
                  className="settings-input"
                  value={createDraft.periodUnit}
                  onChange={(e) =>
                    setCreateDraft((d) => ({ ...d, periodUnit: e.target.value }))
                  }
                >
                  {PERIOD_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settings-label" style={{ gridColumn: '1 / -1' }}>
                Description
                <input
                  className="settings-input"
                  value={createDraft.description}
                  onChange={(e) =>
                    setCreateDraft((d) => ({ ...d, description: e.target.value }))
                  }
                />
              </label>
              <label className="settings-label">
                Remind at
                <input
                  className="settings-input"
                  type="number"
                  value={createDraft.remindAt}
                  onChange={(e) =>
                    setCreateDraft((d) => ({ ...d, remindAt: e.target.value }))
                  }
                />
              </label>
              <label className="settings-label">
                Due at
                <input
                  className="settings-input"
                  type="number"
                  value={createDraft.dueAt}
                  onChange={(e) =>
                    setCreateDraft((d) => ({ ...d, dueAt: e.target.value }))
                  }
                />
              </label>
              <label className="settings-label">
                Expire at
                <input
                  className="settings-input"
                  type="number"
                  value={createDraft.expireAt}
                  onChange={(e) =>
                    setCreateDraft((d) => ({ ...d, expireAt: e.target.value }))
                  }
                />
              </label>
            </div>
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
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setAddOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={saving}
                onClick={() => void addCreateReminder()}
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
