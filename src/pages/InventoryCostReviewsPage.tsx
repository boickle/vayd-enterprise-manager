import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { listPracticeBranches, type PracticeBranch } from '../api/branchInventory';
import {
  listCostReviews,
  resolveCostReview,
  type InventoryCostReview,
} from '../api/inventoryOps';
import InventoryItemDetailModal from '../components/inventory/InventoryItemDetailModal';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import { refreshInventoryAttention } from '../utils/useInventoryAttention';
import './Settings.css';

function money(n: number | null | undefined, digits = 4): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `$${Number(n).toFixed(digits)}`;
}

function deltaLabel(row: InventoryCostReview): string {
  if (row.costDelta == null) return 'New cost (no prior catalog cost)';
  const sign = row.costDelta > 0 ? '+' : '';
  const pct =
    row.costDeltaPct != null ? ` (${sign}${row.costDeltaPct.toFixed(1)}%)` : '';
  return `${sign}${money(row.costDelta)}${pct}`;
}

export default function InventoryCostReviewsPage() {
  const { token } = useAuth() as { token: string | null };
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);
  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [branchId, setBranchId] = useState<number | ''>('');
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState<InventoryCostReview[]>([]);
  const [busy, setBusy] = useState(false);
  const [actingId, setActingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [detailItemId, setDetailItemId] = useState<number | null>(null);
  const [detailItemName, setDetailItemName] = useState<string | null>(null);
  const [detailGuided, setDetailGuided] = useState(false);
  const [detailReview, setDetailReview] = useState<{
    row: InventoryCostReview;
    previousCost: number | null;
    newCost: number;
    previousPrice: number | null;
    suggestedPrice: number | null;
  } | null>(null);
  const [editingRowId, setEditingRowId] = useState<number | null>(null);
  const [editedAppliedCost, setEditedAppliedCost] = useState('');
  const [editedSuggestedPrice, setEditedSuggestedPrice] = useState('');

  useEffect(() => {
    void listPracticeBranches(practiceId)
      .then((list) => {
        setBranches(list.filter((b) => b.isActive !== false));
      })
      .catch(() => setError('Could not load offices'));
  }, [practiceId]);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await listCostReviews(practiceId, {
        branchId: branchId === '' ? undefined : Number(branchId),
        status,
      });
      setRows(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load cost reviews');
    } finally {
      setBusy(false);
    }
  }, [branchId, practiceId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  function cancelEdit() {
    setEditingRowId(null);
    setEditedAppliedCost('');
    setEditedSuggestedPrice('');
  }

  function beginEdit(row: InventoryCostReview) {
    setEditingRowId(row.id);
    setEditedAppliedCost(
      Number.isFinite(Number(row.receivedCostPerUnit))
        ? String(Number(row.receivedCostPerUnit))
        : ''
    );
    setEditedSuggestedPrice(
      row.suggestedPrice != null && Number.isFinite(Number(row.suggestedPrice))
        ? String(Number(row.suggestedPrice))
        : ''
    );
  }

  function reviewDraft(row: InventoryCostReview) {
    const editedCost = editingRowId === row.id ? Number(editedAppliedCost) : NaN;
    const editedPrice = editingRowId === row.id ? Number(editedSuggestedPrice) : NaN;
    const num = (v: unknown) =>
      v != null && Number.isFinite(Number(v)) ? Number(v) : null;
    return {
      row,
      previousCost: num(row.previousCost),
      newCost:
        editingRowId === row.id && editedAppliedCost.trim() !== '' && Number.isFinite(editedCost)
          ? editedCost
          : Number(row.receivedCostPerUnit),
      previousPrice: num(row.previousPrice),
      suggestedPrice:
        editingRowId === row.id && editedSuggestedPrice.trim() !== '' && Number.isFinite(editedPrice)
          ? editedPrice
          : num(row.suggestedPrice),
    };
  }

  function openItemDetail(row: InventoryCostReview, guided = false) {
    setDetailItemId(row.inventoryItemId);
    setDetailItemName(row.itemName);
    setDetailGuided(guided);
    setDetailReview(guided && row.reason === 'new_item' ? reviewDraft(row) : null);
  }

  function openCatalogReview(row: InventoryCostReview) {
    setDetailItemId(row.inventoryItemId);
    setDetailItemName(row.itemName);
    setDetailGuided(row.reason === 'new_item');
    setDetailReview(reviewDraft(row));
  }

  async function onResolve(
    row: InventoryCostReview,
    action: 'apply_catalog' | 'apply_branch' | 'dismiss',
    overrides?: { appliedCost?: number | null; suggestedPrice?: number | null }
  ) {
    setActingId(row.id);
    setError(null);
    setMessage(null);
    try {
      await resolveCostReview(practiceId, row.id, {
        action,
        ...(overrides?.appliedCost != null && Number.isFinite(overrides.appliedCost)
          ? { appliedCost: overrides.appliedCost }
          : {}),
        ...(overrides?.suggestedPrice != null && Number.isFinite(overrides.suggestedPrice)
          ? { suggestedPrice: overrides.suggestedPrice }
          : {}),
      });
      refreshInventoryAttention();
      setMessage(
        action === 'apply_catalog'
          ? `Updated practice catalog cost for ${row.itemName ?? 'item'}.`
          : action === 'apply_branch'
            ? `Set office-only cost override for ${row.itemName ?? 'item'}.`
            : `Dismissed review for ${row.itemName ?? 'item'}.`
      );
      cancelEdit();
      await load();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not resolve review';
      setError(message);
      throw new Error(message);
    } finally {
      setActingId(null);
    }
  }

  return (
    <div className="settings-card" style={{ maxWidth: 960, margin: '0 auto', padding: 16 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Cost reviews</h2>
          <p className="settings-muted" style={{ margin: '4px 0 0' }}>
            When a received invoice cost is lower than catalog cost, or an item was added while
            receiving, decide whether to update practice pricing, office-only overrides, or leave
            prices unchanged.
          </p>
        </div>
        <button className="btn secondary" type="button" disabled={busy} onClick={() => void load()}>
          Refresh
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 12,
          margin: '18px 0',
        }}
      >
        <label className="settings-label">
          Office
          <select
            className="settings-input"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">All offices</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-label">
          Status
          <select
            className="settings-input"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="pending">Pending</option>
            <option value="applied_catalog">Applied to catalog</option>
            <option value="applied_branch">Applied to office</option>
            <option value="dismissed">Dismissed</option>
            <option value="all">All</option>
          </select>
        </label>
      </div>

      {error && <div className="settings-message settings-error-message">{error}</div>}
      {message && <div className="settings-message">{message}</div>}

      {busy && rows.length === 0 ? (
        <p className="settings-muted">Loading cost reviews…</p>
      ) : rows.length === 0 ? (
        <p className="settings-muted">
          {status === 'pending'
            ? 'No pending cost differences. Receiving stock no longer changes catalog prices automatically.'
            : 'No matching cost reviews.'}
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {rows.map((row) => {
            const pending = row.status === 'pending';
            const acting = actingId === row.id;
            const editing = editingRowId === row.id;
            return (
              <article
                key={row.id}
                style={{
                  border: '1px solid var(--border, #e5e7eb)',
                  borderRadius: 10,
                  padding: 12,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  <button
                    type="button"
                    style={{
                      padding: 0,
                      border: 'none',
                      background: 'none',
                      color: 'var(--primary, #1b5e20)',
                      fontWeight: 700,
                      textAlign: 'left',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                      textUnderlineOffset: 2,
                    }}
                    onClick={() => openItemDetail(row)}
                    title="View inventory item details"
                  >
                    {row.itemName ?? `Item #${row.inventoryItemId}`}
                    {row.itemCode ? ` · ${row.itemCode}` : ''}
                  </button>
                  {row.reason === 'new_item' ? (
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: 999,
                        background: '#e0f2fe',
                        color: '#075985',
                      }}
                      title="Added while receiving a shipment. Check its cost and set a price."
                    >
                      New item
                    </span>
                  ) : null}
                  <time className="settings-muted">
                    {row.created ? new Date(row.created).toLocaleString() : ''}
                  </time>
                </div>
                <div className="settings-muted" style={{ marginTop: 4 }}>
                  {row.branchName ?? `Office #${row.branchId}`}
                  {row.invoiceNumber ? ` · Invoice ${row.invoiceNumber}` : ''}
                  {` · Qty ${row.quantity}`}
                </div>
                {row.reason === 'new_item' && pending ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      flexWrap: 'wrap',
                      marginTop: 8,
                      padding: '8px 10px',
                      borderRadius: 8,
                      background: '#f0f9ff',
                      fontSize: 13,
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 200 }}>
                      Added while receiving with only a name and cost. Next walks through the same
                      steps as adding a product.
                    </span>
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() => openItemDetail(row, true)}
                    >
                      Finish item setup
                    </button>
                  </div>
                ) : null}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                    gap: 8,
                    marginTop: 10,
                  }}
                >
                  <div>
                    <div className="settings-muted">Catalog cost</div>
                    <div>{money(row.previousCost)}</div>
                  </div>
                  <div>
                    <div className="settings-muted">Invoice cost / unit</div>
                    {editing ? (
                      <input
                        className="settings-input"
                        type="number"
                        min={0}
                        step="0.0001"
                        value={editedAppliedCost}
                        onChange={(e) => setEditedAppliedCost(e.target.value)}
                        style={{ width: 120 }}
                      />
                    ) : (
                      <div>{money(row.receivedCostPerUnit)}</div>
                    )}
                  </div>
                  <div>
                    <div className="settings-muted">Difference</div>
                    <div>{deltaLabel(row)}</div>
                  </div>
                  <div>
                    <div className="settings-muted">Catalog price → suggested</div>
                    {editing ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span>{money(row.previousPrice, 2)} →</span>
                        <input
                          className="settings-input"
                          type="number"
                          min={0}
                          step="0.01"
                          value={editedSuggestedPrice}
                          onChange={(e) => setEditedSuggestedPrice(e.target.value)}
                          style={{ width: 110 }}
                        />
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span>
                          {money(row.previousPrice, 2)} → {money(row.suggestedPrice, 2)}
                        </span>
                        {pending ? (
                          <button
                            type="button"
                            className="btn secondary"
                            style={{ padding: '2px 8px', fontSize: 12 }}
                            onClick={() => beginEdit(row)}
                          >
                            Edit
                          </button>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
                {(row.linkedItems?.length ?? 0) > 0 ? (
                  <div style={{ marginTop: 10 }}>
                    <div className="settings-muted">
                      Linked sell prices — updating the catalog also updates these
                    </div>
                    <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                      {row.linkedItems!.map((item) => (
                        <li key={item.id}>
                          {item.name}
                          {item.code ? ` · ${item.code}` : ''}
                          {` · ${item.unitsPerSale} per sale`}
                          {' · '}
                          {money(item.price, 2)} → {money(item.nextPrice, 2)}
                          <span className="settings-muted">
                            {' '}
                            (cost {money(item.cost)} → {money(item.nextCost)})
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {pending ? (
                  editing ? (
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 8,
                        marginTop: 12,
                      }}
                    >
                      <button
                        className="btn primary"
                        type="button"
                        disabled={acting}
                        onClick={() => openCatalogReview(row)}
                      >
                        Update catalog
                      </button>
                      <button
                        className="btn secondary"
                        type="button"
                        disabled={acting}
                        onClick={cancelEdit}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 8,
                        marginTop: 12,
                      }}
                    >
                      <button
                        className="btn primary"
                        type="button"
                        disabled={acting}
                        onClick={() => openCatalogReview(row)}
                        title={
                          row.reason === 'new_item'
                            ? 'Walk through the item the same way as adding a product, then save the cost'
                            : 'Open the item with the new cost and price filled in, then save'
                        }
                      >
                        Update catalog
                      </button>
                      <button
                        className="btn secondary"
                        type="button"
                        disabled={acting}
                        onClick={() => {
                          void onResolve(row, 'apply_branch').catch(() => undefined);
                        }}
                        title="Override cost/price for this office only"
                      >
                        Office only
                      </button>
                      <button
                        className="btn secondary"
                        type="button"
                        disabled={acting}
                        onClick={() => {
                          void onResolve(row, 'dismiss').catch(() => undefined);
                        }}
                        title="Keep current catalog and office pricing"
                      >
                        Keep current
                      </button>
                    </div>
                  )
                ) : (
                  <div className="settings-muted" style={{ marginTop: 10 }}>
                    Resolved: {row.status.replace(/_/g, ' ')}
                    {row.resolutionNote ? ` · ${row.resolutionNote}` : ''}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {detailItemId != null ? (
        <InventoryItemDetailModal
          practiceId={practiceId}
          inventoryItemId={detailItemId}
          title={detailItemName}
          guidedSetup={detailGuided}
          costReview={
            detailReview
              ? {
                  previousCost: detailReview.previousCost,
                  newCost: detailReview.newCost,
                  previousPrice: detailReview.previousPrice,
                  suggestedPrice: detailReview.suggestedPrice,
                  onConfirm: ({ cost, price }) =>
                    onResolve(detailReview.row, 'apply_catalog', {
                      appliedCost: cost,
                      suggestedPrice: price,
                    }),
                }
              : undefined
          }
          onClose={() => {
            setDetailItemId(null);
            setDetailItemName(null);
            setDetailGuided(false);
            setDetailReview(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
