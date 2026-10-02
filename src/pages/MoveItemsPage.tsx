import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { transferBatch } from '../api/inventoryOps';
import {
  getInventoryBranchStock,
  listInventoryBranchLocations,
  listPracticeBranches,
  type InventoryBranchLocation,
  type InventoryBranchStock,
  type PracticeBranch,
} from '../api/branchInventory';
import { searchItems, type SearchResultItem } from '../api/quantityPriceBreaks';
import { loadInventoryItem, useStockItemGroups } from '../hooks/useStockItemGroups';
import StockLotPicker from '../components/inventory/StockLotPicker';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import './Settings.css';

type BatchLine = {
  inventoryItemId: number;
  name: string;
  quantity: string;
  trackLots?: boolean;
  lotId: number | null;
  lotNumber: string;
};

function stockByLocation(stock: InventoryBranchStock): Record<number, number> {
  return Object.fromEntries(
    (stock.locations ?? []).map((loc) => [
      loc.branchLocationId,
      Number(loc.quantityOnHand ?? 0),
    ])
  );
}

function locationOptionLabel(
  name: string,
  locationId: number,
  stockByLoc: Record<number, number>
): string {
  const qoh = stockByLoc[locationId];
  if (qoh === undefined) return name;
  return `${name} — ${qoh} on hand`;
}

