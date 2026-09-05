import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, X } from 'lucide-react';
import { useAuth } from '../auth/useAuth';
import {
  getItemWithPriceBreaks,
  searchItems,
  type ItemType,
  type ItemWithPriceBreaks,
  type Lab,
  type Procedure,
  type SearchResultItem,
} from '../api/quantityPriceBreaks';
import {
  createCatalogItem,
  patchCatalogItem,
  setCatalogItemActive,
  type CatalogCoreFields,
} from '../api/catalogItems';
import { getPracticeTaxSettings, type PracticeTaxSettings } from '../api/taxes';
import {
  listCatalogCategories,
  categorySelectValue,
  type CatalogCategory,
} from '../api/catalogCategories';
import QuantityPriceBreaksEditor from '../components/catalog/QuantityPriceBreaksEditor';
import { appConfirm } from '../utils/appDialog';
import TaxLevelSelect, {
  taxLevelSelectValue,
} from '../components/catalog/TaxLevelSelect';
import CategorySelect from '../components/catalog/CategorySelect';
import './Settings.css';
import './Catalog.css';

type ManagedType = Extract<ItemType, 'lab' | 'procedure'>;
type FormState = {
  name: string;
  code: string;
  price: string;
  cost: string;
  /** Markup % (price over cost). Editable helper; price is what gets saved. */
  markup: string;
  category: string;
  taxLevelValue: number;
  serviceFee: string;
  linkedInventoryItemId: string;
  linkedInventoryItemDefaultQuantity: string;
  excludePercentageDiscount: boolean;
};

const EMPTY_FORM: FormState = {
  name: '',
  code: '',
  price: '',
  cost: '',
  markup: '',
  category: '',
  taxLevelValue: 1,
  serviceFee: '',
  linkedInventoryItemId: '',
  linkedInventoryItemDefaultQuantity: '',
  excludePercentageDiscount: false,
};

/** Markup % from cost/price, blank when cost is missing or not positive. */
function markupPctFromCostPrice(costStr: string, priceStr: string): string {
  const cost = Number(costStr);
  const price = Number(priceStr);
  if (costStr.trim() === '' || priceStr.trim() === '') return '';
  if (!Number.isFinite(cost) || cost <= 0 || !Number.isFinite(price)) return '';
  return (((price - cost) / cost) * 100).toFixed(1);
}

/** Price from cost and markup %, blank when either input is missing. */
function priceFromCostMarkup(costStr: string, markupStr: string): string {
  const cost = Number(costStr);
  const markup = Number(markupStr);
  if (costStr.trim() === '' || markupStr.trim() === '') return '';
  if (!Number.isFinite(cost) || !Number.isFinite(markup)) return '';
  return (cost * (1 + markup / 100)).toFixed(2);
}

/** Read-only markup label for the results table. */
function markupDisplay(price: unknown, cost: unknown): string {
  const c = Number(cost);
  const p = Number(price);
  if (!Number.isFinite(c) || c <= 0 || !Number.isFinite(p)) return '—';
  return `${(((p - c) / c) * 100).toFixed(1)}%`;
}

function practiceIdFromToken(token: string | null): number {
  try {
    const part = token?.split('.')[1];
    if (!part) throw new Error();
    const parsed = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    const n = Number(parsed.practiceId ?? parsed.practice_id);
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    // Use configured fallback.
  }
  return Number(import.meta.env.VITE_PRACTICE_ID) || 1;
}

function entityFor(row: SearchResultItem): Lab | Procedure | undefined {
  return row.itemType === 'lab' ? row.lab : row.procedure;
}

