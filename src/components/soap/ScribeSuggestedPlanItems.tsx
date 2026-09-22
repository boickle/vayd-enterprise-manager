import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import { searchItems, type SearchableItem } from '../../api/roomLoader';
import {
  createOrderFromSearchItem,
  getCatalogLinePrice,
  type CatalogPricingItem,
} from '../../utils/catalogItemPricing';
import { createOrder, type EncounterOrder, type EncounterOrderKind } from '../../api/visitWorkflow';
import { ensureSharpsFeeOrder, isVaccineSearchItem } from '../../utils/visitSharpsFee';
import { appendCheckoutPrepDrafts } from '../../api/visitWrapUp';
import { createTask } from '../../api/tasks';
import { fetchAllEmployees, type Employee } from '../../api/appointmentSettings';
import { listPracticeBranches } from '../../api/branchInventory';
import { formatEmployeeDisplayName } from '../../utils/employeeDisplayName';
import { toDatetimeLocalValue, fromDatetimeLocalValue } from '../../utils/taskDateTime';
import { appDeclineHow } from '../../utils/appDialog';
import { offRecordDeclineNote } from '../../api/declinedTreatments';
import { AddReminderForm } from './WrapUpReminders';

export type SuggestedPlanItem = {
  key: string;
  name: string;
  kind: EncounterOrderKind;
  note: string | null;
};

export type SoapNarrativeSection = 'subjective' | 'objective' | 'assessment' | 'plan';

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
  onOrderAdded: (
    order: EncounterOrder,
    meta?: { isVaccine?: boolean; skipPlanNarrative?: boolean }
  ) => void;
  onInvoiceShouldRefresh: () => void;
  /** @deprecated Checkout prep no longer writes SOAP bullets. Kept so existing callers compile. */
  onAppendToSoapSection?: (section: SoapNarrativeSection, text: string) => void;
  /** Unmatched rows left (after dismiss / match) — drives the Checkout prep tab badge. */
  onPendingCountChange?: (count: number) => void;
};

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** Bullets written when an inventory item is already charging — never re-offer them. */
const RXED_BULLET = /^rx'?ed\s+/i;
const VX_ADMINISTERED_BULLET = /^vx\s+administered:\s*/i;

/** Route, form and packaging words that differ between how a doctor says an item and how the
 * catalog spells it ("Lyme vaccine annual SQ" vs "crLyme Vaccine- Annual"). */
const NOISE_TOKENS = new Set([
  'sq',
  'subq',
  'sub',
  'im',
  'iv',
  'sc',
  'po',
  'inj',
  'injection',
  'oral',
  'dose',
  'doses',
  'add',
  'rebate',
  'for',
  'and',
  'the',
  'with',
  'per',
  'each',
]);

function significantTokens(name: string): string[] {
  return norm(name)
    .replace(RXED_BULLET, '')
    .replace(VX_ADMINISTERED_BULLET, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !NOISE_TOKENS.has(t));
}

/**
 * A suggestion and an order are the same item when every meaningful word of the suggestion is
 * present in the order name. Substring containment on each token handles the catalog's species
 * prefixes — "lyme" has to match "crLyme" — which plain prefix comparison of the whole string
 * missed, so "Lyme vaccine annual SQ" kept reappearing next to "crLyme Vaccine- Annual".
 *
 * Requiring *all* tokens keeps "Rabies vaccine annual" from collapsing onto "crLyme Vaccine-
 * Annual" just because both are annual vaccines. Genuine paraphrases the transcript and catalog
 * word completely differently ("Heartworm/tick-borne disease screening" vs "Heartworm / Tick Test
 * (4dx)") are handled upstream instead, by telling the model what is already on the invoice.
 */
