import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { transferBatch } from '../api/inventoryOps';
import {
  listInventoryBranchLocations,
  listPracticeBranches,
  type InventoryBranchLocation,
  type PracticeBranch,
} from '../api/branchInventory';
import { searchItems, type SearchResultItem } from '../api/quantityPriceBreaks';
import { useStockItemGroups } from '../hooks/useStockItemGroups';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import './Settings.css';

type BatchLine = { inventoryItemId: number; name: string; quantity: string };

export default function MoveItemsPage() {
  const { token } = useAuth() as { token: string | null };
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);
  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [fromBranchId, setFromBranchId] = useState<number | ''>('');
  const [toBranchId, setToBranchId] = useState<number | ''>('');
  const [fromLocations, setFromLocations] = useState<InventoryBranchLocation[]>([]);
  const [toLocations, setToLocations] = useState<InventoryBranchLocation[]>([]);
  const [fromLoc, setFromLoc] = useState<number | ''>('');
  const [toLoc, setToLoc] = useState<number | ''>('');
  const [searchQ, setSearchQ] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [lines, setLines] = useState<BatchLine[]>([]);
  const [qty, setQty] = useState('1');
  const [selected, setSelected] = useState<{ id: number; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    void listPracticeBranches(practiceId).then((b) => {
      const active = b.filter((x) => x.isActive !== false);
      setBranches(active);
      const def = active.find((x) => x.isDefault) ?? active[0];
      if (def) {
        setFromBranchId(def.id);
        setToBranchId(def.id);
      }
    });
  }, [practiceId]);

  useEffect(() => {
    if (fromBranchId === '') {
      setFromLocations([]);
      setFromLoc('');
      return;
    }
    void listInventoryBranchLocations(practiceId, Number(fromBranchId)).then((locs) => {
      const active = locs.filter((l) => l.isActive !== false);
      setFromLocations(active);
      const def = active.find((l) => l.isDefault) ?? active[0];
      setFromLoc(def ? def.id : '');
    });
  }, [practiceId, fromBranchId]);

  useEffect(() => {
    if (toBranchId === '') {
      setToLocations([]);
      setToLoc('');
      return;
    }
    void listInventoryBranchLocations(practiceId, Number(toBranchId)).then((locs) => {
      const active = locs.filter((l) => l.isActive !== false);
      setToLocations(active);
      const def = active.find((l) => l.isDefault) ?? active[0];
      setToLoc(def ? def.id : '');
    });
  }, [practiceId, toBranchId]);

  useEffect(() => {
    const q = searchQ.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const t = window.setTimeout(() => {
      void searchItems(q, practiceId, 40).then((rows) =>
        setResults(rows.filter((r) => r.itemType === 'inventory'))
      );
    }, 250);
    return () => window.clearTimeout(t);
  }, [practiceId, searchQ]);

  const searchGroups = useStockItemGroups(results, practiceId);

  const fromOfficeName =
    branches.find((b) => b.id === fromBranchId)?.name ?? 'source office';
  const toOfficeName = branches.find((b) => b.id === toBranchId)?.name ?? 'destination office';
  const crossOffice =
    fromBranchId !== '' && toBranchId !== '' && fromBranchId !== toBranchId;

  function addLine() {
    if (!selected) return;
    const quantity = Number(qty);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError('Quantity must be positive');
      return;
    }
    setLines((prev) => [
      ...prev,
      { inventoryItemId: selected.id, name: selected.name, quantity: String(quantity) },
    ]);
    setSelected(null);
    setQty('1');
    setSearchQ('');
    setResults([]);
  }

  async function submit() {
    if (fromBranchId === '' || toBranchId === '' || fromLoc === '' || toLoc === '') {
      setError('Choose from/to office and location');
      return;
    }
    if (fromLoc === toLoc) {
      setError('From and to locations must differ');
      return;
    }
    if (lines.length === 0) {
      setError('Add at least one item');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const fromLocName =
        fromLocations.find((l) => l.id === fromLoc)?.name ?? 'location';
      const toLocName = toLocations.find((l) => l.id === toLoc)?.name ?? 'location';
      const note = crossOffice
        ? `Move Items: ${fromOfficeName} (${fromLocName}) → ${toOfficeName} (${toLocName})`
        : `Move Items: ${fromLocName} → ${toLocName}`;

      await transferBatch(practiceId, Number(fromBranchId), {
        fromBranchLocationId: Number(fromLoc),
        toBranchLocationId: Number(toLoc),
        lines: lines.map((l) => ({
          inventoryItemId: l.inventoryItemId,
          quantity: Number(l.quantity),
        })),
        note,
      });
      setLines([]);
      setToast(
        crossOffice
          ? `Moved to ${toOfficeName}`
          : 'Transfer complete'
      );
      window.setTimeout(() => setToast(null), 2500);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Transfer failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-card" style={{ maxWidth: 640, margin: '0 auto', padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Move Items</h2>
      <p className="settings-muted">
        Move within an office or between offices. Your signed-in account and the time are logged
        automatically.
      </p>
      {toast && <div className="settings-message">{toast}</div>}
      {error && (
        <div className="settings-message settings-error-message" style={{ marginBottom: 10 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="settings-label">
          From office
          <select
            className="settings-input"
            value={fromBranchId}
            onChange={(e) => setFromBranchId(e.target.value ? Number(e.target.value) : '')}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-label">
          To office
          <select
            className="settings-input"
            value={toBranchId}
            onChange={(e) => setToBranchId(e.target.value ? Number(e.target.value) : '')}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-label">
          From location
          <select
            className="settings-input"
            value={fromLoc}
            onChange={(e) => setFromLoc(e.target.value ? Number(e.target.value) : '')}
          >
            {fromLocations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-label">
          To location
          <select
            className="settings-input"
            value={toLoc}
            onChange={(e) => setToLoc(e.target.value ? Number(e.target.value) : '')}
          >
            {toLocations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {crossOffice && (
        <p className="settings-muted" style={{ marginTop: 8 }}>
          Cross-office move: {fromOfficeName} → {toOfficeName}
        </p>
      )}

      <label className="settings-label" style={{ marginTop: 12 }}>
        Search stock item
        <input
          className="settings-input"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          placeholder="Stock item name"
        />
      </label>
      {searchGroups.map((g) => (
        <button
          key={g.stockItemId}
          type="button"
          className="btn secondary"
          style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 4 }}
          onClick={() => {
            setSelected({ id: g.stockItemId, name: g.label });
            setResults([]);
          }}
        >
          <span style={{ display: 'block' }}>{g.label}</span>
          {g.viaNames.length > 0 ? (
            <span style={{ display: 'block', fontSize: 12, opacity: 0.75 }}>
              Draws stock for {g.viaNames.slice(0, 2).join(', ')}
              {g.viaNames.length > 2 ? ` +${g.viaNames.length - 2} more` : ''}
            </span>
          ) : g.noStockLink ? (
            <span style={{ display: 'block', fontSize: 12, opacity: 0.75 }}>
              No stock link — draws on itself
            </span>
          ) : (
            <span style={{ display: 'block', fontSize: 12, opacity: 0.75 }}>Stock item</span>
          )}
        </button>
      ))}

      {selected && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'end', marginTop: 8 }}>
          <label className="settings-label" style={{ flex: 1 }}>
            {selected.name} — qty
            <input
              className="settings-input"
              type="number"
              min={0.01}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </label>
          <button type="button" className="btn primary" onClick={addLine}>
            Add
          </button>
        </div>
      )}

      <ul style={{ listStyle: 'none', padding: 0, marginTop: 16 }}>
        {lines.map((l, i) => (
          <li
            key={`${l.inventoryItemId}-${i}`}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '8px 0',
              borderBottom: '1px solid #e5e7eb',
            }}
          >
            <span>
              {l.name} × {l.quantity}
            </span>
            <button
              type="button"
              className="btn secondary"
              onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="btn primary"
        style={{ width: '100%', minHeight: 48, marginTop: 12 }}
        disabled={busy || lines.length === 0}
        onClick={() => void submit()}
      >
        {busy ? 'Moving…' : crossOffice ? 'Confirm office move' : 'Confirm move'}
      </button>
    </div>
  );
}
