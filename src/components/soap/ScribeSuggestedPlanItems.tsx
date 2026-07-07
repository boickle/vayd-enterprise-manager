import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, StickyNote, X } from 'lucide-react';
import { searchItems, type SearchableItem } from '../../api/roomLoader';
import {
  createNoteOrder,
  createOrderFromSearchItem,
  getCatalogLinePrice,
  type CatalogPricingItem,
} from '../../utils/catalogItemPricing';
import type { EncounterOrder, EncounterOrderKind } from '../../api/visitWorkflow';

export type SuggestedPlanItem = {
  key: string;
  name: string;
  kind: EncounterOrderKind;
  note: string | null;
};

type Props = {
  encounterId: string;
  /** Products/services the AI heard mentioned in the transcript (docs/ai-scribe.md) — not yet
   * real orders. Each renders as its own pre-filled search row so the doctor can resolve it to
   * an actual catalog item in one click. */
  suggestions: SuggestedPlanItem[];
  /** The Plan narrative text shown in the Document view's P field. `structure()`'s `suggestions`
   * above and `generateNarrative()`'s Plan text are two separate model calls, and the narrative is
   * often more thorough — bullets under "Diagnostics:" / "Treatment Plan/Medications:" etc.
   * headers are parsed out here as additional rows so nothing visible in the Plan text is missing
   * a search box, even if the structured extraction didn't also catch it. */
  planNotes: string;
  /** Orders already on the plan (from Room Loader, a prior search pick, etc.) — narrative-derived
   * rows are filtered against these so an item that's already been added doesn't keep reappearing
   * as a suggestion. Never mutated here; Room Loader's own proposed/accepted orders are left
   * exactly as `PlanOrdersSection` renders them. */
  orders: EncounterOrder[];
  disabled?: boolean;
  patientId?: number;
  clientId?: number;
  practiceId: number;
  onOrderAdded: (order: EncounterOrder) => void;
  onInvoiceShouldRefresh: () => void;
};

function norm(s: string): string {
  return s.trim().toLowerCase();
}

const SECTION_KIND: { pattern: RegExp; kind: EncounterOrderKind }[] = [
  { pattern: /diagnostic|lab|bloodwork|blood work|imaging|radiograph/i, kind: 'diagnostic' },
  { pattern: /medication|meds?\b/i, kind: 'med' },
  { pattern: /treatment|procedure|therap/i, kind: 'treatment' },
];

function kindForSectionHeader(header: string): EncounterOrderKind {
  for (const { pattern, kind } of SECTION_KIND) {
    if (pattern.test(header)) return kind;
  }
  return 'treatment';
}

const LEADING_VERBS =
  /^(continue|start|begin|perform|administer|recheck|repeat|schedule|initiate|resume|discussed?|recommend(ed)?)\s+/i;
const TRAILING_STATUS = /\s+(performed|completed|done|administered)\.?$/i;

/** Trims a narrative bullet down to something more likely to match a catalog item name — e.g.
 * "Continue transdermal thyroid medication, adjust based on blood work results" -> "transdermal
 * thyroid medication". The doctor can still freely edit the search box afterward. */
function shortenForSearch(text: string): string {
  let t = text.trim().replace(/\.$/, '');
  t = t.replace(TRAILING_STATUS, '');
  const cut = t.match(/^(.*?)(,| to | for | based on | in order to | so (?:that|we))/i);
  if (cut && cut[1].trim().length >= 3) t = cut[1].trim();
  t = t.replace(LEADING_VERBS, '').trim();
  return t || text.trim();
}

/** Parses `- bullet` lines out of the Plan narrative, tagging each with the kind implied by its
 * section header (a line ending in `:`, e.g. "Diagnostics:"). */