function numberOrNull(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formFromItem(item: Lab | Procedure): FormState {
  const procedure = item as Procedure;
  return {
    name: String(item.name ?? ''),
    code: item.code == null ? '' : String(item.code),
    price: item.price == null ? '' : String(item.price),
    cost: item.cost == null ? '' : String(item.cost),
    markup: markupPctFromCostPrice(
      item.cost == null ? '' : String(item.cost),
      item.price == null ? '' : String(item.price),
    ),
    category: categorySelectValue(item.category),
    taxLevelValue: taxLevelSelectValue(item.taxLevelValue),
    serviceFee: procedure.serviceFee == null ? '' : String(procedure.serviceFee),
    linkedInventoryItemId:
      procedure.linkedInventoryItemId == null ? '' : String(procedure.linkedInventoryItemId),
    linkedInventoryItemDefaultQuantity:
      procedure.linkedInventoryItemDefaultQuantity == null
        ? ''
        : String(procedure.linkedInventoryItemDefaultQuantity),
    excludePercentageDiscount: item.excludePercentageDiscount === true,
  };
}

function payloadFromForm(type: ManagedType, form: FormState): CatalogCoreFields {
  const common: CatalogCoreFields = {
    name: form.name.trim(),
    code: form.code.trim() || null,
    price: numberOrNull(form.price),
    cost: numberOrNull(form.cost),
    category: form.category.trim() === '' ? null : Number(form.category),
    taxLevelValue: form.taxLevelValue,
    excludePercentageDiscount: form.excludePercentageDiscount,
  };
  if (type === 'procedure') {
    common.serviceFee = numberOrNull(form.serviceFee);
    common.linkedInventoryItemId = numberOrNull(form.linkedInventoryItemId);
    common.linkedInventoryItemDefaultQuantity = numberOrNull(
      form.linkedInventoryItemDefaultQuantity
    );
  }
  return common;
}

export default function CatalogEntityPage({ itemType }: { itemType: ManagedType }) {
  const { token } = useAuth() as { token: string | null };
  const practiceId = useMemo(() => practiceIdFromToken(token), [token]);
  const plural = itemType === 'lab' ? 'Labs' : 'Procedures';
  const singular = itemType === 'lab' ? 'Lab' : 'Procedure';
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [rows, setRows] = useState<SearchResultItem[]>([]);
  const [searching, setSearching] = useState(false);
  const searchSequence = useRef(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ItemWithPriceBreaks | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [taxSettings, setTaxSettings] = useState<PracticeTaxSettings | null>(null);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getPracticeTaxSettings(practiceId).catch(() => null),
      listCatalogCategories(practiceId, itemType).catch(() => []),
    ]).then(([settings, cats]) => {
      if (cancelled) return;
      setTaxSettings(settings);
      setCategories(cats);
    });
    return () => {
      cancelled = true;
    };
  }, [practiceId, itemType]);

  const runSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) {
      setRows([]);
      return;
    }
    const sequence = ++searchSequence.current;
    setSearching(true);
    try {
      const found = await searchItems(trimmed, practiceId, 100, {
        includeInactive: showArchived,
      });
      if (sequence === searchSequence.current) {
        setRows(found.filter((row) => row.itemType === itemType));
      }
    } catch (e) {
      if (sequence === searchSequence.current) {
        setError(e instanceof Error ? e.message : `Could not search ${plural.toLowerCase()}`);
      }
    } finally {
      if (sequence === searchSequence.current) setSearching(false);
    }
  }, [itemType, plural, practiceId, query, showArchived]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void runSearch(), 300);
    return () => window.clearTimeout(timeout);
  }, [runSearch]);

  const loadDetail = useCallback(
    async (id: number) => {
      setSelectedId(id);
      setDetailLoading(true);
      setError(null);
      try {
        const loaded = await getItemWithPriceBreaks(itemType, id, practiceId);
        setDetail(loaded);
        setForm(formFromItem(loaded.item as Lab | Procedure));
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : `Could not load ${singular.toLowerCase()}`
        );
      } finally {
        setDetailLoading(false);
      }
    },
    [itemType, practiceId, singular]
  );

  async function saveItem() {
    if (!selectedId || !form.name.trim()) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await patchCatalogItem(itemType, practiceId, selectedId, payloadFromForm(itemType, form));
      setMessage(`${itemType === 'lab' ? 'Lab' : 'Procedure'} saved`);
      await loadDetail(selectedId);
      await runSearch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function createItem() {
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await createCatalogItem(
        itemType,
        practiceId,
        payloadFromForm(itemType, form)
      );
      setCreateOpen(false);
      setMessage(`${itemType === 'lab' ? 'Lab' : 'Procedure'} created`);
      setQuery(form.name.trim());
      const id = Number(created.id);
      if (Number.isFinite(id)) await loadDetail(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row: SearchResultItem) {
    const entity = entityFor(row);
    if (!entity) return;
    const active = entity.isActive !== false;
    const ok = await appConfirm({
      title: active ? 'Archive item?' : 'Restore item?',
      message: `${active ? 'Archive' : 'Restore'} “${row.name}”?`,
      confirmLabel: active ? 'Archive' : 'Restore',
      danger: active,
    });
    if (!ok) return;
    setSaving(true);
    try {
      await setCatalogItemActive(itemType, practiceId, entity.id, !active);
      setMessage(`${row.name} ${active ? 'archived' : 'restored'}`);
      await runSearch();
      if (selectedId === entity.id) await loadDetail(entity.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setError(null);
    setCreateOpen(true);
  }

  const editor = (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 12,
        }}
      >
        <Field label="Name" value={form.name} onChange={(name) => setForm({ ...form, name })} />
        <Field label="Code" value={form.code} onChange={(code) => setForm({ ...form, code })} />
        <Field
          label="Cost"
          type="number"
          value={form.cost}
          onChange={(cost) =>
            setForm((f) => {
              const price = priceFromCostMarkup(cost, f.markup);
              return { ...f, cost, price: price !== '' ? price : f.price };
            })
          }
        />
        <Field
          label="Markup %"
          type="number"
          value={form.markup}
          onChange={(markup) =>
            setForm((f) => {
              const price = priceFromCostMarkup(f.cost, markup);
              return { ...f, markup, price: price !== '' ? price : f.price };
            })
          }
        />
        <Field
          label="Price"
          type="number"
          value={form.price}
          onChange={(price) =>
            setForm((f) => ({
              ...f,
              price,
              markup: markupPctFromCostPrice(f.cost, price),
            }))
          }
        />
        <CategorySelect
          categories={categories}
          value={form.category}
          onChange={(category) => setForm({ ...form, category })}
        />
        <TaxLevelSelect
          settings={taxSettings}
          value={form.taxLevelValue}
          onChange={(taxLevelValue) => setForm({ ...form, taxLevelValue })}
        />
        {itemType === 'procedure' && (
          <>
            <Field
              label="Service fee"
              type="number"
              value={form.serviceFee}
              onChange={(serviceFee) => setForm({ ...form, serviceFee })}
            />
            <Field
              label="Linked inventory item ID"
              type="number"
              value={form.linkedInventoryItemId}
              onChange={(linkedInventoryItemId) =>
                setForm({ ...form, linkedInventoryItemId })
              }
            />
            <Field
              label="Stock units consumed"
              type="number"
              value={form.linkedInventoryItemDefaultQuantity}
              onChange={(linkedInventoryItemDefaultQuantity) =>
                setForm({ ...form, linkedInventoryItemDefaultQuantity })
              }
            />
          </>
        )}
      </div>
      <label className="settings-checkbox-item" style={{ marginTop: 12 }}>
        <input
          type="checkbox"
          checked={form.excludePercentageDiscount}
          onChange={(event) =>
            setForm({ ...form, excludePercentageDiscount: event.target.checked })
          }
        />
        <span>Exclude percentage discounts</span>
      </label>
    </>
  );

  return (
    <div>
      <p className="settings-section-description">
        Add, edit, archive, and configure tiered pricing for {plural.toLowerCase()}.
      </p>
      {error && <div className="settings-message settings-error-message">{error}</div>}
      {message && (
        <div className="settings-message settings-success-message">
          {message}
          <button className="settings-close" onClick={() => setMessage(null)}>
            ×
          </button>
        </div>
      )}
      <div className="settings-card">
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <label className="settings-label" style={{ flex: '1 1 320px' }}>
            Search {plural.toLowerCase()}
            <input
              className="settings-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${plural.toLowerCase()} by name…`}
            />
          </label>
          <label className="settings-checkbox-item" style={{ marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            <span>Show archived</span>
          </label>
          <button className="btn primary" type="button" onClick={openCreate}>
            Add {singular}
          </button>
        </div>
        {searching && <p className="settings-muted">Searching…</p>}
        {!searching && query.trim() && rows.length === 0 && (
          <p className="settings-muted">No matches.</p>
        )}
        {rows.length > 0 && (
          <div className="settings-table-container" style={{ marginTop: 16 }}>
            <table className="settings-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Code</th>
                  <th>Price</th>
                  <th>Cost</th>
                  <th>Markup</th>
                  {itemType === 'procedure' && <th>Service fee</th>}
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const entity = entityFor(row);
                  if (!entity) return null;
                  return (
                    <tr key={entity.id}>
                      <td>{entity.name}</td>
                      <td>{entity.code || '—'}</td>
                      <td>${Number(entity.price || 0).toFixed(2)}</td>
                      <td>${Number(entity.cost || 0).toFixed(2)}</td>
                      <td>{markupDisplay(entity.price, entity.cost)}</td>
                      {itemType === 'procedure' && (
                        <td>${Number((entity as Procedure).serviceFee || 0).toFixed(2)}</td>
                      )}
                      <td>{entity.isActive === false ? 'Archived' : 'Active'}</td>
                      <td>
                        <div className="settings-action-buttons">
                          <button
                            className="btn secondary"
                            type="button"
                            onClick={() => void loadDetail(entity.id)}
                          >
                            <Pencil size={14} /> Edit
                          </button>
                          <button
                            className="btn secondary"
                            type="button"
                            disabled={saving}
                            onClick={() => void toggleActive(row)}
                          >
                            {entity.isActive === false ? 'Restore' : 'Archive'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedId && (
        <div className="settings-modal-overlay" role="dialog" aria-modal="true">
          <div className="settings-modal settings-modal-wide">
            <div className="settings-modal-header">
              <h3>Edit {singular}</h3>
              <button className="settings-modal-close" onClick={() => setSelectedId(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="settings-modal-body">
              {detailLoading ? <p className="settings-muted">Loading…</p> : editor}
              {detail && !detailLoading && (
                <div style={{ marginTop: 24 }}>
                  <QuantityPriceBreaksEditor
                    itemType={itemType}
                    itemId={selectedId}
                    practiceId={practiceId}
                    item={detail.item}
                    priceBreaks={detail.priceBreaks}
                    onChanged={() => loadDetail(selectedId)}
                  />
                </div>
              )}
            </div>
            <div className="settings-modal-actions">
              <button className="btn secondary" onClick={() => setSelectedId(null)}>
                Cancel
              </button>
              <button className="btn primary" disabled={saving} onClick={() => void saveItem()}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {createOpen && (
        <div className="settings-modal-overlay" role="dialog" aria-modal="true">
          <div className="settings-modal">
            <div className="settings-modal-header">
              <h3>Add {singular}</h3>
              <button className="settings-modal-close" onClick={() => setCreateOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="settings-modal-body">{editor}</div>
            <div className="settings-modal-actions">
              <button className="btn secondary" onClick={() => setCreateOpen(false)}>
                Cancel
              </button>
              <button className="btn primary" disabled={saving} onClick={() => void createItem()}>
                {saving ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'number';
}) {
  return (
    <label className="settings-label">
      {label}
      <input
        className="settings-input"
        type={type}
        min={type === 'number' ? 0 : undefined}
        step={type === 'number' ? '0.01' : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
