import { useEffect, useState } from 'react';
import { searchItems, type SearchableItem } from '../../api/roomLoader';
import {
  createCatalogTagalong,
  deleteCatalogTagalong,
  listCatalogTagalongs,
  updateCatalogTagalong,
  type CatalogTagalong,
  type CatalogTagalongQtyMode,
  type CatalogTagalongTaxMode,
} from '../../api/catalogTagalongs';
import './CatalogTagalongsEditor.css';

type Props = {
  practiceId: number;
  itemType: 'inventory' | 'procedure' | 'lab';
  itemId: number;
  onlineStoreEnabled?: boolean;
};

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `$${Number(n).toFixed(2)}`;
}

function searchableId(item: SearchableItem): number | null {
  const raw =
    item.itemType === 'procedure'
      ? item.procedure?.id
      : item.itemType === 'lab'
        ? item.lab?.id
        : item.inventoryItem?.id;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export default function CatalogTagalongsEditor({
  practiceId,
  itemType,
  itemId,
  onlineStoreEnabled = false,
}: Props) {
  const [rows, setRows] = useState<CatalogTagalong[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchableItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<SearchableItem | null>(null);
  const [minQty, setMinQty] = useState('1');
  const [maxQty, setMaxQty] = useState('');
  const [addQty, setAddQty] = useState('1');
  const [addQtyMode, setAddQtyMode] = useState<CatalogTagalongQtyMode>('fixed');
  const [taxMode, setTaxMode] = useState<CatalogTagalongTaxMode>('after_tax');
  const [includeInOnlineStore, setIncludeInOnlineStore] = useState(true);
  const [saving, setSaving] = useState(false);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setRows(await listCatalogTagalongs(practiceId, itemType, itemId));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load tagalongs');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [practiceId, itemType, itemId]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || picked) {
      setHits([]);
      return;
    }
    let canceled = false;
    setSearching(true);
    const t = window.setTimeout(() => {
      void searchItems({ practiceId, q, limit: 12 })
        .then((list) => {
          if (!canceled) {
            setHits(
              list.filter((r) => {
                const id = searchableId(r);
                if (id == null) return false;
                if (r.itemType !== 'inventory' && r.itemType !== 'procedure' && r.itemType !== 'lab') {
                  return false;
                }
                return !(r.itemType === itemType && id === itemId);
              })
            );
          }
        })
        .catch(() => {
          if (!canceled) setHits([]);
        })
        .finally(() => {
          if (!canceled) setSearching(false);
        });
    }, 220);
    return () => {
      canceled = true;
      window.clearTimeout(t);
    };
  }, [query, picked, practiceId, itemType, itemId]);

  async function addRule() {
    const addId = picked ? searchableId(picked) : null;
    const addItemType =
      picked?.itemType === 'procedure' || picked?.itemType === 'lab'
        ? picked.itemType
        : picked?.itemType === 'inventory'
          ? 'inventory'
          : null;
    if (!addId || !addItemType) return;
    setSaving(true);
    setError(null);
    try {
      await createCatalogTagalong(practiceId, {
        triggerItemType: itemType,
        triggerItemId: itemId,
        addItemType,
        addItemId: addId,
        minQty: Number(minQty) || 1,
        maxQty: maxQty.trim() === '' ? null : Number(maxQty),
        addQty: Number(addQty) || 1,
        addQtyMode,
        taxMode,
        includeInOnlineStore: !onlineStoreEnabled || includeInOnlineStore,
      });
      setPicked(null);
      setQuery('');
      setHits([]);
      await reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save tagalong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="catalog-tagalongs">
      <h4 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>Tagalongs</h4>
      <p className="settings-muted" style={{ marginBottom: 12, fontSize: 13 }}>
        Auto-add an existing catalog item when this one is sold. Linked inventory still
        decrements stock. Use this for manufacturer rebates, companion fees, or a syringe
        with a vaccine. Qty ranges pick which SKU applies (2-pack rebate vs 4-pack rebate).
        After tax = tax the product first, then add this line (Maine rebates). Before tax
        folds this line into the product&apos;s taxable amount.
        {onlineStoreEnabled
          ? ' Include in online store adds the same SKU when this inventory item is in a store cart.'
          : ''}
      </p>
      {error ? (
        <div className="settings-message settings-error-message" style={{ marginBottom: 8 }}>
          {error}
        </div>
      ) : null}
      {loading ? (
        <p className="settings-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="settings-muted" style={{ fontSize: 13 }}>
          No tagalongs yet.
        </p>
      ) : (
        <table className="catalog-tagalongs__table">
          <thead>
            <tr>
              <th>Adds</th>
              <th>When qty</th>
              <th>Add qty</th>
              <th>Tax</th>
              {onlineStoreEnabled ? <th>Online store</th> : null}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  {row.addItemName || `Item #${row.addItemId}`}
                  {row.addItemCode ? (
                    <div className="settings-muted">{row.addItemCode}</div>
                  ) : null}
                  <div className="settings-muted">{money(row.addItemPrice)}</div>
                </td>
                <td>
                  {row.minQty}
                  {row.maxQty == null ? '+' : row.maxQty === row.minQty ? '' : `–${row.maxQty}`}
                </td>
                <td>
                  {row.addQty}
                  {row.addQtyMode === 'match_trigger' ? ' × sold qty' : ''}
                </td>
                <td>{row.taxMode === 'before_tax' ? 'Before tax' : 'After tax'}</td>
                {onlineStoreEnabled ? (
                  <td>
                    <label className="settings-checkbox-item">
                      <input
                        type="checkbox"
                        checked={row.includeInOnlineStore !== false}
                        onChange={() => {
                          void updateCatalogTagalong(practiceId, row.id, {
                            includeInOnlineStore: row.includeInOnlineStore === false,
                          }).then(() => void reload());
                        }}
                      />
                      <span>Add in cart</span>
                    </label>
                  </td>
                ) : null}
                <td>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => {
                      void updateCatalogTagalong(practiceId, row.id, {
                        isActive: !row.isActive,
                      }).then(() => void reload());
                    }}
                  >
                    {row.isActive ? 'Disable' : 'Enable'}
                  </button>{' '}
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => {
                      void deleteCatalogTagalong(practiceId, row.id).then(() => void reload());
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="catalog-tagalongs__form">
        <label className="settings-label catalog-tagalongs__search">
          Add this catalog item
          {picked ? (
            <div>
              <strong>{picked.name}</strong>
              <button
                type="button"
                className="btn secondary"
                style={{ marginLeft: 8 }}
                onClick={() => {
                  setPicked(null);
                  setQuery('');
                }}
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <input
                className="settings-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search rebate SKU, fee, syringe…"
              />
              {searching ? <p className="settings-muted">Searching…</p> : null}
              {hits.length > 0 ? (
                <div className="inv-stock-link__results">
                  {hits.map((hit) => (
                    <button
                      key={`${hit.itemType}-${searchableId(hit)}`}
                      type="button"
                      className="inv-stock-link__result"
                      onClick={() => {
                        setPicked(hit);
                        setQuery('');
                        setHits([]);
                      }}
                    >
                      {hit.name}
                      {hit.code ? <span className="settings-muted"> · {hit.code}</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </label>
        <label className="settings-label">
          Min qty
          <input className="settings-input" value={minQty} onChange={(e) => setMinQty(e.target.value)} />
        </label>
        <label className="settings-label">
          Max qty (blank = no max)
          <input className="settings-input" value={maxQty} onChange={(e) => setMaxQty(e.target.value)} />
        </label>
        <label className="settings-label">
          How many to add
          <input className="settings-input" value={addQty} onChange={(e) => setAddQty(e.target.value)} />
        </label>
        <label className="settings-label">
          Add qty mode
          <select
            className="settings-input"
            value={addQtyMode}
            onChange={(e) => setAddQtyMode(e.target.value as CatalogTagalongQtyMode)}
          >
            <option value="fixed">Fixed (e.g. one rebate SKU)</option>
            <option value="match_trigger">Times sold qty (e.g. 1 syringe each)</option>
          </select>
        </label>
        <label className="settings-label">
          Tax timing
          <select
            className="settings-input"
            value={taxMode}
            onChange={(e) => setTaxMode(e.target.value as CatalogTagalongTaxMode)}
          >
            <option value="after_tax">After tax — product taxed in full (rebates)</option>
            <option value="before_tax">Before tax — include this line in the product&apos;s taxable amount</option>
          </select>
        </label>
        {onlineStoreEnabled ? (
          <label className="settings-checkbox-item catalog-tagalongs__store">
            <input
              type="checkbox"
              checked={includeInOnlineStore}
              onChange={(e) => setIncludeInOnlineStore(e.target.checked)}
            />
            <span>Include in online store</span>
          </label>
        ) : null}
        <div className="catalog-tagalongs__actions">
          <button
            type="button"
            className="btn primary"
            disabled={saving || !picked}
            onClick={() => void addRule()}
          >
            {saving ? 'Saving…' : 'Add tagalong'}
          </button>
        </div>
      </div>
    </div>
  );
}
