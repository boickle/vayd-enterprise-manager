import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  History,
  Layers,
  Plus,
  Search,
  Shuffle,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  applyBundleToExistingMemberships,
  archiveBundle,
  createBundle,
  getBundle,
  getBundleAudit,
  listBundles,
  updateBundle,
  type Bundle,
  type BundleFields,
  type BundleGroup,
  type BundleGroupInput,
  type BundleItem,
  type BundleItemInput,
  type GroupSelectionMode,
  type ItemCoverage,
  type MembershipAuditEntry,
  type MembershipItemType,
  type PropagationResult,
} from '../../api/memberships';
import { searchItems, type SearchableItem } from '../../api/roomLoader';
import { getToken } from '../../api/http';
import { resolvePracticeIdFromToken } from '../../utils/practiceIdFromToken';
import { appAlert, appConfirm } from '../../utils/appDialog';
import './SettingsMemberships.css';

/** Matches how the memberships client resolves it, so search and writes agree. */
const PRACTICE_ID = resolvePracticeIdFromToken(getToken());

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string | string[] } }; message?: string };
  const msg = e?.response?.data?.message ?? e?.message ?? 'Could not save this plan.';
  return Array.isArray(msg) ? msg.join(', ') : String(msg);
}

const ITEM_TYPE_LABELS: Record<MembershipItemType, string> = {
  lab: 'Lab',
  procedure: 'Service',
  inventory: 'Product',
};

const COVERAGE_LABELS: Record<ItemCoverage, string> = {
  included: 'Included, no charge',
  copay: 'Member copay',
  percent_off: 'Percent off catalog',
};

const COVERAGE_ORDER: ItemCoverage[] = ['included', 'copay', 'percent_off'];

/* ------------------------------------------------------------------ drafts */

type ItemDraft = {
  key: string;
  id?: number;
  itemType: MembershipItemType;
  catalogItemId: number;
  name: string;
  code: string | null;
  catalogPrice: number | null;
  quantity: string;
  coverage: ItemCoverage;
  copayPrice: string;
  percentOff: string;
  note: string;
};

type GroupDraft = {
  key: string;
  id?: number;
  name: string;
  description: string;
  selectionMode: GroupSelectionMode;
  allowedQuantity: string;
  items: ItemDraft[];
};

type PlanDraft = {
  name: string;
  code: string;
  description: string;
  marketingSummary: string;
  species: string;
  tier: string;
  minAgeMonths: string;
  maxAgeMonths: string;
  priceMonthly: string;
  priceAnnual: string;
  outOfPlanDiscount: string;
  renewalMonths: string;
  isAutoRenew: boolean;
  isActive: boolean;
  stripeProductId: string;
  stripeMonthlyPriceId: string;
  stripeAnnualPriceId: string;
  portalSlug: string;
  sortOrder: string;
};

let keySeed = 0;
function nextKey(prefix: string): string {
  keySeed += 1;
  return `${prefix}-${keySeed}`;
}

function text(value: string | null | undefined): string {
  return value == null ? '' : String(value);
}

function numText(value: number | null | undefined): string {
  return value == null ? '' : String(value);
}

function numOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function intOr(value: string, fallback: number): number {
  const parsed = numOrNull(value);
  if (parsed == null) return fallback;
  return Math.max(0, Math.round(parsed));
}

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return `$${Number(value).toFixed(2)}`;
}

function emptyPlanDraft(): PlanDraft {
  return {
    name: '',
    code: '',
    description: '',
    marketingSummary: '',
    species: '',
    tier: '',
    minAgeMonths: '',
    maxAgeMonths: '',
    priceMonthly: '',
    priceAnnual: '',
    outOfPlanDiscount: '',
    renewalMonths: '12',
    isAutoRenew: true,
    isActive: true,
    stripeProductId: '',
    stripeMonthlyPriceId: '',
    stripeAnnualPriceId: '',
    portalSlug: '',
    sortOrder: '',
  };
}

function planDraftFrom(bundle: Bundle): PlanDraft {
  return {
    name: bundle.name,
    code: text(bundle.code),
    description: text(bundle.description),
    marketingSummary: text(bundle.marketingSummary),
    species: text(bundle.species),
    tier: text(bundle.tier),
    minAgeMonths: numText(bundle.minAgeMonths),
    maxAgeMonths: numText(bundle.maxAgeMonths),
    priceMonthly: numText(bundle.priceMonthly),
    priceAnnual: numText(bundle.priceAnnual),
    outOfPlanDiscount: numText(bundle.outOfPlanDiscount),
    renewalMonths: numText(bundle.renewalMonths),
    isAutoRenew: bundle.isAutoRenew === true,
    isActive: bundle.isActive !== false,
    stripeProductId: text(bundle.stripeProductId),
    stripeMonthlyPriceId: text(bundle.stripeMonthlyPriceId),
    stripeAnnualPriceId: text(bundle.stripeAnnualPriceId),
    portalSlug: text(bundle.portalSlug),
    sortOrder: numText(bundle.sortOrder),
  };
}

function itemDraftFrom(item: BundleItem): ItemDraft {
  return {
    key: nextKey('item'),
    id: item.id,
    itemType: item.itemType,
    catalogItemId: item.catalogItemId,
    name: item.name,
    code: item.code,
    catalogPrice: item.catalogPrice,
    quantity: numText(item.quantity) || '1',
    coverage: item.coverage,
    copayPrice: numText(item.copayPrice),
    percentOff: numText(item.percentOff),
    note: text(item.note),
  };
}

function groupDraftFrom(group: BundleGroup): GroupDraft {
  return {
    key: nextKey('group'),
    id: group.id,
    name: group.name,
    description: text(group.description),
    selectionMode: group.selectionMode,
    allowedQuantity: numText(group.allowedQuantity) || '1',
    items: [...group.items].sort((a, b) => a.sortOrder - b.sortOrder).map(itemDraftFrom),
  };
}

