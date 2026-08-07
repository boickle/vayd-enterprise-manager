import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Minus, Pill, Plus, Search, StickyNote, Trash2, X } from 'lucide-react';
import {
  deleteOrder,
  setOrderState,
  updateOrder,
  type EncounterOrder,
} from '../../api/visitWorkflow';
import { searchItems, type SearchableItem } from '../../api/roomLoader';
import {
  catalogIdForSearchItem,
  createNoteOrder,
  createOrderFromSearchItem,
  fetchCatalogPricingForOrder,
  getCatalogLinePrice,
  type CatalogPricingItem,
} from '../../utils/catalogItemPricing';

type Props = {
  encounterId: string;
  orders: EncounterOrder[];
  disabled?: boolean;
  patientId?: number;
  clientId?: number;
  practiceId: number;
  onChange: (orders: EncounterOrder[]) => void;
  onInvoiceShouldRefresh: () => void;
};

function money(n: number): string {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

const TYPE_LABEL: Record<string, string> = {
  lab: 'Lab',
  procedure: 'Procedure',
  inventory: 'Inventory',
};

/** Search row display price at qty 1 (tiers + discounts when metadata present). */
function displayPriceForSearchItem(item: SearchableItem): number {
  return getCatalogLinePrice(item as CatalogPricingItem, 1).unitFinal;
}

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
  const [pricingByOrderId, setPricingByOrderId] = useState<Record<string, CatalogPricingItem>>({});
  const boxRef = useRef<HTMLDivElement>(null);

  const canPrice = patientId != null && Number.isFinite(patientId);

  const storePricing = useCallback((orderId: string, item: CatalogPricingItem) => {
    setPricingByOrderId((prev) => ({ ...prev, [orderId]: item }));
  }, []);

  const dropPricing = useCallback((orderId: string) => {
    setPricingByOrderId((prev) => {
      if (!(orderId in prev)) return prev;
      const next = { ...prev };
      delete next[orderId];
      return next;
    });
  }, []);

  const ensurePricingSnapshot = useCallback(
    async (order: EncounterOrder): Promise<CatalogPricingItem | null> => {
      const cached = pricingByOrderId[order.id];
      if (cached) return cached;
      if (!canPrice) return null;
      const item = await fetchCatalogPricingForOrder({
        order,
        patientId: patientId!,
        practiceId,
        clientId,
      });
      if (item) storePricing(order.id, item);
      return item;
    },
    [pricingByOrderId, canPrice, patientId, practiceId, clientId, storePricing]
  );

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

  const patch = async (
    order: EncounterOrder,
    body: {
      name?: string;
      note?: string | null;
      qty?: number;
      unitPrice?: number;
      isCovered?: boolean;
    }
  ) => {
    const updated = await updateOrder(encounterId, order.id, body);
    onChange(orders.map((o) => (o.id === order.id ? updated : o)));
    onInvoiceShouldRefresh();
  };

  const repriceAndPatch = async (order: EncounterOrder, qty: number) => {
    const q = Math.max(1, Math.round(qty));
    if (q === Number(order.qty) && order.catalogItemId == null) {
      await patch(order, { qty: q });
      return;
    }

    const snapshot = await ensurePricingSnapshot(order);
    if (!snapshot) {
      await patch(order, { qty: q });
      return;
    }

    const { unitFinal, isCovered } = getCatalogLinePrice(snapshot, q);
    await patch(order, { qty: q, unitPrice: unitFinal, isCovered });
  };

  const addItem = async (item: SearchableItem) => {
    if (adding) return;
    setAdding(true);
    try {
      const { order, pricingItem } = await createOrderFromSearchItem({
        encounterId,
        item,
        patientId: canPrice ? patientId : undefined,
        practiceId,
        clientId,
      });
      storePricing(order.id, pricingItem);
      onChange([...orders, order]);
      onInvoiceShouldRefresh();
      setQuery('');
      setResults([]);
      setOpen(false);
    } finally {
      setAdding(false);
    }
  };

  const addNote = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    try {
      const created = await createNoteOrder(encounterId, trimmed);
      onChange([...orders, created]);
      onInvoiceShouldRefresh();
      setQuery('');
      setResults([]);
      setOpen(false);
    } finally {
      setAdding(false);
    }
  };

  const changeState = async (order: EncounterOrder, state: 'accepted' | 'declined') => {
    let updated = await setOrderState(encounterId, order.id, state);

    if (state === 'accepted' && order.catalogItemId != null && canPrice) {
      const snapshot = await ensurePricingSnapshot(updated);
      if (snapshot) {
        const qty = Number(updated.qty) || 1;
        const { unitFinal, isCovered } = getCatalogLinePrice(snapshot, qty);
        // Never overwrite a Room Loader / existing price with $0 from a failed catalog lookup.
        // Covered membership lines legitimately price at 0; everything else keeps what it has.
        const keepExisting =
          unitFinal === 0 && !isCovered && Number(updated.unitPrice) > 0;
        if (
          !keepExisting &&
          (unitFinal !== Number(updated.unitPrice) || isCovered !== updated.isCovered)
        ) {
          updated = await updateOrder(encounterId, updated.id, {
            unitPrice: unitFinal,
            isCovered,
          });
        }
      }
    }

    onChange(orders.map((o) => (o.id === order.id ? updated : o)));
    onInvoiceShouldRefresh();
  };

  const remove = async (order: EncounterOrder) => {
    await deleteOrder(encounterId, order.id);
    dropPricing(order.id);
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
                {Number(o.qty) > 1 && <span className="soap-order-qty"> ×{Number(o.qty)}</span>}
              </span>
              <span className="soap-order-price">
                {o.isCovered ? '—' : money(Number(o.qty) * Number(o.unitPrice))}
              </span>
              <div className="soap-order-actions">
                <button
                  type="button"
                  className="soap-btn small ok"
                  disabled={disabled}
                  onClick={() => void changeState(o, 'accepted')}
                >
                  <Check size={13} /> Accept
                </button>
                <button
                  type="button"
                  className="soap-btn small danger"
                  disabled={disabled}
                  onClick={() => void changeState(o, 'declined')}
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
          active.map((o) =>
            o.kind === 'note' ? (
              <NoteRow key={o.id} order={o} disabled={disabled} onPatch={patch} onRemove={remove} />
            ) : (
              <CatalogRow
                key={o.id}
                order={o}
                disabled={disabled}
                onQtyChange={repriceAndPatch}
                onChangeState={changeState}
                onRemove={remove}
              />
            )
          )
        )}
      </div>

      {!disabled && (
        <div className="soap-plan-search" ref={boxRef}>
          <div className="soap-plan-search-input">
            <Search size={15} className="soap-plan-search-icon" />
            <input
              className="soap-input"
              placeholder="Search to order, or type a note…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (e.target.value.trim().length >= 1) setOpen(true);
              }}
              onFocus={() => {
                if (query.trim().length >= 1) setOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && results.length === 0) {
                  e.preventDefault();
                  void addNote(query);
                }
              }}
            />
          </div>
          {open && query.trim().length >= 1 && (
            <div className="soap-plan-results" role="listbox">
              {searching && <div className="soap-plan-result-empty">Searching…</div>}
              {!searching && searchError && (
                <div className="soap-plan-result-empty error">{searchError}</div>
              )}
              {!searching &&
                results.map((item, idx) => {
                  const eff = displayPriceForSearchItem(item);
                  const original = Number(item.price) || 0;
                  const discounted = eff !== original;
                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      key={`${item.itemType}-${catalogIdForSearchItem(item) ?? idx}`}
                      className="soap-plan-result"
                      disabled={adding}
                      onClick={() => void addItem(item)}
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
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="soap-plan-result soap-plan-result-note"
                disabled={adding}
                onClick={() => void addNote(query)}
              >
                <span className="soap-tag type-note">
                  <StickyNote size={11} /> Note
                </span>
                <span className="soap-plan-result-name">
                  Add as note: <strong>{query.trim()}</strong>
                </span>
              </button>
            </div>
          )}
          <p className="soap-hint">
            Catalog prices use quantity tiers and membership/client discounts (same as Room Loader).
            “Add as note” creates a text line you can edit and optionally price.
          </p>
        </div>
      )}
    </div>
  );
}

