import { useEffect, useState } from 'react';
import { searchItems } from '../../api/roomLoader';
import { createOfficeSupplyOrder } from '../../api/inventoryOps';

type CatalogPick = { id: number; name: string; code: string | null };

type OfficeOption = { id: number; name: string };

type Props = {
  open: boolean;
  practiceId: number;
  offices: OfficeOption[];
  initialBranchId: number;
  onClose: () => void;
  onAdded: (branchId: number, label: string) => void;
};

export default function AddOfficeSupplyOrderModal({
  open,
  practiceId,
  offices,
  initialBranchId,
  onClose,
  onAdded,
}: Props) {
  const [branchId, setBranchId] = useState(initialBranchId);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<CatalogPick | null>(null);
  const [matches, setMatches] = useState<CatalogPick[]>([]);
  const [searching, setSearching] = useState(false);
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBranchId(initialBranchId);
    setQuery('');
    setPicked(null);
    setMatches([]);
    setQuantity('1');
    setNote('');
    setError(null);
  }, [open, initialBranchId]);

  useEffect(() => {
    if (!open || picked || query.trim().length < 2) {
      setMatches([]);
      return;
    }
    const q = query.trim();
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void searchItems({ q, practiceId, limit: 12 })
        .then((rows) => {
          if (cancelled) return;
          const next: CatalogPick[] = [];
          for (const row of rows) {
            if (row.itemType !== 'inventory') continue;
            const id = Number(row.inventoryItem?.id);
            if (!Number.isFinite(id)) continue;
            next.push({
              id,
              name: row.name,
              code: row.code ?? row.inventoryItem?.code ?? null,
            });
          }
          setMatches(next);
        })
        .catch(() => {
          if (!cancelled) setMatches([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, picked, query, practiceId]);

  if (!open) return null;

  async function save() {
    const label = (picked?.name ?? query).trim();
    if (!label) {
      setError('Search the catalog or type what to order');
      return;
    }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Quantity must be greater than 0');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createOfficeSupplyOrder(practiceId, {
        branchId,
        label,
        inventoryItemId: picked?.id ?? null,
        quantity: qty,
        note: note.trim() || null,
      });
      onAdded(branchId, label);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not add to the order list');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-modal-overlay" onClick={onClose} role="presentation">
      <div
        className="settings-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-office-order-title"
      >
        <div className="settings-modal-header">
          <h3 id="add-office-order-title">Add to order list</h3>
          <button type="button" className="settings-modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="settings-modal-body">
          <p style={{ marginTop: 0 }}>
            Search the catalog, or type something that is not in inventory — paper towels, for
            example. This is saved for the office only. It does not change on-hand counts.
          </p>
          {error ? (
            <div className="settings-message settings-error-message" style={{ marginBottom: 10 }}>
              {error}
            </div>
          ) : null}
          <label className="settings-label">
            Office
            <select
              className="settings-input"
              value={branchId}
              onChange={(e) => setBranchId(Number(e.target.value))}
            >
              {offices.map((office) => (
                <option key={office.id} value={office.id}>
                  {office.name}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-label" style={{ marginTop: 10 }}>
            Item
            <input
              className="settings-input"
              value={query}
              placeholder="Search inventory or type Paper towels"
              onChange={(e) => {
                const next = e.target.value;
                setQuery(next);
                if (picked && next.trim() !== picked.name) setPicked(null);
              }}
              autoFocus
            />
          </label>
          {picked ? (
            <p className="settings-muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
              Catalog item{picked.code ? ` · ${picked.code}` : ''}
            </p>
          ) : query.trim() ? (
            <p className="settings-muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
              {searching
                ? 'Searching catalog…'
                : 'Not picked from the catalog — saved as an unlisted item.'}
            </p>
          ) : null}
          {!picked && matches.length > 0 ? (
            <ul
              style={{
                listStyle: 'none',
                margin: '8px 0 0',
                padding: 0,
                border: '1px solid var(--border, #e5e7eb)',
                borderRadius: 8,
                maxHeight: 180,
                overflow: 'auto',
              }}
            >
              {matches.map((match) => (
                <li key={match.id}>
                  <button
                    type="button"
                    className="btn secondary"
                    style={{ width: '100%', textAlign: 'left', borderRadius: 0 }}
                    onClick={() => {
                      setPicked(match);
                      setQuery(match.name);
                      setMatches([]);
                    }}
                  >
                    {match.name}
                    {match.code ? <span className="settings-muted"> · {match.code}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <label className="settings-label" style={{ marginTop: 10 }}>
            Quantity
            <input
              className="settings-input"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              style={{ maxWidth: 120 }}
            />
          </label>
          <label className="settings-label" style={{ marginTop: 10 }}>
            Note
            <input
              className="settings-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional"
            />
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>
              {busy ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