function matchesExistingOrder(name: string, orderNames: string[]): boolean {
  const candidate = significantTokens(name);
  if (!candidate.length) return false;
  return orderNames.some((order) => {
    const orderTokens = significantTokens(order);
    if (!orderTokens.length) return false;
    return candidate.every((t) =>
      orderTokens.some((o) => o === t || (t.length >= 4 && o.includes(t)) || (o.length >= 4 && t.includes(o)))
    );
  });
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
    // Auto Plan bullets for items already charging — never re-offer them as checkout rows.
    // Freeform notes like "Administered SQF" still come through (no Vx/Rx prefix).
    if (RXED_BULLET.test(text) || VX_ADMINISTERED_BULLET.test(text)) continue;
    const query = shortenForSearch(text);
    items.push({
      key: `narrative:${norm(text)}`,
      name: query,
      kind: currentKind,
      // Always keep the original Plan bullet for the italic quote under the search row.
      note: text,
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

/** Dismissed / matched checkout-prep rows — per encounter, localStorage so leaving
 * the browser and coming back does not resurrect items the doctor already cleared. */
const RESOLVED_KEY_PREFIX = 'soap-checkout-prep-resolved:';

function readResolvedKeys(encounterId: string): Set<string> {
  try {
    const token = `${RESOLVED_KEY_PREFIX}${encounterId}`;
    const raw =
      localStorage.getItem(token) ??
      // Migrate dismissals from the short-lived session key used briefly earlier.
      sessionStorage.getItem(token);
    if (raw && !localStorage.getItem(token)) {
      localStorage.setItem(token, raw);
      sessionStorage.removeItem(token);
    }
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return new Set(
      Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
    );
  } catch {
    return new Set();
  }
}

function writeResolvedKeys(encounterId: string, keys: Set<string>): void {
  try {
    const token = `${RESOLVED_KEY_PREFIX}${encounterId}`;
    if (keys.size === 0) localStorage.removeItem(token);
    else localStorage.setItem(token, JSON.stringify([...keys]));
  } catch {
    /* private mode / quota */
  }
}

/**
 * Checkout prep: match transcript / Plan mentions to catalog charges. Not part of the signed
 * SOAP — lives on its own tab after Plan. Resolving a row creates the same priced, accepted
 * order as a manual search pick. "+ Add item" covers anything the transcript missed; freeform
 * text that isn't a charge can be declined or parked as a callback / reminder draft.
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
  onPendingCountChange,
}: Props) {
  const [resolvedKeys, setResolvedKeys] = useState<Set<string>>(() =>
    readResolvedKeys(encounterId),
  );
  const [extraRows, setExtraRows] = useState<string[]>([]);

  // Household pet switch remounts this with a new encounter id — reload that chart's dismissals.
  useEffect(() => {
    setResolvedKeys(readResolvedKeys(encounterId));
    setExtraRows([]);
  }, [encounterId]);

  const markResolved = (key: string) => {
    setResolvedKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev).add(key);
      writeResolvedKeys(encounterId, next);
      return next;
    });
  };

  const mergedSuggestions = useMemo(() => {
    const existingOrderNames = orders.map((o) => norm(o.name));
    const narrativeItems = extractPlanNarrativeItems(planNotes).filter(
      (n) => !matchesExistingOrder(n.name, existingOrderNames)
    );
    const seen = new Set(suggestions.map((s) => norm(s.name)));
    const extra = narrativeItems.filter((n) => {
      if (seen.has(norm(n.name))) return false;
      seen.add(norm(n.name));
      return true;
    });
    const transcriptRows = suggestions.filter(
      (s) => !matchesExistingOrder(s.name, existingOrderNames)
    );
    return [...transcriptRows, ...extra];
  }, [suggestions, planNotes, orders]);

  const suggestedRows = mergedSuggestions.filter((s) => !resolvedKeys.has(s.key));

  useEffect(() => {
    onPendingCountChange?.(disabled ? 0 : suggestedRows.length);
  }, [disabled, suggestedRows.length, onPendingCountChange]);

  if (disabled) return null;

  const hasAnyRows = suggestedRows.length > 0 || extraRows.length > 0;

  return (
    <div className="soap-scribe-planitems">
      <div className="soap-scribe-planitems-head">
        <span>Match charges from today</span>
        {suggestedRows.length > 0 && (
          <span className="soap-scribe-tag">{suggestedRows.length} open</span>
        )}
      </div>
      <p className="soap-scribe-planitems-hint">
        Optional checkout prep — not part of the signed medical record. Match a catalog item to
        charge, or mark it Declined. Add Callback creates a task now; Add Reminder waits until
        wrap-up.
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
              existingOrders={orders}
              onAdded={(order, meta) => {
                onOrderAdded(order, meta);
                onInvoiceShouldRefresh();
                markResolved(s.key);
              }}
              onResolved={() => markResolved(s.key)}
              onDismiss={() => markResolved(s.key)}
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
              existingOrders={orders}
              onAdded={(order, meta) => {
                onOrderAdded(order, meta);
                onInvoiceShouldRefresh();
                setExtraRows((prev) => prev.filter((k) => k !== key));
              }}
              onResolved={() => setExtraRows((prev) => prev.filter((k) => k !== key))}
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
  existingOrders,
  onAdded,
  onResolved,
  onDismiss,
}: {
  initialQuery: string;
  note: string | null;
  placeholder: string;
  encounterId: string;
  patientId?: number;
  clientId?: number;
  practiceId: number;
  existingOrders: EncounterOrder[];
  onAdded: (
    order: EncounterOrder,
    meta?: { isVaccine?: boolean; skipPlanNarrative?: boolean }
  ) => void;
  onResolved: () => void;
  onDismiss: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchableItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Only open catalog / Add to for the row currently focused — not every seeded row at once.
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [compose, setCompose] = useState<null | 'callback' | 'reminder'>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) {
      if (!open) setResults([]);
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
  }, [open, query, practiceId, patientId, clientId]);

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
      const isVaccine = isVaccineSearchItem(item);
      onAdded(order, { isVaccine });
      try {
        const sharps = await ensureSharpsFeeOrder({
          encounterId,
          practiceId,
          patientId,
          clientId,
          existingOrders: [...existingOrders, order],
          triggerItem: item,
        });
        if (sharps) onAdded(sharps, { skipPlanNarrative: true });
      } catch {
        /* Sharps is best-effort — the vaccine/injection still charges. */
      }
    } finally {
      setAdding(false);
    }
  };

  const label = query.trim() || initialQuery.trim();

  const declineItem = async () => {
    if (!label || adding) return;
    const how = await appDeclineHow({
      title: 'Decline this item?',
      itemName: label,
      message: '',
      placeholder: 'Add a note',
    });
    if (!how) return;
    setAdding(true);
    try {
      const order = await createOrder(encounterId, {
        name: label,
        kind: 'treatment',
        state: 'declined',
        qty: 1,
        unitPrice: 0,
        note: how.recordOnChart
          ? how.note.trim() || undefined
          : offRecordDeclineNote(how.note),
      });
      onAdded(order, { skipPlanNarrative: true });
      onResolved();
    } finally {
      setAdding(false);
    }
  };

  const addCallbackDraft = () => {
    if (!label || adding) return;
    setCompose('callback');
  };

  const addReminderDraft = () => {
    if (!label || adding) return;
    setCompose('reminder');
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
          disabled={adding}
        />
        <button
          type="button"
          className="soap-icon-btn soap-scribe-planitem-trash"
          title="Remove this item"
          aria-label="Remove this item"
          disabled={adding}
          onClick={onDismiss}
        >
          <Trash2 size={14} />
        </button>
      </div>
      {note?.trim() && <p className="soap-scribe-planitem-note">&ldquo;{note.trim()}&rdquo;</p>}
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
        </div>
      )}
      <div className="soap-plan-add-to-sections">
        <button
          type="button"
          className="soap-btn small ghost"
          disabled={adding || !label}
          onClick={() => void declineItem()}
        >
          Declined
        </button>
        <button
          type="button"
          className="soap-btn small ghost"
          disabled={adding || !label}
          onClick={addCallbackDraft}
        >
          Add Callback
        </button>
        <button
          type="button"
          className="soap-btn small ghost"
          disabled={adding || !label}
          onClick={addReminderDraft}
        >
          Add Reminder
        </button>
      </div>
      {compose === 'callback' && (
        <CheckoutPrepCallbackForm
          title={label}
          body={note}
          patientId={patientId}
          clientId={clientId}
          disabled={adding}
          onCancel={() => setCompose(null)}
          onSaved={() => {
            setCompose(null);
            onResolved();
          }}
        />
      )}
      {compose === 'reminder' && (
        <AddReminderForm
          patientId={patientId ?? 0}
          initialDescription={label}
          onCancel={() => setCompose(null)}
          onAdd={(extra) => {
            void (async () => {
              setAdding(true);
              try {
                await appendCheckoutPrepDrafts(encounterId, { extra });
                setCompose(null);
                onResolved();
              } finally {
                setAdding(false);
              }
            })();
          }}
        />
      )}
    </div>
  );
}

function defaultCallbackDueLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  d.setHours(10, 0, 0, 0);
  return toDatetimeLocalValue(d.toISOString());
}

function CheckoutPrepCallbackForm({
  title: initialTitle,
  body: initialBody,
  patientId,
  clientId,
  disabled,
  onCancel,
  onSaved,
}: {
  title: string;
  body: string | null;
  patientId?: number;
  clientId?: number;
  disabled?: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody?.trim() ?? '');
  const [dueLocal, setDueLocal] = useState(defaultCallbackDueLocal);
  const [assignee, setAssignee] = useState<number | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [branchIds, setBranchIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      fetchAllEmployees(),
      listPracticeBranches(Number(import.meta.env.VITE_PRACTICE_ID) || 1),
    ])
      .then(([emps, branches]) => {
        setEmployees(emps);
        setBranchIds(branches.map((b) => b.id));
      })
      .catch(() => setError('Could not load staff or branches.'));
  }, []);

  const save = async () => {
    if (!title.trim() || patientId == null) return;
    if (branchIds.length === 0) {
      setError('Could not determine which branch this callback belongs to.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const due = fromDatetimeLocalValue(dueLocal);
      await createTask({
        title: title.trim(),
        body: body.trim() || null,
        kind: 'callback',
        branchIds,
        assignedToEmployeeId: assignee,
        ...(due ? { dueAt: due } : {}),
        links: [
          { entityType: 'patient', entityId: patientId },
          ...(clientId != null ? [{ entityType: 'client' as const, entityId: clientId }] : []),
        ],
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create that callback.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="soap-scribe-planitem-compose">
      {error && <div className="soap-error">{error}</div>}
      <label className="soap-wrapup-cb-field">
        <span>What to say</span>
        <input
          className="soap-input"
          value={title}
          disabled={disabled || saving}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="soap-wrapup-cb-field">
        <span>Notes for whoever calls (optional)</span>
        <textarea
          className="soap-textarea"
          rows={3}
          value={body}
          disabled={disabled || saving}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <div className="soap-wrapup-cb-row">
        <label className="soap-wrapup-cb-field">
          <span>Who calls</span>
          <select
            className="soap-select"
            value={assignee ?? ''}
            disabled={disabled || saving}
            onChange={(e) => setAssignee(Number(e.target.value) || null)}
          >
            <option value="">Queue (unassigned)</option>
            {employees.map((em) => (
              <option key={em.id} value={em.id}>
                {formatEmployeeDisplayName(em) || em.email}
              </option>
            ))}
          </select>
        </label>
        <label className="soap-wrapup-cb-field">
          <span>Call by</span>
          <input
            type="datetime-local"
            className="soap-input"
            value={dueLocal}
            disabled={disabled || saving}
            onChange={(e) => setDueLocal(e.target.value)}
          />
        </label>
      </div>
      <div className="soap-wrapup-cb-actions">
        <button type="button" className="soap-btn ghost" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="soap-btn"
          disabled={disabled || saving || !title.trim() || patientId == null}
          onClick={() => void save()}
        >
          {saving ? 'Creating…' : 'Create callback'}
        </button>
      </div>
    </div>
  );
}
