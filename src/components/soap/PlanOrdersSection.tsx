import { useEffect, useRef, useState } from 'react';
import { Check, Pill, Search, Trash2, X } from 'lucide-react';
import {
  createOrder,
  deleteOrder,
  setOrderState,
  type EncounterOrder,
  type EncounterOrderCatalogType,
  type EncounterOrderKind,
} from '../../api/visitWorkflow';
import { searchItems, type SearchableItem } from '../../api/roomLoader';

type Props = {
  encounterId: string;
  orders: EncounterOrder[];
  disabled?: boolean;
  patientId?: number;
  clientId?: number;
  practiceId: number;
  onChange: (orders: EncounterOrder[]) => void;
  /** Called after any order mutation so the invoice can be refreshed. */
  onInvoiceShouldRefresh: () => void;
};

function money(n: number): string {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

/** Catalog type → order kind. Inventory medications produce med labels. */
function kindForItem(item: SearchableItem): EncounterOrderKind {
  if (item.itemType === 'lab') return 'diagnostic';
  if (item.itemType === 'procedure') return 'treatment';
  if (item.itemType === 'inventory') {
    return item.inventoryItem?.isMedication ? 'med' : 'treatment';
  }
  return 'treatment';
}

function catalogIdForItem(item: SearchableItem): number | undefined {
  const raw =
    item.itemType === 'lab'
      ? item.lab?.id
      : item.itemType === 'procedure'
        ? item.procedure?.id
        : item.inventoryItem?.id;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function effectivePrice(item: SearchableItem): number {
  const adj = item.adjustedPrice;
  if (adj != null && Number.isFinite(Number(adj))) return Number(adj);
  return Number(item.price) || 0;
}

const TYPE_LABEL: Record<string, string> = {
  lab: 'Lab',
  procedure: 'Procedure',
  inventory: 'Inventory',
};

/**
 * Plan = orders. Placing an order creates a record entry AND an invoice line in
 * one action (spec §5.4). Pre-staged proposals are accepted/declined; declining
 * removes both the record entry and the charge. Meds also generate a label and
 * discharge instruction on the backend.
 */
export default function PlanOrdersSection({
  encounterId,
  orders,
  disabled,
  patientId,
  clientId,
  practiceId,
  onChange,
  onInvoiceShouldRefresh,
}: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchableItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced catalog search across labs, procedures, and inventory items.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearchError(null);
      setSearching(false);
      return;
    }
    let canceled = false;
    setSearching(true);
    const handle = setTimeout(() => {
      searchItems({
        q,
        practiceId,
        limit: 25,
        code: q,
        patientId,
        clientId,
      })
        .then((rows) => {
          if (canceled) return;
          setResults(rows);
          setOpen(true);
          setSearchError(null);
        })
        .catch((e) => {
          if (canceled) return;
          setSearchError(e instanceof Error ? e.message : 'Search failed');
          setResults([]);
        })
        .finally(() => {
          if (!canceled) setSearching(false);
        });
    }, 250);
    return () => {
      canceled = true;
      clearTimeout(handle);
    };
  }, [query, practiceId, patientId, clientId]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const addItem = async (item: SearchableItem) => {
    if (adding) return;
    setAdding(true);
    try {
      const catalogItemType = item.itemType as EncounterOrderCatalogType;
      const covered = Boolean(
        item.wellnessPlanPricing?.hasCoverage &&
          item.wellnessPlanPricing?.isWithinLimit &&
          effectivePrice(item) === 0
      );
      const created = await createOrder(encounterId, {
        name: item.name,
        kind: kindForItem(item),
        catalogItemId: catalogIdForItem(item),
        catalogItemType,
        unitPrice: effectivePrice(item),
        isCovered: covered,
        state: 'accepted',
      });
      onChange([...orders, created]);
      onInvoiceShouldRefresh();
      setQuery('');
      setResults([]);
      setOpen(false);
    } finally {
      setAdding(false);
    }
  };

  const changeState = async (
    order: EncounterOrder,
    state: 'accepted' | 'declined'
  ) => {
    const updated = await setOrderState(encounterId, order.id, state);
    onChange(orders.map((o) => (o.id === order.id ? updated : o)));
    onInvoiceShouldRefresh();
  };

  const remove = async (order: EncounterOrder) => {
    await deleteOrder(encounterId, order.id);
    onChange(orders.filter((o) => o.id !== order.id));
    onInvoiceShouldRefresh();
  };

  const proposed = orders.filter((o) => o.state === 'proposed');
  const active = orders.filter((o) => o.state !== 'proposed');

  return (
    <div className="soap-plan">
      {proposed.length > 0 && (
        <div className="soap-plan-proposed">
          <div className="soap-subhead">Proposed (from Room Loader) — accept or decline</div>
          {proposed.map((o) => (
            <div key={o.id} className="soap-order proposed">
              <span className="soap-order-name">
                {o.kind === 'med' && <Pill size={13} />} {o.name}
              </span>
              <span className="soap-order-price">{money(o.qty * o.unitPrice)}</span>
              <div className="soap-order-actions">
                <button
                  type="button"
                  className="soap-btn small ok"
                  disabled={disabled}
                  onClick={() => changeState(o, 'accepted')}
                >
                  <Check size={13} /> Accept
                </button>
                <button
                  type="button"
                  className="soap-btn small danger"
                  disabled={disabled}
                  onClick={() => changeState(o, 'declined')}
                >
                  <X size={13} /> Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="soap-order-table">
        {active.length === 0 ? (
          <div className="soap-empty">No orders placed. Each order becomes a charge.</div>
        ) : (
          active.map((o) => (
            <div key={o.id} className={`soap-order ${o.state}`}>
              <span className="soap-order-name">
                {o.kind === 'med' && <Pill size={13} />} {o.name}
                {o.state === 'declined' && <span className="soap-tag declined">declined</span>}
                {o.isCovered && <span className="soap-tag covered">covered</span>}
              </span>
              <span className="soap-order-qty">×{o.qty}</span>
              <span className="soap-order-price">
                {o.isCovered ? '—' : money(o.qty * o.unitPrice)}
              </span>
              {!disabled && (
                <div className="soap-order-actions">
                  {o.state === 'declined' ? (
                    <button
                      type="button"
                      className="soap-btn small ok"
                      onClick={() => changeState(o, 'accepted')}
                    >
                      Re-add
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="soap-btn small danger"
                      onClick={() => changeState(o, 'declined')}
                    >
                      <X size={13} /> Decline
                    </button>
                  )}
                  <button
                    type="button"
                    className="soap-icon-btn"
                    title="Remove"
                    onClick={() => remove(o)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {!disabled && (
        <div className="soap-plan-search" ref={boxRef}>
          <div className="soap-plan-search-input">
            <Search size={15} className="soap-plan-search-icon" />
            <input
              className="soap-input"
              placeholder="Search inventory, procedures, and labs to order…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => {
                if (results.length > 0) setOpen(true);
              }}
            />
          </div>
          {open && (
            <div className="soap-plan-results" role="listbox">
              {searching && <div className="soap-plan-result-empty">Searching…</div>}
              {!searching && searchError && (
                <div className="soap-plan-result-empty error">{searchError}</div>
              )}
              {!searching && !searchError && results.length === 0 && query.trim().length >= 2 && (
                <div className="soap-plan-result-empty">No matching items.</div>
              )}
              {!searching &&
                results.map((item, idx) => {
                  const eff = effectivePrice(item);
                  const original = Number(item.price) || 0;
                  const discounted = eff !== original;
                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      key={`${item.itemType}-${catalogIdForItem(item) ?? idx}`}
                      className="soap-plan-result"
                      disabled={adding}
                      onClick={() => addItem(item)}
                    >
                      <span className={`soap-tag type-${item.itemType}`}>
                        {TYPE_LABEL[item.itemType] ?? item.itemType}
                      </span>
                      <span className="soap-plan-result-name">
                        {item.name}
                        {item.code ? (
                          <span className="soap-plan-result-code">{item.code}</span>
                        ) : null}
                      </span>
                      <span className="soap-plan-result-price">
                        {discounted && (
                          <span className="soap-plan-result-was">{money(original)}</span>
                        )}
                        {money(eff)}
                      </span>
                    </button>
                  );
                })}
            </div>
          )}
          <p className="soap-hint">
            Items come from the practice catalog (inventory, procedures, labs). Selecting
            one creates the treatment item and the charge.
          </p>
        </div>
      )}
    </div>
  );
}
