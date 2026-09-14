import { useCallback, useEffect, useRef, useState } from 'react';
import { Minus, Pill, Plus, Search, StickyNote, Trash2, X } from 'lucide-react';
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
import {
  ensureSharpsFeeOrder,
  isSharpsOrderName,
  isVaccineSearchItem,
} from '../../utils/visitSharpsFee';

type Props = {
  encounterId: string;
  orders: EncounterOrder[];
  disabled?: boolean;
  patientId?: number;
  clientId?: number;
  practiceId: number;
  onChange: (orders: EncounterOrder[]) => void;
  onInvoiceShouldRefresh: () => void;
  /** Room Loader–originated ids: Accept/Decline stay on the right; don't list them here. */
  excludeOrderIds?: ReadonlySet<string>;
  /** Inventory catalog picks also go under Treatment Plan/Medications in the Plan narrative. */
  onInventoryItemAdded?: (item: { name: string; isVaccine?: boolean }) => void;
  /** When an inventory order is removed from Plan/checkout, drop its Plan narrative bullet. */
  onInventoryItemRemoved?: (itemName: string) => void;
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
  excludeOrderIds,
  practiceId,
  onChange,
  onInvoiceShouldRefresh,
  onInventoryItemAdded,
  onInventoryItemRemoved,
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
      clientNote?: string | null;
      microchipNumber?: string | null;
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
      const nextOrders = [...orders, order];
      let sharpsOrder: EncounterOrder | null = null;
      try {
        sharpsOrder = await ensureSharpsFeeOrder({
          encounterId,
          practiceId,
          patientId: canPrice ? patientId : undefined,
          clientId,
          existingOrders: nextOrders,
          triggerItem: item,
        });
      } catch {
        /* Sharps is best-effort — the vaccine/injection still charges. */
      }
      onChange(sharpsOrder ? [...nextOrders, sharpsOrder] : nextOrders);
      onInvoiceShouldRefresh();
      if (item.itemType === 'inventory' && !isSharpsOrderName(item.name)) {
        onInventoryItemAdded?.({
          name: item.name,
          isVaccine: isVaccineSearchItem(item),
        });
      }
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
        const keepExisting = unitFinal === 0 && !isCovered && Number(updated.unitPrice) > 0;
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
    if (order.catalogItemType === 'inventory') {
      onInventoryItemRemoved?.(order.name);
    }
  };

  // Charging items live in Checkout only. Plan keeps notes (and anything not yet
  // charged) so Revolution / Solensia / Trip Fee don't also sit here with a Decline.
  // Room Loader proposed/declined lines stay in `ProposedOrdersPanel` on the right.
  const active = orders.filter(
    (o) =>
      o.state === 'accepted' &&
      !(excludeOrderIds?.has(o.id) ?? false) &&
      (o.kind === 'note' || !o.invoiceLineId)
  );

  return (
    <div className="soap-plan">
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
                onPatch={patch}
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
  onPatch,
  onChangeState,
  onRemove,
}: {
  order: EncounterOrder;
  disabled?: boolean;
  onQtyChange: (order: EncounterOrder, qty: number) => Promise<void>;
  onPatch: (
    order: EncounterOrder,
    body: {
      clientNote?: string | null;
      microchipNumber?: string | null;
      unitPrice?: number;
    }
  ) => Promise<void>;
  onChangeState: (order: EncounterOrder, state: 'accepted' | 'declined') => void;
  onRemove: (order: EncounterOrder) => void;
}) {
  const qty = Number(o.qty) || 1;
  const editable = !disabled && o.state !== 'declined';
  const flags = o.catalogFlags;
  const allowPrice = flags?.allowPriceChange === true;
  const [repricing, setRepricing] = useState(false);
  const [priceDraft, setPriceDraft] = useState(String(Number(o.unitPrice) || 0));
  const [clientNoteDraft, setClientNoteDraft] = useState(o.clientNote ?? '');
  const [microchipDraft, setMicrochipDraft] = useState(o.microchipNumber ?? '');

  useEffect(() => {
    setPriceDraft(String(Number(o.unitPrice) || 0));
    setClientNoteDraft(o.clientNote ?? '');
    setMicrochipDraft(o.microchipNumber ?? '');
  }, [o.id, o.unitPrice, o.clientNote, o.microchipNumber]);

  const setQty = (next: number) => {
    const q = Math.max(1, Math.round(next));
    if (q === qty || repricing) return;
    setRepricing(true);
    void onQtyChange(o, q).finally(() => setRepricing(false));
  };

  const commitPrice = () => {
    if (!allowPrice || !editable) return;
    const n = Number(priceDraft);
    if (!Number.isFinite(n) || n < 0) {
      setPriceDraft(String(Number(o.unitPrice) || 0));
      return;
    }
    if (Math.abs(n - Number(o.unitPrice)) < 0.0001) return;
    void onPatch(o, { unitPrice: n });
  };

  return (
    <div className={`soap-order ${o.state}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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
          {allowPrice && editable ? (
            <label className="soap-order-price" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              $
              <input
                className="soap-input"
                style={{ width: 72, padding: '2px 6px' }}
                type="number"
                min={0}
                step="0.01"
                value={priceDraft}
                onChange={(e) => setPriceDraft(e.target.value)}
                onBlur={commitPrice}
              />
            </label>
          ) : (
            <span className="soap-order-price">
              {o.isCovered ? '—' : money(qty * Number(o.unitPrice))}
            </span>
          )}
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
        {flags?.hasClientNotes && editable && (
          <label style={{ fontSize: 12, color: '#475569', display: 'block' }}>
            Client note
            <textarea
              className="soap-input"
              rows={2}
              value={clientNoteDraft}
              onChange={(e) => setClientNoteDraft(e.target.value)}
              onBlur={() => {
                if ((o.clientNote ?? '') === clientNoteDraft) return;
                void onPatch(o, { clientNote: clientNoteDraft.trim() || null });
              }}
              style={{ marginTop: 4, width: '100%', resize: 'vertical' }}
            />
          </label>
        )}
        {flags?.isMicrochip && editable && (
          <label style={{ fontSize: 12, color: '#475569', display: 'block', maxWidth: 320 }}>
            Microchip number
            <input
              className="soap-input"
              value={microchipDraft}
              onChange={(e) => setMicrochipDraft(e.target.value)}
              onBlur={() => {
                const next = microchipDraft.trim() || null;
                if ((o.microchipNumber ?? null) === next) return;
                void onPatch(o, { microchipNumber: next });
              }}
              placeholder="Required when implanting"
              style={{ marginTop: 4, width: '100%' }}
            />
          </label>
        )}
      </div>
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