export default function MoveItemsPage() {
  const { token } = useAuth() as { token: string | null };
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);
  const [searchParams] = useSearchParams();
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
  const [selected, setSelected] = useState<{
    id: number;
    name: string;
    trackLots?: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [fromBranchStock, setFromBranchStock] = useState<Record<number, number>>({});
  const [toBranchStock, setToBranchStock] = useState<Record<number, number>>({});
  const [lineStockByKey, setLineStockByKey] = useState<
    Record<string, Record<number, number>>
  >({});

  useEffect(() => {
    void listPracticeBranches(practiceId).then((b) => {
      const active = b.filter((x) => x.isActive !== false);
      setBranches(active);
      const fromP = Number(searchParams.get('fromOffice'));
      const toP = Number(searchParams.get('toOffice'));
      const def = active.find((x) => x.isDefault) ?? active[0];
      setFromBranchId(
        Number.isFinite(fromP) && active.some((x) => x.id === fromP) ? fromP : (def?.id ?? '')
      );
      setToBranchId(
        Number.isFinite(toP) && active.some((x) => x.id === toP) ? toP : (def?.id ?? '')
      );
    });
    const itemId = Number(searchParams.get('item'));
    const name = searchParams.get('name');
    const q = searchParams.get('qty');
    if (Number.isFinite(itemId) && itemId > 0 && name) {
      const qty = q && Number(q) > 0 ? q : '1';
      setLines([
        { inventoryItemId: itemId, name, quantity: qty, lotId: null, lotNumber: '' },
      ]);
      setQty(qty);
      void loadInventoryItem(practiceId, itemId)
        .then((inv) => {
          setLines((prev) =>
            prev.map((line) =>
              line.inventoryItemId === itemId
                ? { ...line, trackLots: inv.trackLots === true }
                : line
            )
          );
        })
        .catch(() => undefined);
    }
  }, [practiceId, searchParams]);

  useEffect(() => {
    if (fromBranchId === '') {
      setFromLocations([]);
      setFromLoc('');
      return;
    }
    void listInventoryBranchLocations(practiceId, Number(fromBranchId)).then((locs) => {
      const active = locs.filter((l) => l.isActive !== false);
      setFromLocations(active);
      const pref = Number(searchParams.get('fromLoc'));
      if (Number.isFinite(pref) && active.some((l) => l.id === pref)) {
        setFromLoc(pref);
        return;
      }
      const def = active.find((l) => l.isDefault) ?? active[0];
      setFromLoc(def ? def.id : '');
    });
  }, [practiceId, fromBranchId, searchParams]);

  useEffect(() => {
    if (toBranchId === '') {
      setToLocations([]);
      setToLoc('');
      return;
    }
    void listInventoryBranchLocations(practiceId, Number(toBranchId)).then((locs) => {
      const active = locs.filter((l) => l.isActive !== false);
      setToLocations(active);
      const pref = Number(searchParams.get('toLoc'));
      if (Number.isFinite(pref) && active.some((l) => l.id === pref)) {
        setToLoc(pref);
        return;
      }
      const def = active.find((l) => l.isDefault) ?? active[0];
      setToLoc(def ? def.id : '');
    });
  }, [practiceId, toBranchId, searchParams]);

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

  const qohDisplayItemId =
    selected?.id ?? (lines.length === 1 ? lines[0].inventoryItemId : null);
  const qohDisplayItemName =
    selected?.name ?? (lines.length === 1 ? lines[0].name : null);

  useEffect(() => {
    if (!qohDisplayItemId || fromBranchId === '') {
      setFromBranchStock({});
      if (toBranchId === '' || toBranchId === fromBranchId) setToBranchStock({});
      return;
    }
    let cancelled = false;
    void getInventoryBranchStock(practiceId, Number(fromBranchId), qohDisplayItemId)
      .then((stock) => {
        if (cancelled) return;
        const byLoc = stockByLocation(stock);
        setFromBranchStock(byLoc);
        if (toBranchId === fromBranchId) setToBranchStock(byLoc);
      })
      .catch(() => {
        if (!cancelled) {
          setFromBranchStock({});
          if (toBranchId === fromBranchId) setToBranchStock({});
        }
      });
    if (toBranchId !== '' && toBranchId !== fromBranchId) {
      void getInventoryBranchStock(practiceId, Number(toBranchId), qohDisplayItemId)
        .then((stock) => {
          if (!cancelled) setToBranchStock(stockByLocation(stock));
        })
        .catch(() => {
          if (!cancelled) setToBranchStock({});
        });
    }
    return () => {
      cancelled = true;
    };
  }, [practiceId, qohDisplayItemId, fromBranchId, toBranchId]);

  useEffect(() => {
    if (lines.length === 0 || fromBranchId === '' || toBranchId === '') {
      setLineStockByKey({});
      return;
    }
    const itemIds = [...new Set(lines.map((l) => l.inventoryItemId))];
    const branchIds = [...new Set([Number(fromBranchId), Number(toBranchId)])];
    let cancelled = false;
    void Promise.all(
      branchIds.flatMap((branchId) =>
        itemIds.map(async (itemId) => {
          const key = `${branchId}-${itemId}`;
          try {
            const stock = await getInventoryBranchStock(practiceId, branchId, itemId);
            return { key, byLoc: stockByLocation(stock) };
          } catch {
            return { key, byLoc: {} as Record<number, number> };
          }
        })
      )
    ).then((rows) => {
      if (cancelled) return;
      const next: Record<string, Record<number, number>> = {};
      for (const row of rows) next[row.key] = row.byLoc;
      setLineStockByKey(next);
    });
    return () => {
      cancelled = true;
    };
  }, [practiceId, lines, fromBranchId, toBranchId]);

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
      {
        inventoryItemId: selected.id,
        name: selected.name,
        quantity: String(quantity),
        trackLots: selected.trackLots === true,
        lotId: null,
        lotNumber: '',
      },
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
    if (lines.some((l) => l.trackLots && l.lotId == null)) {
      setError('Choose the lot for each item that tracks expiration');
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

      const movedLines = lines.map((l) => ({
        ...l,
        quantityNum: Number(l.quantity),
      }));

      await transferBatch(practiceId, Number(fromBranchId), {
        fromBranchLocationId: Number(fromLoc),
        toBranchLocationId: Number(toLoc),
        lines: movedLines.map((l) => ({
          inventoryItemId: l.inventoryItemId,
          quantity: l.quantityNum,
          inventoryLotBalanceId: l.lotId,
          lotNumber: l.lotNumber || null,
        })),
        note,
      });
      setLines([]);
      const confirmations = movedLines.map(
        (l) =>
          `Move of ${l.quantityNum} ${l.name} from ${fromLocName} to ${toLocName}.`
      );
      setToast(
        crossOffice
          ? `${confirmations.join(' ')} (${fromOfficeName} → ${toOfficeName})`
          : confirmations.join(' ')
      );
      window.setTimeout(() => setToast(null), 6000);
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
      {searchParams.get('item') && searchParams.get('fromOffice') ? (
        <p className="par-transfer-hint" style={{ marginTop: 0 }}>
          Suggested from Par Levels. Review the offices, location, and quantity, then confirm.
        </p>
      ) : null}
      {toast && (
        <div className="settings-message settings-success-message" style={{ marginBottom: 10 }}>
          {toast}
        </div>
      )}
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
                {locationOptionLabel(l.name, l.id, fromBranchStock)}
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
                {locationOptionLabel(l.name, l.id, toBranchStock)}
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

      {qohDisplayItemId && fromLoc !== '' && toLoc !== '' ? (
        <p className="settings-muted" style={{ marginTop: 8, fontSize: 13 }}>
          <strong>{qohDisplayItemName}</strong>
          {' · '}
          From{' '}
          <strong>
            {fromBranchStock[fromLoc] ?? '—'}
          </strong>{' '}
          at {fromLocations.find((l) => l.id === fromLoc)?.name ?? 'source'}
          {' → '}
          To{' '}
          <strong>
            {toBranchStock[toLoc] ?? '—'}
          </strong>{' '}
          at {toLocations.find((l) => l.id === toLoc)?.name ?? 'destination'}
        </p>
      ) : null}

      {!qohDisplayItemId ? (
        <p className="settings-muted" style={{ marginTop: 8, fontSize: 13 }}>
          Search and select an item to see quantity on hand for each location.
        </p>
      ) : null}

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
            const apply = (trackLots: boolean, name = g.label) => {
              setSelected({ id: g.stockItemId, name, trackLots });
              setResults([]);
            };
            if (g.item) {
              apply(g.item.trackLots === true, String(g.item.name ?? g.label));
              return;
            }
            void loadInventoryItem(practiceId, g.stockItemId)
              .then((inv) => apply(inv.trackLots === true, String(inv.name ?? g.label)))
              .catch(() => apply(false));
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
              display: 'grid',
              gap: 8,
              padding: '8px 0',
              borderBottom: '1px solid #e5e7eb',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>
                {l.name} × {l.quantity}
                {fromLoc !== '' && toLoc !== '' ? (
                  <span className="settings-muted" style={{ display: 'block', fontSize: 13 }}>
                    {(() => {
                      const fromKey = `${fromBranchId}-${l.inventoryItemId}`;
                      const toKey = `${toBranchId}-${l.inventoryItemId}`;
                      const fromQ = lineStockByKey[fromKey]?.[fromLoc];
                      const toQ = lineStockByKey[toKey]?.[toLoc];
                      if (fromQ === undefined && toQ === undefined) return null;
                      const fromName =
                        fromLocations.find((loc) => loc.id === fromLoc)?.name ?? 'from';
                      const toName =
                        toLocations.find((loc) => loc.id === toLoc)?.name ?? 'to';
                      return `QOH: ${fromName} ${fromQ ?? '—'} → ${toName} ${toQ ?? '—'}`;
                    })()}
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                className="btn secondary"
                onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </div>
            {l.trackLots ? (
              <StockLotPicker
                practiceId={practiceId}
                inventoryItemId={l.inventoryItemId}
                branchId={fromBranchId === '' ? null : Number(fromBranchId)}
                locationId={fromLoc === '' ? null : Number(fromLoc)}
                required
                selectedLotId={l.lotId}
                lotNumber={l.lotNumber}
                onChange={(pick) =>
                  setLines((prev) =>
                    prev.map((row, j) =>
                      j === i
                        ? { ...row, lotId: pick.lotId, lotNumber: pick.lotNumber }
                        : row
                    )
                  )
                }
              />
            ) : null}
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="btn primary"
        style={{ width: '100%', minHeight: 48, marginTop: 12 }}
        disabled={
          busy ||
          lines.length === 0 ||
          lines.some((l) => l.trackLots && l.lotId == null)
        }
        onClick={() => void submit()}
      >
        {busy ? 'Moving…' : crossOffice ? 'Confirm office move' : 'Confirm move'}
      </button>
    </div>
  );
}