function extractPlanNarrativeItems(planNotes: string): SuggestedPlanItem[] {
  let currentKind: EncounterOrderKind = 'treatment';
  const items: SuggestedPlanItem[] = [];
  for (const raw of planNotes.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const bulletMatch = line.match(/^[-•*]\s*(.+)$/);
    if (!bulletMatch) {
      if (line.endsWith(':')) currentKind = kindForSectionHeader(line);
      continue;
    }
    const text = bulletMatch[1].trim();
    if (!text) continue;
    const query = shortenForSearch(text);
    items.push({
      key: `narrative:${norm(text)}`,
      name: query,
      kind: currentKind,
      note: norm(text) !== norm(query) ? text : null,
    });
  }
  return items;
}

const TYPE_LABEL: Record<string, string> = {
  lab: 'Lab',
  procedure: 'Procedure',
  inventory: 'Inventory',
};

function money(n: number): string {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

function displayPrice(item: SearchableItem): number {
  return getCatalogLinePrice(item as CatalogPricingItem, 1).unitFinal;
}

let extraRowSeq = 0;

/**
 * Sits below the Plan text box in the AI Scribe Document view (docs/ai-scribe.md). Unlike the
 * generic search box in `PlanOrdersSection`, each row here is seeded with one specific thing the
 * AI heard mentioned (e.g. "Blood work", "Heartworm prevention") so the doctor just has to pick
 * the right catalog match rather than re-type it — resolving a row creates the exact same
 * priced, `accepted` order as a manual-mode search pick, so it shows up for checkout/invoice
 * immediately. "+ Add item" adds a blank row for anything the transcript didn't mention.
 */
export default function ScribeSuggestedPlanItems({
  encounterId,
  suggestions,
  planNotes,
  orders,
  disabled,
  patientId,
  clientId,
  practiceId,
  onOrderAdded,
  onInvoiceShouldRefresh,
}: Props) {
  const [resolvedKeys, setResolvedKeys] = useState<Set<string>>(new Set());
  const [extraRows, setExtraRows] = useState<string[]>([]);

  const mergedSuggestions = useMemo(() => {
    const existingOrderNames = new Set(orders.map((o) => norm(o.name)));
    const narrativeItems = extractPlanNarrativeItems(planNotes).filter(
      (n) => !existingOrderNames.has(norm(n.name))
    );
    const seen = new Set(suggestions.map((s) => norm(s.name)));
    const extra = narrativeItems.filter((n) => {
      if (seen.has(norm(n.name))) return false;
      seen.add(norm(n.name));
      return true;
    });
    return [...suggestions, ...extra];
  }, [suggestions, planNotes, orders]);

  useEffect(() => {
    // A fresh "Process" pass can re-suggest an item under the same key (e.g. re-derived on a
    // second recording segment) — let it show up again rather than staying hidden forever.
    setResolvedKeys((prev) => {
      const validKeys = new Set(mergedSuggestions.map((s) => s.key));
      let changed = false;
      const next = new Set(prev);
      for (const k of prev) {
        if (!validKeys.has(k)) {
          next.delete(k);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [mergedSuggestions]);

  if (disabled) return null;

  const suggestedRows = mergedSuggestions.filter((s) => !resolvedKeys.has(s.key));
  const hasAnyRows = suggestedRows.length > 0 || extraRows.length > 0;

  return (
    <div className="soap-scribe-planitems">
      <div className="soap-scribe-planitems-head">
        <span>Plan items for checkout</span>
        {suggestedRows.length > 0 && (
          <span className="soap-scribe-tag">{suggestedRows.length} from transcript</span>
        )}
      </div>
      <p className="soap-scribe-planitems-hint">
        Match each item to the catalog to add it as a priced order — the same search as Manual
        mode&apos;s Plan tab.
      </p>

      {hasAnyRows && (
        <div className="soap-scribe-planitems-list">
          {suggestedRows.map((s) => (
            <PlanItemSearchRow
              key={s.key}
              initialQuery={s.name}
              note={s.note}
              placeholder="Search to match this item…"
              encounterId={encounterId}
              patientId={patientId}
              clientId={clientId}
              practiceId={practiceId}
              onAdded={(order) => {
                onOrderAdded(order);
                onInvoiceShouldRefresh();
                setResolvedKeys((prev) => new Set(prev).add(s.key));
              }}
              onDismiss={() => setResolvedKeys((prev) => new Set(prev).add(s.key))}
            />
          ))}
          {extraRows.map((key) => (
            <PlanItemSearchRow
              key={key}
              initialQuery=""
              note={null}
              placeholder="Search inventory, labs, procedures…"
              encounterId={encounterId}
              patientId={patientId}
              clientId={clientId}
              practiceId={practiceId}
              onAdded={(order) => {
                onOrderAdded(order);
                onInvoiceShouldRefresh();
                setExtraRows((prev) => prev.filter((k) => k !== key));
              }}
              onDismiss={() => setExtraRows((prev) => prev.filter((k) => k !== key))}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        className="soap-btn small ghost"
        onClick={() => setExtraRows((prev) => [...prev, `extra-${(extraRowSeq += 1)}`])}
      >
        <Plus size={13} /> Add item
      </button>
    </div>
  );
}

function PlanItemSearchRow({
  initialQuery,
  note,
  placeholder,
  encounterId,
  patientId,
  clientId,
  practiceId,
  onAdded,
  onDismiss,
}: {
  initialQuery: string;
  note: string | null;
  placeholder: string;
  encounterId: string;
  patientId?: number;
  clientId?: number;
  practiceId: number;
  onAdded: (order: EncounterOrder) => void;
  onDismiss: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchableItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [open, setOpen] = useState(Boolean(initialQuery));
  const [adding, setAdding] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

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
      searchItems({ q, practiceId, limit: 15, code: q, patientId, clientId })
        .then((rows) => {
          if (canceled) return;
          setResults(rows);
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
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const pick = async (item: SearchableItem) => {
    if (adding) return;
    setAdding(true);
    try {
      const { order } = await createOrderFromSearchItem({
        encounterId,
        item,
        patientId,
        practiceId,
        clientId,
      });
      onAdded(order);
    } finally {
      setAdding(false);
    }
  };

  const addAsNote = async () => {
    const text = query.trim();
    if (!text || adding) return;
    setAdding(true);
    try {
      const order = await createNoteOrder(encounterId, text);
      onAdded(order);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="soap-scribe-planitem-row" ref={boxRef}>
      <div className="soap-scribe-planitem-search">
        <Search size={13} className="soap-scribe-planitem-search-icon" />
        <input
          className="soap-input"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results.length === 0) {
              e.preventDefault();
              void addAsNote();
            }
          }}
          disabled={adding}
        />
        <button
          type="button"
          className="soap-icon-btn"
          title="Remove"
          disabled={adding}
          onClick={onDismiss}
        >
          <X size={13} />
        </button>
      </div>
      {note && <p className="soap-scribe-planitem-note">&ldquo;{note}&rdquo;</p>}
      {open && query.trim().length >= 1 && (
        <div className="soap-scribe-planitem-results" role="listbox">
          {searching && <div className="soap-plan-result-empty">Searching…</div>}
          {!searching && searchError && (
            <div className="soap-plan-result-empty error">{searchError}</div>
          )}
          {!searching &&
            results.map((item, idx) => (
              <button
                type="button"
                role="option"
                aria-selected={false}
                key={`${item.itemType}-${item.lab?.id ?? item.procedure?.id ?? item.inventoryItem?.id ?? idx}`}
                className="soap-plan-result"
                disabled={adding}
                onClick={() => void pick(item)}
              >
                <span className={`soap-tag type-${item.itemType}`}>
                  {TYPE_LABEL[item.itemType] ?? item.itemType}
                </span>
                <span className="soap-plan-result-name">{item.name}</span>
                <span className="soap-plan-result-price">{money(displayPrice(item))}</span>
              </button>
            ))}
          <button
            type="button"
            role="option"
            aria-selected={false}
            className="soap-plan-result soap-plan-result-note"
            disabled={adding || !query.trim()}
            onClick={() => void addAsNote()}
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
    </div>
  );
}