function CatalogRow({
  order: o,
  disabled,
  onQtyChange,
  onChangeState,
  onRemove,
}: {
  order: EncounterOrder;
  disabled?: boolean;
  onQtyChange: (order: EncounterOrder, qty: number) => Promise<void>;
  onChangeState: (order: EncounterOrder, state: 'accepted' | 'declined') => void;
  onRemove: (order: EncounterOrder) => void;
}) {
  const qty = Number(o.qty) || 1;
  const editable = !disabled && o.state !== 'declined';
  const [repricing, setRepricing] = useState(false);

  const setQty = (next: number) => {
    const q = Math.max(1, Math.round(next));
    if (q === qty || repricing) return;
    setRepricing(true);
    void onQtyChange(o, q).finally(() => setRepricing(false));
  };

  return (
    <div className={`soap-order ${o.state}`}>
      <span className="soap-order-name">
        {o.kind === 'med' && <Pill size={13} />} {o.name}
        {o.state === 'declined' && <span className="soap-tag declined">declined</span>}
        {o.isCovered && <span className="soap-tag covered">covered</span>}
      </span>
      {editable ? (
        <span className="soap-qty-stepper">
          <button
            type="button"
            className="soap-icon-btn"
            title="Decrease"
            disabled={qty <= 1 || repricing}
            onClick={() => setQty(qty - 1)}
          >
            <Minus size={13} />
          </button>
          <input
            className="soap-qty-input"
            type="number"
            min={1}
            value={qty}
            disabled={repricing}
            onChange={(e) => setQty(Number(e.target.value))}
          />
          <button
            type="button"
            className="soap-icon-btn"
            title="Increase"
            disabled={repricing}
            onClick={() => setQty(qty + 1)}
          >
            <Plus size={13} />
          </button>
        </span>
      ) : (
        <span className="soap-order-qty">×{qty}</span>
      )}
      <span className="soap-order-price">
        {o.isCovered ? '—' : money(qty * Number(o.unitPrice))}
      </span>
      {!disabled && (
        <div className="soap-order-actions">
          {o.state === 'declined' ? (
            <button
              type="button"
              className="soap-btn small ok"
              onClick={() => void onChangeState(o, 'accepted')}
            >
              Re-add
            </button>
          ) : (
            <button
              type="button"
              className="soap-btn small danger"
              onClick={() => void onChangeState(o, 'declined')}
            >
              <X size={13} /> Decline
            </button>
          )}
          <button
            type="button"
            className="soap-icon-btn"
            title="Remove"
            onClick={() => onRemove(o)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

function NoteRow({
  order: o,
  disabled,
  onPatch,
  onRemove,
}: {
  order: EncounterOrder;
  disabled?: boolean;
  onPatch: (
    order: EncounterOrder,
    body: { name?: string; note?: string | null; unitPrice?: number }
  ) => Promise<void>;
  onRemove: (order: EncounterOrder) => void;
}) {
  const [text, setText] = useState(o.note ?? o.name ?? '');
  const [price, setPrice] = useState(Number(o.unitPrice) > 0 ? String(Number(o.unitPrice)) : '');

  const commitText = () => {
    const next = text.trim();
    if (next && next !== (o.note ?? o.name)) {
      void onPatch(o, { name: next.slice(0, 200), note: next });
    }
  };
  const commitPrice = () => {
    const next = Number(price) || 0;
    if (next !== Number(o.unitPrice)) void onPatch(o, { unitPrice: next });
  };

  return (
    <div className="soap-order note">
      <span className="soap-order-note-icon">
        <StickyNote size={14} />
      </span>
      {disabled ? (
        <span className="soap-order-name">{o.note ?? o.name}</span>
      ) : (
        <textarea
          className="soap-note-text"
          rows={1}
          value={text}
          placeholder="Note…"
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
        />
      )}
      {disabled ? (
        Number(o.unitPrice) > 0 ? (
          <span className="soap-order-price">{money(Number(o.unitPrice))}</span>
        ) : null
      ) : (
        <span className="soap-note-price-wrap">
          <span className="soap-note-price-dollar">$</span>
          <input
            className="soap-note-price"
            inputMode="decimal"
            placeholder="0.00"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onBlur={commitPrice}
          />
        </span>
      )}
      {!disabled && (
        <button type="button" className="soap-icon-btn" title="Remove" onClick={() => onRemove(o)}>
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}
