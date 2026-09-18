import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { searchItems, type ItemType, type SearchResultItem } from '../../api/quantityPriceBreaks';
import './CatalogItemPicker.css';

export type PickedCatalogItem = {
  itemType: ItemType;
  catalogItemId: number;
  name: string;
  code: string | null;
  price: number | null;
};

/** The search result carries the row under a per-table key rather than a flat id. */
export function catalogItemIdOf(row: SearchResultItem): number | null {
  const entity =
    row.itemType === 'inventory'
      ? row.inventoryItem
      : row.itemType === 'lab'
        ? row.lab
        : row.procedure;
  const id = (entity as { id?: unknown } | undefined)?.id;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function catalogItemTypeLabel(itemType: ItemType): string {
  if (itemType === 'inventory') return 'Product';
  if (itemType === 'lab') return 'Lab';
  return 'Procedure';
}

type Props = {
  practiceId: number;
  value: PickedCatalogItem | null;
  onChange: (next: PickedCatalogItem | null) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Restrict the list to one catalog table. */
  onlyTypes?: ItemType[];
};

/**
 * Type-ahead over products, labs and procedures. Wraps the existing
 * `/quantity-price-breaks/items/search` endpoint, which is the one catalog search that
 * returns the per-table row id a bundle or membership line needs.
 */
export default function CatalogItemPicker({
  practiceId,
  value,
  onChange,
  placeholder = 'Search products, labs, procedures…',
  disabled = false,
  onlyTypes,
}: Props) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<SearchResultItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setRows([]);
      setSearching(false);
      return;
    }
    const mine = ++seq.current;
    setSearching(true);
    const timer = window.setTimeout(() => {
      searchItems(q, practiceId, 20)
        .then((found) => {
          if (seq.current !== mine) return;
          setRows(
            found.filter(
              (r) => catalogItemIdOf(r) != null && (!onlyTypes || onlyTypes.includes(r.itemType))
            )
          );
        })
        .catch(() => {
          if (seq.current === mine) setRows([]);
        })
        .finally(() => {
          if (seq.current === mine) setSearching(false);
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, practiceId, onlyTypes]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  if (value) {
    return (
      <div className="cat-item-picker cat-item-picker--chosen">
        <span className={`cat-item-picker__tag cat-item-picker__tag--${value.itemType}`}>
          {catalogItemTypeLabel(value.itemType)}
        </span>
        <span className="cat-item-picker__chosen-name">{value.name}</span>
        {value.code ? <span className="cat-item-picker__chosen-code">{value.code}</span> : null}
        <button
          type="button"
          className="cat-item-picker__clear"
          aria-label={`Clear ${value.name}`}
          disabled={disabled}
          onClick={() => {
            onChange(null);
            setQuery('');
          }}
        >
          <X size={14} aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div className="cat-item-picker" ref={rootRef}>
      <div className="cat-item-picker__field">
        <Search size={14} aria-hidden className="cat-item-picker__field-icon" />
        <input
          type="text"
          className="cat-item-picker__input"
          value={query}
          disabled={disabled}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
        />
      </div>
      {open && query.trim().length >= 2 ? (
        <ul className="cat-item-picker__results">
          {searching && rows.length === 0 ? (
            <li className="cat-item-picker__hint">Searching…</li>
          ) : null}
          {!searching && rows.length === 0 ? (
            <li className="cat-item-picker__hint">No matches.</li>
          ) : null}
          {rows.map((row) => {
            const id = catalogItemIdOf(row);
            if (id == null) return null;
            return (
              <li key={`${row.itemType}-${id}`}>
                <button
                  type="button"
                  className="cat-item-picker__result"
                  onClick={() => {
                    onChange({
                      itemType: row.itemType,
                      catalogItemId: id,
                      name: row.name,
                      code: row.code ?? null,
                      price: Number.isFinite(row.price) ? row.price : null,
                    });
                    setOpen(false);
                    setQuery('');
                  }}
                >
                  <span className={`cat-item-picker__tag cat-item-picker__tag--${row.itemType}`}>
                    {catalogItemTypeLabel(row.itemType)}
                  </span>
                  <span className="cat-item-picker__result-name">{row.name}</span>
                  <span className="cat-item-picker__result-meta">{row.code || 'No code'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
