import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import {
  getWasteAdmin,
  recordWaste,
  type DisposalMethod,
  type WasteReason,
} from '../api/inventoryOps';
import {
  listInventoryBranchLocations,
  listPracticeBranches,
  type InventoryBranchLocation,
  type PracticeBranch,
} from '../api/branchInventory';
import { searchItems, type SearchResultItem } from '../api/quantityPriceBreaks';
import { loadInventoryItem, useStockItemGroups } from '../hooks/useStockItemGroups';
import StockLotPicker from '../components/inventory/StockLotPicker';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import './Settings.css';

export default function WasteAdjustPage() {
  const { token } = useAuth() as { token: string | null };
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);
  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [branchId, setBranchId] = useState<number | ''>('');
  const [locations, setLocations] = useState<InventoryBranchLocation[]>([]);
  const [fromLoc, setFromLoc] = useState<number | ''>('');
  const [reasons, setReasons] = useState<WasteReason[]>([]);
  const [methods, setMethods] = useState<DisposalMethod[]>([]);
  const [reasonCode, setReasonCode] = useState('');
  const [disposalCode, setDisposalCode] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [item, setItem] = useState<{ id: number; name: string; trackLots?: boolean } | null>(null);
  const [qty, setQty] = useState('1');
  const [notes, setNotes] = useState('');
  const [lot, setLot] = useState('');
  const [lotId, setLotId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [b, admin] = await Promise.all([
        listPracticeBranches(practiceId),
        getWasteAdmin(practiceId),
      ]);
      setBranches(b.filter((x) => x.isActive !== false));
      const def = b.find((x) => x.isDefault) ?? b[0];
      if (def) setBranchId(def.id);
      setReasons(admin.reasons.filter((r) => r.isActive));
      setMethods(admin.methods.filter((m) => m.isActive));
      if (admin.reasons[0]) setReasonCode(admin.reasons[0].code);
    })();
  }, [practiceId]);

  useEffect(() => {
    if (branchId === '') return;
    void listInventoryBranchLocations(practiceId, Number(branchId)).then((locs) => {
      setLocations(locs);
      if (locs[0]) setFromLoc(locs[0].id);
    });
  }, [practiceId, branchId]);

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

  const selectedReason = reasons.find((r) => r.code === reasonCode);
  const needsDisposal =
    selectedReason?.requiresDisposalMethod === 'yes' ||
    (selectedReason?.requiresDisposalMethod === 'optional' && !!disposalCode);

  async function submit() {
    if (!item || branchId === '' || fromLoc === '') {
      setError('Choose item, office, and location');
      return;
    }
    const quantity = Number(qty);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError('Quantity must be positive');
      return;
    }
    if (selectedReason?.requiresDisposalMethod === 'yes' && !disposalCode) {
      setError('Disposal method is required');
      return;
    }
    if (item.trackLots && lotId == null) {
      setError('Choose the lot you are adjusting');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await recordWaste(practiceId, {
        branchId: Number(branchId),
        inventoryItemId: item.id,
        fromBranchLocationId: Number(fromLoc),
        quantity,
        reasonCode,
        disposalMethodCode: disposalCode || null,
        notes: notes.trim() || null,
        lotNumber: lot.trim() || null,
        inventoryLotBalanceId: lotId,
      });
      setToast('Adjustment recorded');
      setItem(null);
      setQty('1');
      setNotes('');
      setLot('');
      setLotId(null);
      window.setTimeout(() => setToast(null), 2500);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to record');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-card" style={{ maxWidth: 640, margin: '0 auto', padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Waste / Adjust</h2>
      {toast && <div className="settings-message">{toast}</div>}
      {error && (
        <div className="settings-message settings-error-message" style={{ marginBottom: 10 }}>
          {error}
        </div>
      )}

      <label className="settings-label">
        Item
        <input
          className="settings-input"
          value={item ? item.name : searchQ}
          onChange={(e) => {
            setItem(null);
            setSearchQ(e.target.value);
          }}
          placeholder="Search item"
        />
      </label>
      {!item &&
        searchGroups.map((g) => (
          <button
            key={g.stockItemId}
            type="button"
            className="btn secondary"
            style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 4 }}
            onClick={() => {
              const apply = (trackLots: boolean, name = g.label) => {
                setItem({ id: g.stockItemId, name, trackLots });
                setLot('');
                setLotId(null);
                setResults([]);
                setSearchQ('');
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

      <label className="settings-label">
        Office
        <select
          className="settings-input"
          value={branchId}
          onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : '')}
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>

      <label className="settings-label">
        Location
        <select
          className="settings-input"
          value={fromLoc}
          onChange={(e) => setFromLoc(e.target.value ? Number(e.target.value) : '')}
        >
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>

      <label className="settings-label">
        Qty
        <input
          className="settings-input"
          type="number"
          min={0.01}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
      </label>

      <fieldset style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
        <legend>Reason</legend>
        {reasons.map((r) => (
          <label key={r.code} className="settings-checkbox-item">
            <input
              type="radio"
              name="reason"
              checked={reasonCode === r.code}
              onChange={() => setReasonCode(r.code)}
            />
            <span>{r.label}</span>
          </label>
        ))}
      </fieldset>

      {(needsDisposal || selectedReason?.requiresDisposalMethod !== 'no') && (
        <fieldset style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginTop: 12 }}>
          <legend>Disposal method</legend>
          {methods.map((m) => (
            <label key={m.code} className="settings-checkbox-item">
              <input
                type="radio"
                name="disposal"
                checked={disposalCode === m.code}
                onChange={() => setDisposalCode(m.code)}
              />
              <span>{m.label}</span>
            </label>
          ))}
        </fieldset>
      )}

      {item ? (
        <div style={{ marginTop: 12 }}>
          <StockLotPicker
            practiceId={practiceId}
            inventoryItemId={item.id}
            branchId={branchId === '' ? null : Number(branchId)}
            locationId={fromLoc === '' ? null : Number(fromLoc)}
            required={item.trackLots === true}
            selectedLotId={lotId}
            lotNumber={lot}
            onChange={(pick) => {
              setLotId(pick.lotId);
              setLot(pick.lotNumber);
            }}
          />
        </div>
      ) : null}

      <p className="settings-muted">
        Recording this adjustment logs your signed-in account and the current time automatically.
      </p>

      <label className="settings-label">
        Notes
        <textarea
          className="settings-input"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          style={{ maxWidth: 'none', width: '100%' }}
        />
      </label>

      <button
        type="button"
        className="btn primary"
        style={{ width: '100%', minHeight: 48, marginTop: 12 }}
        disabled={busy || (item?.trackLots === true && lotId == null)}
        onClick={() => void submit()}
      >
        {busy ? 'Saving…' : 'Record adjustment'}
      </button>
    </div>
  );
}
