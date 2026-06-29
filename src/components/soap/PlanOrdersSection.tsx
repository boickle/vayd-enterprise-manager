import { useEffect, useRef, useState } from 'react';
import { Check, Minus, Pill, Plus, Search, StickyNote, Trash2, X } from 'lucide-react';
import {
  createOrder,
  deleteOrder,
  setOrderState,
  updateOrder,
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

  const addNote = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    try {
      const created = await createOrder(encounterId, {
        name: trimmed,
        note: trimmed,
        kind: 'note',
        catalogItemType: 'custom',
        unitPrice: 0,
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

  const patch = async (
    order: EncounterOrder,
    body: { name?: string; note?: string | null; qty?: number; unitPrice?: number }
  ) => {
    const updated = await updateOrder(encounterId, order.id, body);
    onChange(orders.map((o) => (o.id === order.id ? updated : o)));
    onInvoiceShouldRefresh();
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
          active.map((o) =>
            o.kind === 'note' ? (
              <NoteRow
                key={o.id}
                order={o}
                disabled={disabled}
                onPatch={patch}
                onRemove={remove}
              />
            ) : (
              <CatalogRow
                key={o.id}
                order={o}
                disabled={disabled}
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
              {/* Pinned: always available so typing never dead-ends. */}
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
            Catalog items (inventory, procedures, labs) become a charge. “Add as note”
            creates a text line you can edit and optionally price.
          </p>
        </div>
      )}
    </div>
  );
}

/** Catalog/charge order row with an inline quantity stepper. */
function CatalogRow({
  order: o,
  disabled,
  onPatch,
  onChangeState,
  onRemove,
}: {
  order: EncounterOrder;
  disabled?: boolean;
  onPatch: (
    order: EncounterOrder,
    body: { qty?: number; unitPrice?: number }
  ) => Promise<void>;
  onChangeState: (order: EncounterOrder, state: 'accepted' | 'declined') => void;
  onRemove: (order: EncounterOrder) => void;
}) {
  const qty = Number(o.qty) || 1;
  const editable = !disabled && o.state !== 'declined';
  const setQty = (next: number) => {
    const q = Math.max(1, Math.round(next));
    if (q !== qty) void onPatch(o, { qty: q });
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
            disabled={qty <= 1}
            onClick={() => setQty(qty - 1)}
          >
            <Minus size={13} />
          </button>
          <input
            className="soap-qty-input"
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
          />
          <button
            type="button"
            className="soap-icon-btn"
            title="Increase"
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
              onClick={() => onChangeState(o, 'accepted')}
            >
              Re-add
            </button>
          ) : (
            <button
              type="button"
              className="soap-btn small danger"
              onClick={() => onChangeState(o, 'declined')}
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

/** Free-form note row: editable text + optional manual charge. */
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
  const [price, setPrice] = useState(
    Number(o.unitPrice) > 0 ? String(Number(o.unitPrice)) : ''
  );

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
        <button
          type="button"
          className="soap-icon-btn"
          title="Remove"
          onClick={() => onRemove(o)}
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}