function groupDraftsFrom(bundle: Bundle): GroupDraft[] {
  return [...(bundle.groups ?? [])].sort((a, b) => a.sortOrder - b.sortOrder).map(groupDraftFrom);
}

function planFieldsFrom(draft: PlanDraft): BundleFields & { name: string } {
  return {
    name: draft.name.trim(),
    code: draft.code.trim() || null,
    description: draft.description.trim() || null,
    marketingSummary: draft.marketingSummary.trim() || null,
    species: draft.species.trim() || null,
    tier: draft.tier.trim() || null,
    minAgeMonths: numOrNull(draft.minAgeMonths),
    maxAgeMonths: numOrNull(draft.maxAgeMonths),
    priceMonthly: numOrNull(draft.priceMonthly),
    priceAnnual: numOrNull(draft.priceAnnual),
    outOfPlanDiscount: numOrNull(draft.outOfPlanDiscount),
    renewalMonths: numOrNull(draft.renewalMonths),
    isAutoRenew: draft.isAutoRenew,
    isActive: draft.isActive,
    stripeProductId: draft.stripeProductId.trim() || null,
    stripeMonthlyPriceId: draft.stripeMonthlyPriceId.trim() || null,
    stripeAnnualPriceId: draft.stripeAnnualPriceId.trim() || null,
    portalSlug: draft.portalSlug.trim() || null,
    ...(draft.sortOrder.trim() === '' ? {} : { sortOrder: intOr(draft.sortOrder, 0) }),
  };
}

function groupInputsFrom(groups: GroupDraft[]): BundleGroupInput[] {
  return groups.map((group, groupIndex) => ({
    ...(group.id == null ? {} : { id: group.id }),
    name: group.name.trim(),
    description: group.description.trim() || null,
    selectionMode: group.selectionMode,
    allowedQuantity: group.selectionMode === 'choice' ? intOr(group.allowedQuantity, 1) : 1,
    sortOrder: groupIndex,
    items: group.items.map(
      (item, itemIndex): BundleItemInput => ({
        ...(item.id == null ? {} : { id: item.id }),
        itemType: item.itemType,
        catalogItemId: item.catalogItemId,
        quantity: group.selectionMode === 'choice' ? 1 : intOr(item.quantity, 1),
        coverage: item.coverage,
        copayPrice: item.coverage === 'copay' ? numOrNull(item.copayPrice) : null,
        percentOff: item.coverage === 'percent_off' ? numOrNull(item.percentOff) : null,
        sortOrder: itemIndex,
        note: item.note.trim() || null,
      })
    ),
  }));
}

/** Client-side mirror of the API rules so staff get the message before a 400. */
function validate(draft: PlanDraft, groups: GroupDraft[]): string | null {
  if (!draft.name.trim()) return 'Give the plan a name.';

  for (const [index, group] of groups.entries()) {
    const label = group.name.trim() || `Group ${index + 1}`;
    if (!group.name.trim()) return `Name group ${index + 1}.`;
    if (group.items.length === 0) return `${label} has no items yet.`;
    if (group.selectionMode === 'choice' && group.items.length < 2) {
      return `${label} is an "either / or" group, so it needs at least two alternatives for the member to pick between.`;
    }
    if (group.selectionMode === 'choice' && intOr(group.allowedQuantity, 0) < 1) {
      return `${label} needs a shared allowance of at least 1.`;
    }
    for (const item of group.items) {
      if (!Number.isFinite(item.catalogItemId) || item.catalogItemId <= 0) {
        return `${label} has a line with no catalog item picked.`;
      }
      if (item.coverage === 'copay' && numOrNull(item.copayPrice) == null) {
        return `${item.name} in ${label} needs a copay amount.`;
      }
      if (item.coverage === 'percent_off') {
        const pct = numOrNull(item.percentOff);
        if (pct == null || pct <= 0 || pct > 100) {
          return `${item.name} in ${label} needs a percent off between 1 and 100.`;
        }
      }
    }
  }

  const seen = new Set<string>();
  for (const group of groups) {
    for (const item of group.items) {
      const dedupe = `${group.key}:${item.itemType}:${item.catalogItemId}`;
      if (seen.has(dedupe)) {
        return `${item.name} is listed twice in ${group.name.trim() || 'the same group'}.`;
      }
      seen.add(dedupe);
    }
  }
  return null;
}

function propagationSummary(result: PropagationResult, planName: string): string {
  const parts = [
    `${result.benefitsAdded} added`,
    `${result.benefitsUpdated} updated`,
    `${result.benefitsRemoved} removed`,
    `${result.groupsSynced} group${result.groupsSynced === 1 ? '' : 's'} synced`,
  ];
  return (
    `Applied ${planName} to ${result.membershipsUpdated} ` +
    `membership${result.membershipsUpdated === 1 ? '' : 's'} — benefits: ${parts.join(', ')}.`
  );
}

function formatAuditDate(value: string | null): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function catalogPickFrom(row: SearchableItem): ItemDraft | null {
  const itemType: MembershipItemType =
    row.itemType === 'lab' ? 'lab' : row.itemType === 'inventory' ? 'inventory' : 'procedure';
  const raw =
    itemType === 'lab'
      ? row.lab?.id
      : itemType === 'inventory'
        ? row.inventoryItem?.id
        : row.procedure?.id;
  const catalogItemId = Number(raw);
  if (!Number.isFinite(catalogItemId) || catalogItemId <= 0) return null;
  const price = Number(row.originalPrice ?? row.price);
  return {
    key: nextKey('item'),
    itemType,
    catalogItemId,
    name: row.name || `${ITEM_TYPE_LABELS[itemType]} #${catalogItemId}`,
    code: row.code ?? null,
    catalogPrice: Number.isFinite(price) ? price : null,
    quantity: '1',
    coverage: 'included',
    copayPrice: '',
    percentOff: '',
    note: '',
  };
}

