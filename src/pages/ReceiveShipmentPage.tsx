import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import {
  addShipmentLine,
  createShipment,
  createSupplier,
  finalizeShipment,
  getShipment,
  listSuppliers,
  patchShipment,
  removeShipmentLine,
  type InventoryShipment,
  type InventoryShipmentLine,
  type InventorySupplier,
} from '../api/inventoryOps';
import {
  listInventoryBranchLocations,
  listPracticeBranches,
  type InventoryBranchLocation,
  type PracticeBranch,
} from '../api/branchInventory';
import { searchItems, type SearchResultItem } from '../api/quantityPriceBreaks';
import {
  loadInventoryItem,
  useStockItemGroups,
  type StockItemGroup,
} from '../hooks/useStockItemGroups';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import './Settings.css';

type DraftLine = InventoryShipmentLine;

export default function ReceiveShipmentPage() {
  const { token } = useAuth() as { token: string | null };
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);

  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [locations, setLocations] = useState<InventoryBranchLocation[]>([]);
  const [suppliers, setSuppliers] = useState<InventorySupplier[]>([]);
  const [branchId, setBranchId] = useState<number | ''>('');
  const [supplierId, setSupplierId] = useState<number | ''>('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [defaultLocId, setDefaultLocId] = useState<number | ''>('');
  const [shipment, setShipment] = useState<InventoryShipment | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);

  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<{
    id: number;
    name: string;
    trackLots?: boolean;
    requireExpirationOnLots?: boolean;
    cost?: string | number | null;
    /** Set when the searched code draws stock from this item. */
    viaName?: string | null;
  } | null>(null);
  const [qty, setQty] = useState('1');
  const [lot, setLot] = useState('');
  const [exp, setExp] = useState('');
  /** Invoice-friendly entry: total line cost or cost per unit. Stored as costPerUnit. */
  const [costMode, setCostMode] = useState<'total' | 'perUnit'>('total');
  const [cost, setCost] = useState('');
  const [lineLocId, setLineLocId] = useState<number | ''>('');
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const headerReady =
    branchId !== '' &&
    defaultLocId !== '' &&
    supplierId !== '' &&
    invoiceNumber.trim().length > 0;
  const canFinalize = headerReady && lines.length > 0;

  function requireHeader(): boolean {
    if (branchId === '') {
      setError('Choose destination office');
      return false;
    }
    if (defaultLocId === '') {
      setError('Choose default location');
      return false;
    }
    if (supplierId === '') {
      setError('Supplier is required');
      return false;
    }
    if (!invoiceNumber.trim()) {
      setError('Invoice / packing slip # is required');
      return false;
    }
    return true;
  }

  useEffect(() => {
    void (async () => {
      try {
        const [b, s] = await Promise.all([
          listPracticeBranches(practiceId),
          listSuppliers(practiceId),
        ]);
        setBranches(b.filter((x) => x.isActive !== false));
        setSuppliers(s.filter((x) => x.isActive !== false));
        const def = b.find((x) => x.isDefault) ?? b[0];
        if (def) setBranchId(def.id);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      }
    })();
  }, [practiceId]);

  useEffect(() => {
    if (branchId === '') {
      setLocations([]);
      return;
    }
    void (async () => {
      const locs = await listInventoryBranchLocations(practiceId, Number(branchId));
      setLocations(locs);
      const def = locs.find((l) => l.isDefault) ?? locs[0];
      if (def) {
        setDefaultLocId(def.id);
        setLineLocId(def.id);
      }
    })();
  }, [practiceId, branchId]);

  useEffect(() => {
    const q = searchQ.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    const t = window.setTimeout(() => {
      void searchItems(q, practiceId, 40)
        .then((rows) => setSearchResults(rows.filter((r) => r.itemType === 'inventory')))
        .catch(() => setSearchResults([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [practiceId, searchQ]);

  const searchGroups = useStockItemGroups(searchResults, practiceId);

  async function chooseStockItem(group: StockItemGroup) {
    if (!requireHeader()) return;
    setError(null);
    try {
      const item = group.item ?? (await loadInventoryItem(practiceId, group.stockItemId));
      setSelectedItem({
        id: item.id,
        name: String(item.name),
        trackLots: item.trackLots,
        requireExpirationOnLots: item.requireExpirationOnLots,
        cost: item.cost,
        viaName: group.viaNames[0] ?? null,
      });
      // Don't pre-fill cost — staff enter it from the invoice (total or per unit).
      setCost('');
      setCostMode('total');
      setSearchResults([]);
      setSearchQ('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load item');
    }
  }

  async function ensureDraft(): Promise<InventoryShipment> {
    if (shipment) return shipment;
    if (!requireHeader()) throw new Error('Supplier and invoice are required');
    const created = await createShipment(practiceId, {
      branchId: Number(branchId),
      supplierId: Number(supplierId),
      invoiceNumber: invoiceNumber.trim(),
      defaultToBranchLocationId: Number(defaultLocId),
    });
    setShipment(created);
    return created;
  }

  async function refreshLines(shipmentId: number) {
    const bundle = await getShipment(practiceId, shipmentId);
    setShipment(bundle.shipment);
    setLines(bundle.lines);
  }

  async function addLine() {
    if (!requireHeader()) return;
    if (!selectedItem) {
      setError('Search and select an item first');
      return;
    }
    const quantity = Number(qty);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError('Quantity received is required and must be positive');
      return;
    }
    if (!lot.trim()) {
      setError('Lot # is required');
      return;
    }
    if (!exp.trim()) {
      setError('Expiration date is required');
      return;
    }
    if (cost.trim() === '') {
      setError(costMode === 'total' ? 'Total cost is required' : 'Cost per unit is required');
      return;
    }
    const costEntered = Number(cost);
    if (!Number.isFinite(costEntered) || costEntered < 0) {
      setError('Cost must be a valid number (0 or greater)');
      return;
    }
    const costPerUnit =
      costMode === 'total' ? costEntered / quantity : costEntered;
    if (!Number.isFinite(costPerUnit)) {
      setError('Could not calculate cost per unit');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      let draft = await ensureDraft();
      draft = await patchShipment(practiceId, draft.id, {
        supplierId: Number(supplierId),
        invoiceNumber: invoiceNumber.trim(),
        defaultToBranchLocationId: Number(defaultLocId),
      });
      setShipment(draft);
      await addShipmentLine(practiceId, draft.id, {
        inventoryItemId: selectedItem.id,
        quantity,
        costPerUnit: Number(costPerUnit.toFixed(4)),
        lotNumber: lot.trim(),
        expirationDate: exp.trim(),
        toBranchLocationId:
          lineLocId === '' ? Number(defaultLocId) : Number(lineLocId),
        barcodeScanned: null,
      });
      await refreshLines(draft.id);
      setSelectedItem(null);
      setQty('1');
      setLot('');
      setExp('');
      setCost('');
      setCostMode('total');
      setToast('Added to shipment');
      window.setTimeout(() => setToast(null), 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not add line');
    } finally {
      setBusy(false);
    }
  }

  async function onAddSupplier() {
    if (!newSupplierName.trim()) return;
    setBusy(true);
    try {
      const s = await createSupplier(practiceId, { name: newSupplierName.trim() });
      setSuppliers((prev) => [...prev, s].sort((a, b) => a.name.localeCompare(b.name)));
      setSupplierId(s.id);
      setAddingSupplier(false);
      setNewSupplierName('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not add supplier');
    } finally {
      setBusy(false);
    }
  }

  async function onFinalize() {
    if (!requireHeader()) return;
    if (!shipment || lines.length === 0) {
      setError('Add at least one item before finalizing');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await patchShipment(practiceId, shipment.id, {
        supplierId: Number(supplierId),
        invoiceNumber: invoiceNumber.trim(),
        defaultToBranchLocationId: Number(defaultLocId),
      });
      await finalizeShipment(practiceId, shipment.id);
      setToast(
        'Shipment finalized — stock updated. Invoice cost differences go to Cost Reviews for manager approval.'
      );
      setShipment(null);
      setLines([]);
      setInvoiceNumber('');
      setQty('1');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Finalize failed');
    } finally {
      setBusy(false);
    }
  }

  async function onRemoveLine(lineId: number) {
    if (!shipment) return;
    await removeShipmentLine(practiceId, shipment.id, lineId);
    await refreshLines(shipment.id);
  }

  const units = lines.reduce((s, l) => s + Number(l.quantity || 0), 0);

  return (
    <div className="settings-card" style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Receive Shipment</h2>
      {toast && (
        <div className="settings-message" style={{ marginBottom: 10 }}>
          {toast}
        </div>
      )}
      {error && (
        <div className="settings-message settings-error-message" style={{ marginBottom: 10 }}>
          {error}
        </div>
      )}

      <label className="settings-label">
        Destination office *
        <select
          className="settings-input"
          value={branchId}
          onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : '')}
          disabled={!!shipment}
          required
        >
          <option value="">Select…</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>

      <label className="settings-label">
        Default location *
        <select
          className="settings-input"
          value={defaultLocId}
          onChange={(e) => {
            const v = e.target.value ? Number(e.target.value) : '';
            setDefaultLocId(v);
            setLineLocId(v);
          }}
          required
        >
          <option value="">Select…</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>

      <label className="settings-label">
        Supplier *
        <select
          className="settings-input"
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : '')}
          required
        >
          <option value="">Select…</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {!addingSupplier ? (
        <button type="button" className="btn secondary" onClick={() => setAddingSupplier(true)}>
          Add new supplier
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            className="settings-input"
            placeholder="Supplier name"
            value={newSupplierName}
            onChange={(e) => setNewSupplierName(e.target.value)}
          />
          <button type="button" className="btn primary" disabled={busy} onClick={() => void onAddSupplier()}>
            Save
          </button>
        </div>
      )}

      <label className="settings-label">
        Invoice / packing slip # *
        <input
          className="settings-input"
          value={invoiceNumber}
          onChange={(e) => setInvoiceNumber(e.target.value)}
          required
        />
      </label>

      {!headerReady && (
        <p className="settings-muted" style={{ marginTop: 8 }}>
          Complete supplier and invoice # before searching items.
        </p>
      )}

      <label className="settings-label" style={{ marginTop: 16 }}>
        Search item *
        <input
          className="settings-input"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          placeholder="Stock item name (e.g. FVRCP)"
          disabled={!headerReady}
          required
        />
        {searchGroups.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0' }}>
            {searchGroups.slice(0, 8).map((g) => (
              <li key={`stock-${g.stockItemId}`}>
                <button
                  type="button"
                  className="btn secondary"
                  style={{ width: '100%', textAlign: 'left', marginBottom: 4 }}
                  onClick={() => void chooseStockItem(g)}
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
                    <span style={{ display: 'block', fontSize: 12, opacity: 0.75 }}>
                      Stock item
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {headerReady && searchQ.trim().length >= 2 && searchGroups.length === 0 && (
          <p className="settings-muted" style={{ marginTop: 6 }}>
            No matching stock items. Linked charge codes resolve to their stock item; unlinked
            ones still appear so you can receive them or set “Draws from” in Catalog.
          </p>
        )}
      </label>

      {selectedItem && (
        <div className="settings-card" style={{ marginTop: 12, padding: 12 }}>
          <strong>{selectedItem.name}</strong>
          {selectedItem.viaName && (
            <div className="settings-muted" style={{ fontSize: 13, marginTop: 2 }}>
              Receiving into the stock item that {selectedItem.viaName} draws from.
            </div>
          )}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 8,
              marginTop: 8,
            }}
          >
            <label className="settings-label">
              Qty received *
              <input
                className="settings-input"
                type="number"
                min={0.01}
                step="any"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                required
              />
            </label>
            <label className="settings-label">
              Lot # *
              <input
                className="settings-input"
                value={lot}
                onChange={(e) => setLot(e.target.value)}
                required
              />
            </label>
            <label className="settings-label">
              Exp date *
              <input
                className="settings-input"
                type="date"
                value={exp}
                onChange={(e) => setExp(e.target.value)}
                required
              />
            </label>
            <label className="settings-label">
              Location *
              <select
                className="settings-input"
                value={lineLocId}
                onChange={(e) => setLineLocId(e.target.value ? Number(e.target.value) : '')}
                required
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div style={{ marginTop: 12 }}>
            <div className="settings-label" style={{ marginBottom: 6 }}>
              Cost * (from invoice)
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button
                type="button"
                className={`btn ${costMode === 'total' ? 'primary' : 'secondary'}`}
                onClick={() => setCostMode('total')}
              >
                Total cost
              </button>
              <button
                type="button"
                className={`btn ${costMode === 'perUnit' ? 'primary' : 'secondary'}`}
                onClick={() => setCostMode('perUnit')}
              >
                Cost / unit
              </button>
            </div>
            <label className="settings-label" style={{ maxWidth: 220 }}>
              {costMode === 'total' ? 'Total cost for this line *' : 'Cost per unit *'}
              <input
                className="settings-input"
                type="number"
                min={0}
                step="0.01"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder={costMode === 'total' ? 'e.g. invoice line total' : 'e.g. 8.35'}
                required
              />
            </label>
            {(() => {
              const q = Number(qty);
              const c = Number(cost);
              if (!Number.isFinite(q) || q <= 0 || cost.trim() === '' || !Number.isFinite(c) || c < 0) {
                return null;
              }
              if (costMode === 'total') {
                const per = c / q;
                return (
                  <p className="settings-muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
                    ≈ ${per.toFixed(4)} per unit ({q} × ${per.toFixed(4)})
                  </p>
                );
              }
              return (
                <p className="settings-muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
                  Line total ≈ ${(c * q).toFixed(2)}
                </p>
              );
            })()}
          </div>

          <button
            type="button"
            className="btn primary"
            style={{ marginTop: 10 }}
            disabled={busy || !headerReady}
            onClick={() => void addLine()}
          >
            Add to shipment
          </button>
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <h3 style={{ marginBottom: 8 }}>
          Shipment ({lines.length} items, {units} units)
        </h3>
        {lines.length === 0 ? (
          <p className="settings-muted">
            No lines yet — search and add at least one item (required).
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {lines.map((l) => (
              <li
                key={l.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 0',
                  borderBottom: '1px solid var(--border, #e5e7eb)',
                }}
              >
                <span>
                  {l.itemName ?? `Item #${l.inventoryItemId}`} × {Number(l.quantity)}
                  {l.lotNumber ? ` · Lot ${l.lotNumber}` : ''}
                  {l.expirationDate ? ` · Exp ${String(l.expirationDate).slice(0, 10)}` : ''}
                  {l.costPerUnit != null
                    ? ` · $${Number(l.costPerUnit).toFixed(4)}/unit`
                    : ''}
                </span>
                <button type="button" className="btn secondary" onClick={() => void onRemoveLine(l.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="settings-muted" style={{ marginTop: 16 }}>
        Finalizing records your signed-in account and the current time automatically.
      </p>

      <button
        type="button"
        className="btn primary"
        style={{ width: '100%', marginTop: 12, minHeight: 48 }}
        disabled={busy || !canFinalize}
        onClick={() => void onFinalize()}
      >
        {busy ? 'Working…' : 'Finalize shipment'}
      </button>
    </div>
  );
}
