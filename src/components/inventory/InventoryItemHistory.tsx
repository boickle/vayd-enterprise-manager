import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listInventoryItemHistory,
  type InventoryItemHistoryKind,
  type InventoryItemHistoryRow,
} from '../../api/branchInventory';
import { INVENTORY_MOVEMENT_LABELS } from '../../utils/inventoryMovementLabels';

const PAGE_SIZE = 50;

const MONEY_FIELDS = new Set([
  'price',
  'cost',
  'serviceFee',
  'minimumPrice',
  'staffCharge',
  'onlineStorePrice',
  'branch_price',
  'branch_cost',
  'branch_serviceFee',
  'branch_minimumPrice',
]);

const SOURCE_NOTES: Record<string, string> = {
  bulk_price: 'Bulk price change',
  shipment: 'Received shipment',
  cost_review: 'Cost review',
  online_store: 'Online store settings',
  migration: 'Automatic update',
};

function showValue(field: string, value: string | null): string {
  if (value == null) return '(blank)';
  if (MONEY_FIELDS.has(field) && /^-?\d+(\.\d+)?$/.test(value)) {
    return `$${Number(value).toFixed(2)}`;
  }
  return value.length > 120 ? `${value.slice(0, 117)}…` : value;
}

function describe(row: InventoryItemHistoryRow): { what: string; detail: string } {
  if (row.kind === 'movement') {
    const where = [row.fromLocation, row.toLocation].filter(Boolean).join(' → ');
    return {
      what: INVENTORY_MOVEMENT_LABELS[row.movementType] ?? row.movementType,
      detail: [
        `${row.quantity}`,
        where,
        row.lotNumber ? `Lot ${row.lotNumber}` : '',
        row.note ?? '',
      ]
        .filter(Boolean)
        .join(' · '),
    };
  }
  if (row.source === 'created' || row.field === 'photo') {
    return { what: row.label, detail: SOURCE_NOTES[row.source] ?? '' };
  }
  const change = `${showValue(row.field, row.oldValue)} → ${showValue(row.field, row.newValue)}`;
  const note = SOURCE_NOTES[row.source];
  return { what: row.label, detail: note ? `${change} · ${note}` : change };
}

export default function InventoryItemHistory({
  practiceId,
  inventoryItemId,
  branches,
}: {
  practiceId: number;
  inventoryItemId: number;
  branches: Array<{ id: number; name: string }>;
}) {
  const [kind, setKind] = useState<InventoryItemHistoryKind>('all');
  const [branchId, setBranchId] = useState<number | ''>('');
  const [rows, setRows] = useState<InventoryItemHistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(
    async (offset: number) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      setError(null);
      try {
        const res = await listInventoryItemHistory(practiceId, inventoryItemId, {
          kind,
          branchId: branchId === '' ? undefined : branchId,
          limit: PAGE_SIZE,
          offset,
        });
        if (seq !== requestSeq.current) return;
        setTotal(res.total);
        setRows((prev) => (offset === 0 ? res.rows : [...prev, ...res.rows]));
      } catch (e: unknown) {
        if (seq !== requestSeq.current) return;
        setError(e instanceof Error ? e.message : 'Could not load history');
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [practiceId, inventoryItemId, kind, branchId]
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  return (
    <div style={{ marginBottom: 20 }}>
      <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>History</h3>
      <p className="settings-muted" style={{ margin: '0 0 12px' }}>
        Stock received, used, moved, and adjusted at every branch, plus changes people made to this
        item. Changes are recorded from Oct 22, 2026 on; earlier edits were not tracked.
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <label className="settings-label" style={{ margin: 0 }}>
          Show
          <select
            className="settings-input"
            value={kind}
            onChange={(e) => setKind(e.target.value as InventoryItemHistoryKind)}
          >
            <option value="all">Everything</option>
            <option value="movements">Stock movements</option>
            <option value="changes">Changes to the item</option>
          </select>
        </label>
        <label className="settings-label" style={{ margin: 0 }}>
          Branch
          <select
            className="settings-input"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? <p className="settings-error">{error}</p> : null}
      {loading && rows.length === 0 ? (
        <p className="settings-muted">Loading history…</p>
      ) : rows.length === 0 && !error ? (
        <p className="settings-muted">Nothing recorded for this item yet.</p>
      ) : rows.length ? (
        <>
          <div className="settings-table-container">
            <table className="settings-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>What</th>
                  <th>Detail</th>
                  <th>Branch</th>
                  <th>Who</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const { what, detail } = describe(row);
                  return (
                    <tr key={row.id}>
                      <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                        {new Date(row.at).toLocaleString()}
                      </td>
                      <td style={{ fontSize: 13 }}>{what}</td>
                      <td style={{ fontSize: 12, maxWidth: 320 }} title={detail}>
                        {detail || '—'}
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {row.branchName ?? (row.kind === 'change' ? 'All branches' : '—')}
                      </td>
                      <td style={{ fontSize: 12 }}>{row.who ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length < total ? (
            <button
              type="button"
              className="btn secondary"
              style={{ marginTop: 10 }}
              disabled={loading}
              onClick={() => void load(rows.length)}
            >
              {loading ? 'Loading…' : `Load more (${rows.length} of ${total})`}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