/* ------------------------------------------------------------ item picker */

function CatalogItemPicker({
  onPick,
  onClose,
}: {
  onPick: (item: ItemDraft) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchableItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSearching(false);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    setFailed(false);
    const handle = window.setTimeout(() => {
      void searchItems({ q, practiceId: PRACTICE_ID, limit: 12 })
        .then((rows) => {
          if (!cancelled) setHits(Array.isArray(rows) ? rows : []);
        })
        .catch(() => {
          if (cancelled) return;
          setHits([]);
          setFailed(true);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query]);

  return (
    <div className="memberships-picker">
      <div className="memberships-picker__field">
        <Search size={14} aria-hidden />
        <input
          ref={inputRef}
          className="settings-input memberships-picker__input"
          value={query}
          placeholder="Search labs, services, and products…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
          }}
        />
        <button type="button" className="btn-link" onClick={onClose} aria-label="Close item search">
          <X size={14} aria-hidden />
        </button>
      </div>
      {query.trim().length < 2 ? (
        <p className="settings-muted memberships-picker__hint">Type at least two letters.</p>
      ) : searching ? (
        <p className="settings-muted memberships-picker__hint">Searching…</p>
      ) : failed ? (
        <p className="memberships-picker__hint memberships-error">
          Catalog search is not responding.
        </p>
      ) : hits.length === 0 ? (
        <p className="settings-muted memberships-picker__hint">
          Nothing in the catalog matches that.
        </p>
      ) : (
        <ul className="memberships-picker__results">
          {hits.map((row, index) => {
            const draft = catalogPickFrom(row);
            if (!draft) return null;
            return (
              <li key={`${draft.itemType}-${draft.catalogItemId}-${index}`}>
                <button
                  type="button"
                  className="memberships-picker__result"
                  onClick={() => onPick(draft)}
                >
                  <span className="memberships-picker__result-name">{draft.name}</span>
                  <span className="settings-muted memberships-picker__result-meta">
                    {ITEM_TYPE_LABELS[draft.itemType]}
                    {draft.code ? ` · ${draft.code}` : ''}
                    {draft.catalogPrice == null ? '' : ` · ${money(draft.catalogPrice)}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ screen */

type Props = {
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
};

type Selection = { mode: 'new' } | { mode: 'plan'; id: number } | null;

export default function SettingsMemberships({ onMessage }: Props) {
  const [plans, setPlans] = useState<Bundle[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const [selection, setSelection] = useState<Selection>(null);
  const [detail, setDetail] = useState<Bundle | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [planDraft, setPlanDraft] = useState<PlanDraft>(emptyPlanDraft());
  const [groups, setGroups] = useState<GroupDraft[]>([]);
  const [pickerGroupKey, setPickerGroupKey] = useState<string | null>(null);

  const [applyToExisting, setApplyToExisting] = useState(false);
  const [removeDropped, setRemoveDropped] = useState(false);
  const [saving, setSaving] = useState(false);

  const [auditOpen, setAuditOpen] = useState(false);
  const [audit, setAudit] = useState<MembershipAuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  const loadAudit = useCallback(async (id: number) => {
    setAuditLoading(true);
    setAuditError(null);
    try {
      setAudit(await getBundleAudit(id));
    } catch (e) {
      setAudit([]);
      setAuditError(extractErr(e));
    } finally {
      setAuditLoading(false);
    }
  }, []);

  const loadPlans = useCallback(async (includeArchived: boolean) => {
    setListLoading(true);
    try {
      setPlans(await listBundles({ kind: 'membership', includeArchived }));
      setListError(null);
    } catch (e) {
      setListError(extractErr(e));
      setPlans([]);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlans(showArchived);
  }, [loadPlans, showArchived]);

  const selectedId = selection?.mode === 'plan' ? selection.id : null;

  useEffect(() => {
    if (selectedId == null) return;
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    setAuditOpen(false);
    setApplyToExisting(false);
    setRemoveDropped(false);
    void getBundle(selectedId)
      .then((bundle) => {
        if (cancelled) return;
        setDetail(bundle);
        setPlanDraft(planDraftFrom(bundle));
        setGroups(groupDraftsFrom(bundle));
      })
      .catch((e) => {
        if (cancelled) return;
        setDetail(null);
        setDetailError(extractErr(e));
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const visiblePlans = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = q
      ? plans.filter((plan) =>
          [plan.name, plan.code, plan.species, plan.tier, plan.description]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(q))
        )
      : plans;
    return [...rows].sort(
      (a, b) =>
        Number(a.isArchived) - Number(b.isArchived) ||
        a.sortOrder - b.sortOrder ||
        a.name.localeCompare(b.name)
    );
  }, [plans, search]);

  function startNewPlan() {
    setSelection({ mode: 'new' });
    setDetail(null);
    setDetailError(null);
    setPlanDraft(emptyPlanDraft());
    setGroups([]);
    setPickerGroupKey(null);
    setApplyToExisting(false);
    setRemoveDropped(false);
    setAuditOpen(false);
  }

  function setField<K extends keyof PlanDraft>(key: K, value: PlanDraft[K]) {
    setPlanDraft((cur) => ({ ...cur, [key]: value }));
  }

  function updateGroup(key: string, patch: Partial<GroupDraft>) {
    setGroups((cur) => cur.map((group) => (group.key === key ? { ...group, ...patch } : group)));
  }

  function updateItem(groupKey: string, itemKey: string, patch: Partial<ItemDraft>) {
    setGroups((cur) =>
      cur.map((group) =>
        group.key === groupKey
          ? {
              ...group,
              items: group.items.map((item) =>
                item.key === itemKey ? { ...item, ...patch } : item
              ),
            }
          : group
      )
    );
  }

  function addGroup(selectionMode: GroupSelectionMode) {
    const group: GroupDraft = {
      key: nextKey('group'),
      name: '',
      description: '',
      selectionMode,
      allowedQuantity: '1',
      items: [],
    };
    setGroups((cur) => [...cur, group]);
    setPickerGroupKey(group.key);
  }

  async function removeGroup(group: GroupDraft) {
    const label = group.name.trim() || 'this group';
    const ok = await appConfirm({
      title: `Remove ${label}?`,
      message:
        'The group and its items come off the plan. Nothing changes for patients already on the plan until you apply the plan to existing memberships.',
      confirmLabel: 'Remove group',
      danger: true,
    });
    if (!ok) return;
    setGroups((cur) => cur.filter((g) => g.key !== group.key));
  }

  function moveGroup(index: number, delta: number) {
    setGroups((cur) => {
      const next = [...cur];
      const target = index + delta;
      if (target < 0 || target >= next.length) return cur;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function moveItem(groupKey: string, index: number, delta: number) {
    setGroups((cur) =>
      cur.map((group) => {
        if (group.key !== groupKey) return group;
        const items = [...group.items];
        const target = index + delta;
        if (target < 0 || target >= items.length) return group;
        [items[index], items[target]] = [items[target], items[index]];
        return { ...group, items };
      })
    );
  }

  function pickItem(groupKey: string, item: ItemDraft) {
    setGroups((cur) =>
      cur.map((group) =>
        group.key === groupKey ? { ...group, items: [...group.items, item] } : group
      )
    );
  }

  function removeItem(groupKey: string, itemKey: string) {
    setGroups((cur) =>
      cur.map((group) =>
        group.key === groupKey
          ? { ...group, items: group.items.filter((item) => item.key !== itemKey) }
          : group
      )
    );
  }

  function absorbSaved(bundle: Bundle) {
    setDetail(bundle);
    setPlanDraft(planDraftFrom(bundle));
    setGroups(groupDraftsFrom(bundle));
    setPlans((cur) => {
      const exists = cur.some((plan) => plan.id === bundle.id);
      return exists ? cur.map((plan) => (plan.id === bundle.id ? bundle : plan)) : [...cur, bundle];
    });
  }

  async function save() {
    const problem = validate(planDraft, groups);
    if (problem) {
      onMessage?.(problem, 'error');
      return;
    }
    const fields = planFieldsFrom(planDraft);
    const groupInputs = groupInputsFrom(groups);

    if (selection?.mode === 'new') {
      setSaving(true);
      try {
        const created = await createBundle('membership', fields, groupInputs);
        setSelection({ mode: 'plan', id: created.id });
        absorbSaved(created);
        onMessage?.(`Created ${created.name}.`, 'success');
      } catch (e) {
        onMessage?.(extractErr(e), 'error');
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!detail) return;

    if (applyToExisting) {
      const members = detail.activeMemberCount;
      const ok = await appConfirm({
        title: `Apply this to all current ${detail.name} memberships?`,
        message:
          `${members} patient${members === 1 ? ' is' : 's are'} on ${detail.name} right now. ` +
          'Saving will push the plan onto every one of them.' +
          (removeDropped
            ? ` Because "remove benefits that are no longer on the plan" is on, benefits you took off the plan will also be taken away from those ${members} patient${members === 1 ? '' : 's'}. This cannot be undone.`
            : ' Benefits you removed from the plan stay on those patients; only additions and changes are pushed.'),
        confirmLabel: `Save and apply to ${members} membership${members === 1 ? '' : 's'}`,
        danger: removeDropped,
      });
      if (!ok) return;
    }

    setSaving(true);
    try {
      const saved = await updateBundle(detail.id, fields, {
        groups: groupInputs,
        ...(applyToExisting
          ? { applyToExistingMemberships: true, removeBenefitsDroppedFromPlan: removeDropped }
          : {}),
      });
      absorbSaved(saved);
      const propagation = saved.propagation;
      onMessage?.(
        propagation
          ? `Saved ${saved.name}. ${propagationSummary(propagation, saved.name)}`
          : `Saved ${saved.name}.`,
        'success'
      );
      if (auditOpen) void loadAudit(saved.id);
    } catch (e) {
      onMessage?.(extractErr(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function applyOnly() {
    if (!detail) return;
    const members = detail.activeMemberCount;
    const ok = await appConfirm({
      title: `Apply ${detail.name} to all current memberships?`,
      message:
        `${members} patient${members === 1 ? ' is' : 's are'} on ${detail.name} right now. ` +
        'The saved plan will be pushed onto every one of them. Unsaved edits on this screen are not included.' +
        (removeDropped
          ? ' Benefits that are no longer on the plan will also be taken away from those patients. This cannot be undone.'
          : ''),
      confirmLabel: `Apply to ${members} membership${members === 1 ? '' : 's'}`,
      danger: removeDropped,
    });
    if (!ok) return;
    setSaving(true);
    try {
      const result = await applyBundleToExistingMemberships(detail.id, {
        removeBenefitsDroppedFromPlan: removeDropped,
      });
      onMessage?.(propagationSummary(result, detail.name), 'success');
      if (auditOpen) void loadAudit(detail.id);
    } catch (e) {
      onMessage?.(extractErr(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!detail) return;
    const members = detail.activeMemberCount;
    const ok = await appConfirm({
      title: `Archive ${detail.name}?`,
      message:
        'Archiving takes the plan off the list staff and the portal can enrol into. ' +
        (members > 0
          ? `The ${members} patient${members === 1 ? '' : 's'} already on it keep their benefits.`
          : 'No one is enrolled on it right now.'),
      confirmLabel: 'Archive plan',
      danger: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      await archiveBundle(detail.id);
      onMessage?.(`Archived ${detail.name}.`, 'success');
      setSelection(null);
      setDetail(null);
      await loadPlans(showArchived);
    } catch (e) {
      onMessage?.(extractErr(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function restore() {
    if (!detail) return;
    setSaving(true);
    try {
      const saved = await updateBundle(detail.id, { isArchived: false, isActive: true });
      absorbSaved(saved);
      onMessage?.(`${saved.name} is back on the list.`, 'success');
      await loadPlans(showArchived);
    } catch (e) {
      onMessage?.(extractErr(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  function toggleAudit() {
    const next = !auditOpen;
    setAuditOpen(next);
    if (next && detail) void loadAudit(detail.id);
  }

  async function explainChoiceGroups() {
    await appAlert({
      title: 'Either / or groups',
      message:
        'A "member picks one" group holds alternatives that share a single allowance. ' +
        'If the shared allowance is 1 and the group holds a heartworm test and a tick panel, ' +
        'the member gets one of the two on the plan — taking either one uses up the allowance. ' +
        'Put things the member always gets in an "everything listed" group instead.',
      confirmLabel: 'Got it',
    });
  }

  const isNew = selection?.mode === 'new';
  const editing = isNew || detail != null;

  return (
    <div className="settings-section memberships">
      <h2 className="settings-section-title">Memberships</h2>
      <p className="settings-section-description">
        Wellness plans patients subscribe to. Each plan is a set of groups: an{' '}
        <strong>everything listed</strong> group is what the member always gets, and a{' '}
        <strong>member picks one</strong> group holds alternatives that share one allowance — this
        lab <em>or</em> that lab. Edits here only reach patients already on a plan when you apply
        the plan to existing memberships.
      </p>

      <div className="memberships-layout">
        <div className="settings-card memberships-rail">
          <div className="memberships-rail__head">
            <h3 className="settings-card-title memberships-rail__title">Plans</h3>
            <button
              type="button"
              className="btn primary memberships-rail__new"
              onClick={startNewPlan}
            >
              <Plus size={14} aria-hidden /> New plan
            </button>
          </div>

          <input
            className="settings-input memberships-rail__search"
            value={search}
            placeholder="Search plans…"
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="settings-checkbox-item memberships-rail__toggle">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>

          {listError ? (
            <p className="settings-message settings-error-message">{listError}</p>
          ) : null}

          {listLoading ? (
            <p className="settings-muted">Loading plans…</p>
          ) : visiblePlans.length === 0 ? (
            <p className="settings-muted">
              {plans.length === 0
                ? 'No membership plans yet. Start one with New plan.'
                : 'No plans match that search.'}
            </p>
          ) : (
            <ul className="memberships-rail__list">
              {visiblePlans.map((plan) => (
                <li key={plan.id}>
                  <button
                    type="button"
                    className={`memberships-rail__item${plan.id === selectedId ? ' is-selected' : ''}${
                      plan.isArchived ? ' is-archived' : ''
                    }`}
                    onClick={() => setSelection({ mode: 'plan', id: plan.id })}
                  >
                    <span className="memberships-rail__item-name">
                      {plan.name}
                      {plan.isArchived ? (
                        <span className="memberships-badge memberships-badge--archived">
                          Archived
                        </span>
                      ) : null}
                    </span>
                    <span className="settings-muted memberships-rail__item-meta">
                      {[plan.species, plan.tier].filter(Boolean).join(' · ') || 'Any species'}
                    </span>
                    <span className="memberships-rail__item-prices">
                      {plan.priceMonthly == null ? '—' : `${money(plan.priceMonthly)}/mo`}
                      {plan.priceAnnual == null ? '' : ` · ${money(plan.priceAnnual)}/yr`}
                    </span>
                    <span className="memberships-rail__item-members">
                      <Users size={12} aria-hidden /> {plan.activeMemberCount} member
                      {plan.activeMemberCount === 1 ? '' : 's'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="memberships-detail">
          {detailError ? (
            <p className="settings-message settings-error-message">{detailError}</p>
          ) : null}

          {!editing ? (
            <div className="settings-card memberships-empty">
              <Layers size={22} aria-hidden />
              <p className="settings-muted">
                Pick a plan on the left to edit its fields and benefits, or start a new one.
              </p>
            </div>
          ) : detailLoading ? (
            <div className="settings-card">
              <p className="settings-muted">Loading plan…</p>
            </div>
          ) : (
            <>
              <div className="settings-card">
                <div className="memberships-detail__head">
                  <div>
                    <h3 className="settings-card-title memberships-detail__title">
                      {isNew ? 'New membership plan' : detail?.name}
                      {detail?.isScoutManaged ? (
                        <span
                          className="memberships-badge memberships-badge--scout"
                          title="Edited in Scout after the last eVet sync. The eVet import will not overwrite this plan unless eVet changes more recently."
                        >
                          Managed in Scout
                        </span>
                      ) : null}
                      {detail?.isArchived ? (
                        <span className="memberships-badge memberships-badge--archived">
                          Archived
                        </span>
                      ) : null}
                    </h3>
                    {detail ? (
                      <p className="settings-muted memberships-detail__sub">
                        <Users size={13} aria-hidden /> {detail.activeMemberCount} active member
                        {detail.activeMemberCount === 1 ? '' : 's'}
                        {detail.code ? ` · code ${detail.code}` : ''}
                      </p>
                    ) : null}
                  </div>
                  {detail ? (
                    detail.isArchived ? (
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={saving}
                        onClick={() => void restore()}
                      >
                        Restore plan
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={saving}
                        onClick={() => void archive()}
                      >
                        <Trash2 size={13} aria-hidden /> Archive
                      </button>
                    )
                  ) : null}
                </div>

                <div className="memberships-fields">
                  <label className="settings-label memberships-fields__wide">
                    Plan name *
                    <input
                      className="settings-input"
                      value={planDraft.name}
                      placeholder="Foundations Wellness"
                      onChange={(e) => setField('name', e.target.value)}
                    />
                  </label>
                  <label className="settings-label">
                    Code
                    <input
                      className="settings-input"
                      value={planDraft.code}
                      onChange={(e) => setField('code', e.target.value)}
                    />
                  </label>
                  <label className="settings-label">
                    Species
                    <input
                      className="settings-input"
                      value={planDraft.species}
                      placeholder="Canine"
                      onChange={(e) => setField('species', e.target.value)}
                    />
                  </label>
                  <label className="settings-label">
                    Tier
                    <input
                      className="settings-input"
                      value={planDraft.tier}
                      placeholder="Plus"
                      onChange={(e) => setField('tier', e.target.value)}
                    />
                  </label>
                  <label className="settings-label">
                    Monthly price
                    <input
                      className="settings-input"
                      type="number"
                      min={0}
                      step={0.01}
                      value={planDraft.priceMonthly}
                      onChange={(e) => setField('priceMonthly', e.target.value)}
                    />
                  </label>
                  <label className="settings-label">
                    Annual price
                    <input
                      className="settings-input"
                      type="number"
                      min={0}
                      step={0.01}
                      value={planDraft.priceAnnual}
                      onChange={(e) => setField('priceAnnual', e.target.value)}
                    />
                  </label>
                  <label className="settings-label">
                    Out-of-plan discount (%)
                    <input
                      className="settings-input"
                      type="number"
                      min={0}
                      max={100}
                      step={0.01}
                      value={planDraft.outOfPlanDiscount}
                      onChange={(e) => setField('outOfPlanDiscount', e.target.value)}
                    />
                  </label>
                  <label className="settings-label">
                    Renewal (months)
                    <input
                      className="settings-input"
                      type="number"
                      min={1}
                      step={1}
                      value={planDraft.renewalMonths}
                      onChange={(e) => setField('renewalMonths', e.target.value)}
                    />
                  </label>
                  <label className="settings-label">
                    Youngest age (months)
                    <input
                      className="settings-input"
                      type="number"
                      min={0}
                      step={1}
                      value={planDraft.minAgeMonths}
                      onChange={(e) => setField('minAgeMonths', e.target.value)}
                    />
                  </label>
                  <label className="settings-label">
                    Oldest age (months)
                    <input
                      className="settings-input"
                      type="number"
                      min={0}
                      step={1}
                      value={planDraft.maxAgeMonths}
                      onChange={(e) => setField('maxAgeMonths', e.target.value)}
                    />
                  </label>
                  <label className="settings-label">
                    Sort order
                    <input
                      className="settings-input"
                      type="number"
                      step={1}
                      value={planDraft.sortOrder}
                      onChange={(e) => setField('sortOrder', e.target.value)}
                    />
                  </label>
                  <label className="settings-label memberships-fields__wide">
                    Staff description
                    <textarea
                      className="settings-input"
                      rows={2}
                      value={planDraft.description}
                      onChange={(e) => setField('description', e.target.value)}
                    />
                  </label>
                  <label className="settings-label memberships-fields__wide">
                    Marketing summary
                    <textarea
                      className="settings-input"
                      rows={2}
                      value={planDraft.marketingSummary}
                      placeholder="What the client sees on the portal."
                      onChange={(e) => setField('marketingSummary', e.target.value)}
                    />
                  </label>
                  <label className="settings-label">
                    Portal slug
                    <input
                      className="settings-input"
                      value={planDraft.portalSlug}
                      placeholder="foundations"
                      onChange={(e) => setField('portalSlug', e.target.value)}
                    />
                  </label>
                  <label className="settings-label">
                    Stripe product ID
                    <input
                      className="settings-input"
                      value={planDraft.stripeProductId}
                      onChange={(e) => setField('stripeProductId', e.target.value)}
                    />
                  </label>
                  <label className="settings-label">
                    Stripe monthly price ID
                    <input
                      className="settings-input"
                      value={planDraft.stripeMonthlyPriceId}
                      onChange={(e) => setField('stripeMonthlyPriceId', e.target.value)}
                    />
                  </label>
                  <label className="settings-label">
                    Stripe annual price ID
                    <input
                      className="settings-input"
                      value={planDraft.stripeAnnualPriceId}
                      onChange={(e) => setField('stripeAnnualPriceId', e.target.value)}
                    />
                  </label>
                </div>

                <div className="memberships-flags">
                  <label className="settings-checkbox-item">
                    <input
                      type="checkbox"
                      checked={planDraft.isAutoRenew}
                      onChange={(e) => setField('isAutoRenew', e.target.checked)}
                    />
                    Renews automatically
                  </label>
                  <label className="settings-checkbox-item">
                    <input
                      type="checkbox"
                      checked={planDraft.isActive}
                      onChange={(e) => setField('isActive', e.target.checked)}
                    />
                    Available to enrol
                  </label>
                </div>
              </div>

              <div className="settings-card">
                <div className="memberships-groups__head">
                  <div>
                    <h3 className="settings-card-title memberships-detail__title">
                      What the plan includes
                    </h3>
                    <p className="settings-muted">
                      Group the benefits the way you would explain them to a client.{' '}
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() => void explainChoiceGroups()}
                      >
                        How do either / or groups work?
                      </button>
                    </p>
                  </div>
                  <div className="memberships-groups__add">
                    <button type="button" className="btn secondary" onClick={() => addGroup('all')}>
                      <Plus size={13} aria-hidden /> Everything listed
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => addGroup('choice')}
                    >
                      <Shuffle size={13} aria-hidden /> Member picks one
                    </button>
                  </div>
                </div>

                {groups.length === 0 ? (
                  <p className="settings-muted memberships-groups__empty">
                    No groups yet. Add an <strong>everything listed</strong> group for the benefits
                    every member gets, or a <strong>member picks one</strong> group for
                    alternatives.
                  </p>
                ) : (
                  <div className="memberships-groups">
                    {groups.map((group, groupIndex) => {
                      const isChoice = group.selectionMode === 'choice';
                      const allowance = intOr(group.allowedQuantity, 1);
                      const tooFewAlternatives = isChoice && group.items.length < 2;
                      return (
                        <section
                          key={group.key}
                          className={`memberships-group${isChoice ? ' memberships-group--choice' : ''}`}
                        >
                          <header className="memberships-group__head">
                            <span
                              className={`memberships-group__mode${
                                isChoice ? ' memberships-group__mode--choice' : ''
                              }`}
                            >
                              {isChoice ? (
                                <>
                                  <Shuffle size={12} aria-hidden /> Member picks {allowance} of
                                  these
                                </>
                              ) : (
                                <>
                                  <Layers size={12} aria-hidden /> Everything listed
                                </>
                              )}
                            </span>
                            <input
                              className="settings-input memberships-group__name"
                              value={group.name}
                              placeholder={isChoice ? 'Annual lab — one of' : 'Core wellness'}
                              onChange={(e) => updateGroup(group.key, { name: e.target.value })}
                            />
                            <div className="memberships-group__tools">
                              <button
                                type="button"
                                className="btn-link"
                                aria-label="Move group up"
                                disabled={groupIndex === 0}
                                onClick={() => moveGroup(groupIndex, -1)}
                              >
                                <ChevronUp size={15} aria-hidden />
                              </button>
                              <button
                                type="button"
                                className="btn-link"
                                aria-label="Move group down"
                                disabled={groupIndex === groups.length - 1}
                                onClick={() => moveGroup(groupIndex, 1)}
                              >
                                <ChevronDown size={15} aria-hidden />
                              </button>
                              <button
                                type="button"
                                className="btn-link"
                                aria-label="Remove group"
                                onClick={() => void removeGroup(group)}
                              >
                                <Trash2 size={14} aria-hidden />
                              </button>
                            </div>
                          </header>

                          <div className="memberships-group__row">
                            <label className="settings-label memberships-group__desc">
                              How staff should read this group
                              <input
                                className="settings-input"
                                value={group.description}
                                placeholder={
                                  isChoice
                                    ? 'Heartworm test or tick panel — whichever the pet needs.'
                                    : 'Included with every membership.'
                                }
                                onChange={(e) =>
                                  updateGroup(group.key, { description: e.target.value })
                                }
                              />
                            </label>
                            <label className="settings-label memberships-group__mode-select">
                              Group behaviour
                              <select
                                className="settings-select"
                                value={group.selectionMode}
                                onChange={(e) =>
                                  updateGroup(group.key, {
                                    selectionMode: e.target.value as GroupSelectionMode,
                                  })
                                }
                              >
                                <option value="all">Everything listed is included</option>
                                <option value="choice">
                                  Member picks from these (either / or)
                                </option>
                              </select>
                            </label>
                            {isChoice ? (
                              <label className="settings-label memberships-group__allowance">
                                Shared allowance
                                <input
                                  className="settings-input"
                                  type="number"
                                  min={1}
                                  step={1}
                                  value={group.allowedQuantity}
                                  onChange={(e) =>
                                    updateGroup(group.key, { allowedQuantity: e.target.value })
                                  }
                                />
                              </label>
                            ) : null}
                          </div>

                          {isChoice ? (
                            <p className="memberships-group__explainer">
                              The member gets <strong>{allowance}</strong> from this group in total
                              — taking any one of the {group.items.length || 0} alternative
                              {group.items.length === 1 ? '' : 's'} below draws down the whole
                              group&rsquo;s allowance.
                            </p>
                          ) : null}

                          {tooFewAlternatives ? (
                            <p className="settings-message settings-error-message memberships-group__warning">
                              An either / or group needs at least two alternatives to pick between.
                            </p>
                          ) : null}

                          {group.items.length === 0 ? (
                            <p className="settings-muted memberships-group__empty">
                              Nothing in this group yet.
                            </p>
                          ) : (
                            <ul className="memberships-items">
                              {group.items.map((item, itemIndex) => (
                                <li key={item.key} className="memberships-item">
                                  {isChoice && itemIndex > 0 ? (
                                    <span className="memberships-item__or" aria-hidden>
                                      or
                                    </span>
                                  ) : null}
                                  <div className="memberships-item__body">
                                    <div className="memberships-item__ident">
                                      <span className="memberships-item__name">{item.name}</span>
                                      <span className="settings-muted memberships-item__meta">
                                        {ITEM_TYPE_LABELS[item.itemType]}
                                        {item.code ? ` · ${item.code}` : ''}
                                        {item.catalogPrice == null
                                          ? ''
                                          : ` · catalog ${money(item.catalogPrice)}`}
                                      </span>
                                    </div>

                                    <div className="memberships-item__controls">
                                      {isChoice ? null : (
                                        <label className="settings-label memberships-item__qty">
                                          Allowance
                                          <input
                                            className="settings-input"
                                            type="number"
                                            min={1}
                                            step={1}
                                            value={item.quantity}
                                            onChange={(e) =>
                                              updateItem(group.key, item.key, {
                                                quantity: e.target.value,
                                              })
                                            }
                                          />
                                        </label>
                                      )}
                                      <label className="settings-label memberships-item__coverage">
                                        Member pays
                                        <select
                                          className="settings-select"
                                          value={item.coverage}
                                          onChange={(e) =>
                                            updateItem(group.key, item.key, {
                                              coverage: e.target.value as ItemCoverage,
                                            })
                                          }
                                        >
                                          {COVERAGE_ORDER.map((coverage) => (
                                            <option key={coverage} value={coverage}>
                                              {COVERAGE_LABELS[coverage]}
                                            </option>
                                          ))}
                                        </select>
                                      </label>
                                      {item.coverage === 'copay' ? (
                                        <label className="settings-label memberships-item__money">
                                          Copay ($)
                                          <input
                                            className="settings-input"
                                            type="number"
                                            min={0}
                                            step={0.01}
                                            value={item.copayPrice}
                                            onChange={(e) =>
                                              updateItem(group.key, item.key, {
                                                copayPrice: e.target.value,
                                              })
                                            }
                                          />
                                        </label>
                                      ) : null}
                                      {item.coverage === 'percent_off' ? (
                                        <label className="settings-label memberships-item__money">
                                          Percent off
                                          <input
                                            className="settings-input"
                                            type="number"
                                            min={1}
                                            max={100}
                                            step={1}
                                            value={item.percentOff}
                                            onChange={(e) =>
                                              updateItem(group.key, item.key, {
                                                percentOff: e.target.value,
                                              })
                                            }
                                          />
                                        </label>
                                      ) : null}
                                    </div>

                                    <div className="memberships-item__tools">
                                      <button
                                        type="button"
                                        className="btn-link"
                                        aria-label="Move item up"
                                        disabled={itemIndex === 0}
                                        onClick={() => moveItem(group.key, itemIndex, -1)}
                                      >
                                        <ChevronUp size={15} aria-hidden />
                                      </button>
                                      <button
                                        type="button"
                                        className="btn-link"
                                        aria-label="Move item down"
                                        disabled={itemIndex === group.items.length - 1}
                                        onClick={() => moveItem(group.key, itemIndex, 1)}
                                      >
                                        <ChevronDown size={15} aria-hidden />
                                      </button>
                                      <button
                                        type="button"
                                        className="btn-link"
                                        aria-label={`Remove ${item.name}`}
                                        onClick={() => removeItem(group.key, item.key)}
                                      >
                                        <X size={15} aria-hidden />
                                      </button>
                                    </div>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}

                          {pickerGroupKey === group.key ? (
                            <CatalogItemPicker
                              onClose={() => setPickerGroupKey(null)}
                              onPick={(item) => pickItem(group.key, item)}
                            />
                          ) : (
                            <button
                              type="button"
                              className="btn secondary memberships-group__add-item"
                              onClick={() => setPickerGroupKey(group.key)}
                            >
                              <Plus size={13} aria-hidden />{' '}
                              {isChoice ? 'Add an alternative' : 'Add an item'}
                            </button>
                          )}
                        </section>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="settings-card">
                {detail ? (
                  <div className="memberships-apply">
                    <label className="settings-checkbox-item">
                      <input
                        type="checkbox"
                        checked={applyToExisting}
                        onChange={(e) => {
                          setApplyToExisting(e.target.checked);
                          if (!e.target.checked) setRemoveDropped(false);
                        }}
                      />
                      Apply this to all current {detail.name} memberships
                    </label>
                    <p className="settings-muted memberships-apply__hint">
                      {detail.activeMemberCount} patient
                      {detail.activeMemberCount === 1 ? '' : 's'} on this plan right now. Leave it
                      off to change the plan template only — new enrolments get the new benefits,
                      current members keep what they have.
                    </p>
                    {applyToExisting ? (
                      <label className="settings-checkbox-item memberships-apply__danger">
                        <input
                          type="checkbox"
                          checked={removeDropped}
                          onChange={(e) => setRemoveDropped(e.target.checked)}
                        />
                        Also take away benefits that are no longer on the plan
                      </label>
                    ) : null}
                    {applyToExisting && removeDropped ? (
                      <p className="memberships-apply__warning">
                        This removes benefits from patients who are already on {detail.name}, even
                        if they have not used them. Leave it off unless you mean to claw something
                        back.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="settings-action-bar memberships-actions">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={saving || !planDraft.name.trim()}
                    onClick={() => void save()}
                  >
                    {saving ? 'Saving…' : isNew ? 'Create plan' : 'Save plan'}
                  </button>
                  {detail ? (
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={saving}
                      onClick={() => void applyOnly()}
                    >
                      Apply saved plan to existing memberships
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={saving}
                    onClick={() => {
                      if (isNew) {
                        setSelection(null);
                        return;
                      }
                      if (detail) {
                        setPlanDraft(planDraftFrom(detail));
                        setGroups(groupDraftsFrom(detail));
                        setPickerGroupKey(null);
                      }
                    }}
                  >
                    {isNew ? 'Cancel' : 'Discard changes'}
                  </button>
                </div>
              </div>

              {detail ? (
                <div className="settings-card">
                  <button
                    type="button"
                    className="btn-link memberships-audit__toggle"
                    onClick={toggleAudit}
                  >
                    {auditOpen ? (
                      <ChevronDown size={15} aria-hidden />
                    ) : (
                      <ChevronRight size={15} aria-hidden />
                    )}
                    <History size={14} aria-hidden /> Change history
                  </button>
                  {auditOpen ? (
                    auditLoading ? (
                      <p className="settings-muted">Loading history…</p>
                    ) : auditError ? (
                      <p className="settings-message settings-error-message">{auditError}</p>
                    ) : audit.length === 0 ? (
                      <p className="settings-muted">Nothing recorded for this plan yet.</p>
                    ) : (
                      <ul className="memberships-audit">
                        {audit.map((entry) => (
                          <li key={entry.id} className="memberships-audit__entry">
                            <span className="memberships-audit__summary">{entry.summary}</span>
                            <span className="settings-muted memberships-audit__meta">
                              {entry.employeeName ?? 'System'}
                              {entry.createdAt ? ` · ${formatAuditDate(entry.createdAt)}` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
