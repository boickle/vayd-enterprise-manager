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
  type ItemProductionBasis,
  type MembershipAuditEntry,
  type MembershipItemType,
  type PropagationResult,
} from '../../api/memberships';
import { searchItems, type SearchableItem } from '../../api/roomLoader';
import { getToken } from '../../api/http';
import {
  getPracticeSettings,
  isOnlineStoreImplemented,
  MEMBERSHIP_ASSIGN_FEE_TO_PROVIDER_KEY,
  MEMBERSHIP_POST_VISIT_SIGNUP_WINDOW_HOURS_DEFAULT,
  MEMBERSHIP_POST_VISIT_SIGNUP_WINDOW_HOURS_KEY,
  membershipAssignFeeToProvider,
  membershipPostVisitSignupWindowHours,
  updatePracticeSettings,
} from '../../api/practiceSettings';
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

const PRODUCTION_BASIS_ORDER: ItemProductionBasis[] = [
  'full_price',
  'membership_price',
  'custom',
];

const PRODUCTION_BASIS_LABELS: Record<ItemProductionBasis, string> = {
  full_price: 'Based on full item price',
  membership_price: 'Based on membership price',
  custom: 'Custom',
};

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
  productionBasis: ItemProductionBasis;
  productionOverride: string;
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
  minAgeYears: string;
  maxAgeYears: string;
  termMonths: string;
  renewalSuccessorPackageId: string;
  ageLimitSuccessorPackageId: string;
  price: string;
  outOfPlanDiscount: string;
  onlineStoreDiscount: string;
  renewalMonths: string;
  isActive: boolean;
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

/** Matches the API sentinel for "every visit gets member pricing". */
const UNLIMITED_ALLOWANCE = -1;
const UNLIMITED_TOKEN = 'unlimited';

function isUnlimitedDraft(value: string | null | undefined): boolean {
  return (value ?? '').trim().toLowerCase() === UNLIMITED_TOKEN;
}

function allowanceDraftText(value: number | null | undefined): string {
  if (value != null && Number.isFinite(Number(value)) && Number(value) < 0) {
    return UNLIMITED_TOKEN;
  }
  return numText(value) || '1';
}

function allowanceFromDraft(value: string, fallback = 1): number {
  if (isUnlimitedDraft(value)) return UNLIMITED_ALLOWANCE;
  const parsed = numOrNull(value);
  if (parsed == null || parsed < 1) return fallback;
  return Math.round(parsed);
}

function idOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

function monthsToYearsText(months: number | null | undefined): string {
  if (months == null) return '';
  return String(Math.round(months / 12));
}

function yearsToMonths(years: string): number | null {
  const parsed = numOrNull(years);
  if (parsed == null) return null;
  return Math.round(parsed * 12);
}

function planCadence(plan: {
  name?: string;
  priceMonthly?: number | null;
  priceAnnual?: number | null;
}): 'monthly' | 'annual' | null {
  if (/\bmonthly\b/i.test(plan.name ?? '')) return 'monthly';
  if (/\b(annual|yearly)\b/i.test(plan.name ?? '')) return 'annual';
  if (plan.priceMonthly != null && plan.priceAnnual == null) return 'monthly';
  if (plan.priceAnnual != null && plan.priceMonthly == null) return 'annual';
  return null;
}

function planCadenceLabel(plan: Bundle): string {
  const cadence = planCadence(plan);
  if (cadence === 'monthly') return 'Monthly';
  if (cadence === 'annual') return 'Annual';
  return '';
}

function listedAmount(plan: Bundle): number | null {
  const cadence = planCadence(plan);
  if (cadence === 'monthly') {
    if (plan.priceMonthly != null) return plan.priceMonthly;
    if (plan.price != null) return plan.price / 12;
    return null;
  }
  if (cadence === 'annual') return plan.priceAnnual ?? plan.price ?? null;
  return plan.priceMonthly ?? plan.priceAnnual ?? plan.price ?? null;
}

function speciesLabel(species: string | null | undefined): string {
  if (!species) return 'Any species';
  if (species === 'dog') return 'Dog';
  if (species === 'cat') return 'Cat';
  return species;
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
    minAgeYears: '',
    maxAgeYears: '',
    termMonths: '12',
    renewalSuccessorPackageId: '',
    ageLimitSuccessorPackageId: '',
    price: '',
    outOfPlanDiscount: '',
    onlineStoreDiscount: '',
    renewalMonths: '12',
    isActive: true,
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
    minAgeYears: monthsToYearsText(bundle.minAgeMonths),
    maxAgeYears: monthsToYearsText(bundle.maxAgeMonths),
    termMonths: numText(bundle.termMonths) || '12',
    renewalSuccessorPackageId: numText(bundle.renewalSuccessorPackageId),
    ageLimitSuccessorPackageId: numText(bundle.ageLimitSuccessorPackageId),
    price: numText(listedAmount(bundle)),
    outOfPlanDiscount: numText(bundle.outOfPlanDiscount),
    onlineStoreDiscount: numText(bundle.onlineStoreDiscount),
    renewalMonths: numText(bundle.renewalMonths) || '12',
    isActive: bundle.isActive !== false,
    portalSlug: text(bundle.portalSlug),
    sortOrder: numText(bundle.sortOrder),
  };
}

function itemDraftFrom(item: BundleItem): ItemDraft {
  const basis =
    item.productionBasis === 'membership_price' ||
    item.productionBasis === 'custom' ||
    item.productionBasis === 'full_price'
      ? item.productionBasis
      : item.productionOverride != null
        ? 'custom'
        : 'full_price';
  return {
    key: nextKey('item'),
    id: item.id,
    itemType: item.itemType,
    catalogItemId: item.catalogItemId,
    name: item.name,
    code: item.code,
    catalogPrice: item.catalogPrice,
    quantity: allowanceDraftText(item.quantity),
    coverage: item.coverage,
    copayPrice: numText(item.copayPrice),
    percentOff: numText(item.percentOff),
    productionBasis: basis,
    productionOverride: numText(item.productionOverride),
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
    allowedQuantity: allowanceDraftText(group.allowedQuantity),
    items: [...group.items].sort((a, b) => a.sortOrder - b.sortOrder).map(itemDraftFrom),
  };
}

function autoGroupName(group: GroupDraft): string {
  const names = group.items.map((item) => item.name.trim()).filter(Boolean);
  if (group.selectionMode === 'choice') {
    if (names.length === 0) return 'Pick one';
    if (names.length === 1) return `${names[0]} — pick one`;
    if (names.length === 2) return `${names[0]} or ${names[1]}`;
    return `${names[0]} or ${names.length - 1} others`;
  }
  return names[0] || group.name.trim() || 'Included';
}

/**
 * Staff edit a flat list of lines. An `all` group with several items is one
 * "always included" bucket in the API, so we split it into one group per item
 * here. Choice groups stay intact as OR clusters. Item ids are kept so a later
 * save moves rows between groups instead of recreating them.
 */
function splitIncludedLines(groups: GroupDraft[]): GroupDraft[] {
  if (!groups.some((group) => group.selectionMode === 'all' && group.items.length > 1)) {
    return groups;
  }
  const out: GroupDraft[] = [];
  for (const group of groups) {
    if (group.selectionMode === 'choice' || group.items.length <= 1) {
      out.push(group);
      continue;
    }
    group.items.forEach((item, index) => {
      out.push({
        key: index === 0 ? group.key : `line-${item.key}`,
        id: index === 0 ? group.id : undefined,
        name: index === 0 ? group.name : item.name,
        description: index === 0 ? group.description : '',
        selectionMode: 'all',
        allowedQuantity: '1',
        items: [item],
      });
    });
  }
  return out;
}

function groupDraftsFrom(bundle: Bundle): GroupDraft[] {
  const sorted = [...(bundle.groups ?? [])]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(groupDraftFrom);
  return splitIncludedLines(sorted);
}

function planFieldsFrom(draft: PlanDraft): BundleFields & { name: string } {
  const cadence = planCadence(draft);
  const amount = numOrNull(draft.price);
  return {
    name: draft.name.trim(),
    code: draft.code.trim() || null,
    description: draft.description.trim() || null,
    marketingSummary: draft.marketingSummary.trim() || null,
    species: draft.species.trim() || null,
    tier: null,
    minAgeMonths: yearsToMonths(draft.minAgeYears),
    maxAgeMonths: yearsToMonths(draft.maxAgeYears),
    termMonths: numOrNull(draft.termMonths) ?? 12,
    renewalSuccessorPackageId: idOrNull(draft.renewalSuccessorPackageId),
    ageLimitSuccessorPackageId: idOrNull(draft.ageLimitSuccessorPackageId),
    priceMonthly: cadence === 'monthly' ? amount : null,
    priceAnnual: cadence === 'annual' ? amount : null,
    outOfPlanDiscount: numOrNull(draft.outOfPlanDiscount),
    onlineStoreDiscount: numOrNull(draft.onlineStoreDiscount),
    renewalMonths: numOrNull(draft.renewalMonths) ?? 12,
    isAutoRenew: true,
    isActive: draft.isActive,
    portalSlug: draft.portalSlug.trim() || null,
    ...(draft.sortOrder.trim() === '' ? {} : { sortOrder: intOr(draft.sortOrder, 0) }),
  };
}

/** Consecutive included lines become one `all` group again so the API and chart stay tidy. */
function coalesceIncludedLines(groups: GroupDraft[]): GroupDraft[] {
  const out: GroupDraft[] = [];
  for (const group of groups) {
    if (group.items.length === 0) continue;
    if (group.selectionMode === 'choice') {
      out.push(group);
      continue;
    }
    const prev = out[out.length - 1];
    if (prev && prev.selectionMode === 'all') {
      out[out.length - 1] = { ...prev, items: [...prev.items, ...group.items] };
    } else {
      out.push({ ...group, items: [...group.items] });
    }
  }
  return out;
}

function groupInputsFrom(groups: GroupDraft[]): BundleGroupInput[] {
  return coalesceIncludedLines(groups).map((group, groupIndex) => ({
    ...(group.id == null ? {} : { id: group.id }),
    name: group.selectionMode === 'choice' ? autoGroupName(group) : group.name.trim() || 'Included',
    description: group.description.trim() || null,
    selectionMode: group.selectionMode,
    allowedQuantity:
      group.selectionMode === 'choice' ? allowanceFromDraft(group.allowedQuantity, 1) : 1,
    sortOrder: groupIndex,
    items: group.items.map(
      (item, itemIndex): BundleItemInput => ({
        ...(item.id == null ? {} : { id: item.id }),
        itemType: item.itemType,
        catalogItemId: item.catalogItemId,
        quantity: group.selectionMode === 'choice' ? 1 : allowanceFromDraft(item.quantity, 1),
        coverage: item.coverage,
        copayPrice: item.coverage === 'copay' ? numOrNull(item.copayPrice) : null,
        percentOff: item.coverage === 'percent_off' ? numOrNull(item.percentOff) : null,
        productionBasis: item.productionBasis,
        productionOverride:
          item.productionBasis === 'custom' ? numOrNull(item.productionOverride) : null,
        sortOrder: itemIndex,
        note: item.note.trim() || null,
      })
    ),
  }));
}

/** Client-side mirror of the API rules so staff get the message before a 400. */
function validate(
  draft: PlanDraft,
  groups: GroupDraft[],
  currentPlanId?: number,
): string | null {
  if (!draft.name.trim()) return 'Give the plan a name.';

  const minAgeMonths = yearsToMonths(draft.minAgeYears);
  const maxAgeMonths = yearsToMonths(draft.maxAgeYears);
  if (minAgeMonths != null && maxAgeMonths != null && minAgeMonths > maxAgeMonths) {
    return 'Youngest age must be less than or equal to oldest age.';
  }
  const renewalSuccessorId = idOrNull(draft.renewalSuccessorPackageId);
  const ageLimitSuccessorId = idOrNull(draft.ageLimitSuccessorPackageId);
  if (currentPlanId != null) {
    if (renewalSuccessorId === currentPlanId || ageLimitSuccessorId === currentPlanId) {
      return 'Choose a different plan to renew into — a plan cannot renew into itself.';
    }
  }
  if (ageLimitSuccessorId != null && !draft.maxAgeYears.trim()) {
    return 'Set an oldest age when choosing a plan for members who age out.';
  }

  for (const group of groups) {
    if (group.items.length === 0) {
      return 'Finish picking a catalog item, or remove the empty line.';
    }
    const label = autoGroupName(group);
    if (group.selectionMode === 'choice' && group.items.length < 2) {
      return `${label} needs another option so the member can pick between them.`;
    }
    if (
      group.selectionMode === 'choice' &&
      !isUnlimitedDraft(group.allowedQuantity) &&
      allowanceFromDraft(group.allowedQuantity, 0) < 1
    ) {
      return `${label} needs an allowance of at least 1, or Unlimited.`;
    }
    for (const item of group.items) {
      if (!Number.isFinite(item.catalogItemId) || item.catalogItemId <= 0) {
        return `${label} has a line with no catalog item picked.`;
      }
      if (
        group.selectionMode !== 'choice' &&
        !isUnlimitedDraft(item.quantity) &&
        allowanceFromDraft(item.quantity, 0) < 1
      ) {
        return `${item.name} needs an allowance of at least 1, or Unlimited.`;
      }
      if (item.coverage === 'copay' && numOrNull(item.copayPrice) == null) {
        return `${item.name} needs a copay amount.`;
      }
      if (item.coverage === 'percent_off') {
        const pct = numOrNull(item.percentOff);
        if (pct == null || pct <= 0 || pct > 100) {
          return `${item.name} needs a percent off between 1 and 100.`;
        }
      }
      if (item.productionBasis === 'custom' && numOrNull(item.productionOverride) == null) {
        return `${item.name} needs a custom doctor production amount.`;
      }
    }
  }

  const seen = new Set<string>();
  for (const group of groups) {
    for (const item of group.items) {
      const dedupe = `${group.key}:${item.itemType}:${item.catalogItemId}`;
      if (seen.has(dedupe)) {
        return `${item.name} is listed twice in the same either / or set.`;
      }
      seen.add(dedupe);
    }
  }
  return null;
}

type BenefitSnap = {
  id: number | null;
  name: string;
  itemType: MembershipItemType;
  catalogItemId: number;
  quantity: number;
  coverage: ItemCoverage;
  copayPrice: number | null;
  percentOff: number | null;
};

function snapQuantityLabel(quantity: number): string {
  return quantity === UNLIMITED_ALLOWANCE ? 'unlimited' : `×${quantity}`;
}

function snapCoverageLabel(snap: BenefitSnap): string {
  if (snap.coverage === 'percent_off') return `${snap.percentOff ?? '?'}% off`;
  if (snap.coverage === 'copay') return `copay ${snap.copayPrice ?? '?'}`;
  return 'included';
}

function formatBenefitSnap(snap: BenefitSnap): string {
  return `• ${snap.name} — ${snapCoverageLabel(snap)}, ${snapQuantityLabel(snap.quantity)}`;
}

function snapsFromGroups(groups: GroupDraft[]): BenefitSnap[] {
  return groups.flatMap((group) =>
    group.items.map((item) => ({
      id: item.id ?? null,
      name: item.name,
      itemType: item.itemType,
      catalogItemId: item.catalogItemId,
      quantity:
        group.selectionMode === 'choice' ? 1 : allowanceFromDraft(item.quantity, 1),
      coverage: item.coverage,
      copayPrice: item.coverage === 'copay' ? numOrNull(item.copayPrice) : null,
      percentOff: item.coverage === 'percent_off' ? numOrNull(item.percentOff) : null,
    })),
  );
}

function snapsFromBundle(bundle: Bundle): BenefitSnap[] {
  return (bundle.groups ?? []).flatMap((group) =>
    group.items.map((item) => ({
      id: item.id,
      name: item.name,
      itemType: item.itemType,
      catalogItemId: item.catalogItemId,
      quantity: group.selectionMode === 'choice' ? 1 : item.quantity,
      coverage: item.coverage,
      copayPrice: item.coverage === 'copay' ? item.copayPrice : null,
      percentOff: item.coverage === 'percent_off' ? item.percentOff : null,
    })),
  );
}

function sameBenefitLine(a: BenefitSnap, b: BenefitSnap): boolean {
  return (
    a.itemType === b.itemType &&
    a.catalogItemId === b.catalogItemId &&
    a.quantity === b.quantity &&
    a.coverage === b.coverage &&
    a.copayPrice === b.copayPrice &&
    a.percentOff === b.percentOff
  );
}

function benefitFieldsChanged(a: BenefitSnap, b: BenefitSnap): boolean {
  return (
    a.quantity !== b.quantity ||
    a.coverage !== b.coverage ||
    a.copayPrice !== b.copayPrice ||
    a.percentOff !== b.percentOff
  );
}

function diffBenefits(baseline: BenefitSnap[], current: BenefitSnap[]) {
  const baseById = new Map(
    baseline.filter((row) => row.id != null).map((row) => [row.id as number, row]),
  );
  const added: BenefitSnap[] = [];
  const updated: BenefitSnap[] = [];
  for (const row of current) {
    if (row.id == null || !baseById.has(row.id)) {
      added.push(row);
      continue;
    }
    if (benefitFieldsChanged(baseById.get(row.id)!, row)) updated.push(row);
  }
  const currentIds = new Set(current.map((row) => row.id).filter((id): id is number => id != null));
  const removed = baseline.filter((row) => row.id != null && !currentIds.has(row.id));
  return { added, updated, removed };
}

function baselineStorageKey(planId: number): string {
  return `vayd.membershipApplyBaseline.${planId}`;
}

function readStoredBaseline(planId: number): BenefitSnap[] | null {
  try {
    const raw = sessionStorage.getItem(baselineStorageKey(planId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BenefitSnap[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredBaseline(planId: number, snaps: BenefitSnap[]): void {
  try {
    sessionStorage.setItem(baselineStorageKey(planId), JSON.stringify(snaps));
  } catch {
    /* ignore quota / private mode */
  }
}

function resolveAddedIds(pending: BenefitSnap[], saved: BenefitSnap[], baselineIds: Set<number>) {
  const unused = saved.filter((row) => row.id != null && !baselineIds.has(row.id));
  const ids: number[] = [];
  for (const row of pending) {
    if (row.id != null && !baselineIds.has(row.id)) {
      ids.push(row.id);
      continue;
    }
    const match = unused.findIndex((candidate) => sameBenefitLine(row, candidate));
    if (match >= 0) {
      const id = unused[match].id;
      unused.splice(match, 1);
      if (id != null) ids.push(id);
    }
  }
  return [...new Set(ids)];
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
    productionBasis: 'full_price',
    productionOverride: '',
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
  const [baselineSnaps, setBaselineSnaps] = useState<BenefitSnap[]>([]);
  const [pickerGroupKey, setPickerGroupKey] = useState<string | null>(null);

  useEffect(() => {
    setGroups((cur) => {
      const next = splitIncludedLines(cur);
      return next === cur ? cur : next;
    });
  }, [groups]);

  const [removeDropped, setRemoveDropped] = useState(false);
  const [saving, setSaving] = useState(false);

  const [auditOpen, setAuditOpen] = useState(false);
  const [audit, setAudit] = useState<MembershipAuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  const [assignFeeToProvider, setAssignFeeToProvider] = useState(false);
  const [postVisitWindowHours, setPostVisitWindowHours] = useState(
    String(MEMBERSHIP_POST_VISIT_SIGNUP_WINDOW_HOURS_DEFAULT),
  );
  const [onlineStoreEnabled, setOnlineStoreEnabled] = useState(false);
  const [feeSettingLoading, setFeeSettingLoading] = useState(true);
  const [feeSettingSaving, setFeeSettingSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFeeSettingLoading(true);
    getPracticeSettings(PRACTICE_ID)
      .then((settings) => {
        if (!cancelled) {
          setAssignFeeToProvider(membershipAssignFeeToProvider(settings));
          setPostVisitWindowHours(
            String(membershipPostVisitSignupWindowHours(settings)),
          );
          setOnlineStoreEnabled(isOnlineStoreImplemented(settings));
        }
      })
      .catch(() => {
        if (!cancelled) setAssignFeeToProvider(false);
      })
      .finally(() => {
        if (!cancelled) setFeeSettingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveFeeProviderSetting(next: boolean) {
    setAssignFeeToProvider(next);
    setFeeSettingSaving(true);
    try {
      await updatePracticeSettings(PRACTICE_ID, {
        [MEMBERSHIP_ASSIGN_FEE_TO_PROVIDER_KEY]: next ? 'true' : 'false',
      });
      onMessage?.(
        next
          ? 'Membership fees will be assigned to a provider’s VSD.'
          : 'Membership fees will go to Not Specified (no provider).',
        'success',
      );
    } catch (e) {
      setAssignFeeToProvider(!next);
      onMessage?.(extractErr(e), 'error');
    } finally {
      setFeeSettingSaving(false);
    }
  }

  async function savePostVisitWindowHours() {
    const hours = membershipPostVisitSignupWindowHours({
      [MEMBERSHIP_POST_VISIT_SIGNUP_WINDOW_HOURS_KEY]: postVisitWindowHours,
    });
    setPostVisitWindowHours(String(hours));
    setFeeSettingSaving(true);
    try {
      await updatePracticeSettings(PRACTICE_ID, {
        [MEMBERSHIP_POST_VISIT_SIGNUP_WINDOW_HOURS_KEY]: String(hours),
      });
      onMessage?.(
        `Post-visit signup window set to ${hours} hour${hours === 1 ? '' : 's'}.`,
        'success',
      );
    } catch (e) {
      onMessage?.(extractErr(e), 'error');
    } finally {
      setFeeSettingSaving(false);
    }
  }

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
    setRemoveDropped(false);
    void getBundle(selectedId)
      .then((bundle) => {
        if (cancelled) return;
        setDetail(bundle);
        setPlanDraft(planDraftFrom(bundle));
        setGroups(groupDraftsFrom(bundle));
        const snaps = snapsFromBundle(bundle);
        const stored = readStoredBaseline(bundle.id);
        setBaselineSnaps(stored ?? snaps);
        if (!stored) writeStoredBaseline(bundle.id, snaps);
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

  useEffect(() => {
    if (!detail || baselineSnaps.length > 0) return;
    const stored = readStoredBaseline(detail.id);
    const snaps = stored ?? snapsFromBundle(detail);
    setBaselineSnaps(snaps);
    if (!stored) writeStoredBaseline(detail.id, snaps);
  }, [detail, baselineSnaps.length]);

  const visiblePlans = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = q
      ? plans.filter((plan) =>
          [plan.name, plan.code, plan.species, plan.description]
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

  const renewalSuccessorOptions = useMemo(() => {
    const currentId = selection?.mode === 'plan' ? selection.id : null;
    return [...plans]
      .filter((plan) => plan.id !== currentId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [plans, selection]);

  function startNewPlan() {
    setSelection({ mode: 'new' });
    setDetail(null);
    setDetailError(null);
    setPlanDraft(emptyPlanDraft());
    setGroups([]);
    setBaselineSnaps([]);
    setPickerGroupKey(null);
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

  function tidyGroups(cur: GroupDraft[], keepKey?: string): GroupDraft[] {
    return cur
      .filter((group) => group.items.length > 0 || group.key === keepKey)
      .map((group) =>
        group.selectionMode === 'choice' && group.items.length < 2 && group.key !== keepKey
          ? { ...group, selectionMode: 'all' as const, name: group.items[0]?.name ?? group.name }
          : group
      );
  }

  function closePicker() {
    setPickerGroupKey(null);
    setGroups((cur) => tidyGroups(cur));
  }

  function addLine() {
    const group: GroupDraft = {
      key: nextKey('group'),
      name: '',
      description: '',
      selectionMode: 'all',
      allowedQuantity: '1',
      items: [],
    };
    setGroups((cur) => [...tidyGroups(cur), group]);
    setPickerGroupKey(group.key);
  }

  function addOr(group: GroupDraft, itemKey?: string) {
    const targetItemKey = itemKey ?? group.items[0]?.key;
    const choiceKey = nextKey('group');
    setGroups((cur) => {
      const cleaned = tidyGroups(cur, group.key);
      const idx = cleaned.findIndex((row) => row.key === group.key);
      if (idx < 0) return cleaned;
      const row = cleaned[idx];
      const itemIndex = Math.max(
        0,
        row.items.findIndex((item) => item.key === targetItemKey),
      );
      const target = row.items[itemIndex] ?? row.items[0];
      if (!target) return cleaned;

      if (row.selectionMode === 'choice' || row.items.length <= 1) {
        return cleaned.map((g) =>
          g.key === row.key
            ? {
                ...g,
                selectionMode: 'choice' as const,
                allowedQuantity: target.quantity || g.allowedQuantity || '1',
                name: `${target.name} — pick one`,
              }
            : g
        );
      }

      const before = row.items.slice(0, itemIndex);
      const after = row.items.slice(itemIndex + 1);
      const choiceGroup: GroupDraft = {
        key: choiceKey,
        name: `${target.name} — pick one`,
        description: '',
        selectionMode: 'choice',
        allowedQuantity: target.quantity || '1',
        items: [target],
      };
      const replacement: GroupDraft[] = [];
      if (before.length) replacement.push({ ...row, items: before });
      replacement.push(choiceGroup);
      if (after.length) {
        replacement.push({
          key: nextKey('group'),
          name: row.name,
          description: '',
          selectionMode: 'all',
          allowedQuantity: '1',
          items: after,
        });
      }
      return [...cleaned.slice(0, idx), ...replacement, ...cleaned.slice(idx + 1)];
    });
    setPickerGroupKey(group.items.length <= 1 || group.selectionMode === 'choice' ? group.key : choiceKey);
  }

  async function removeGroup(group: GroupDraft) {
    const label = autoGroupName(group);
    const several = group.items.length > 1;
    const ok = await appConfirm({
      title: several ? `Remove ${label}?` : `Remove ${group.items[0]?.name ?? 'this benefit'}?`,
      message: several
        ? 'This either / or set and its options come off the plan. Nothing changes for patients already on the plan until you apply the plan to existing memberships.'
        : 'This benefit comes off the plan. Nothing changes for patients already on the plan until you apply the plan to existing memberships.',
      confirmLabel: several ? 'Remove set' : 'Remove',
      danger: true,
    });
    if (!ok) return;
    if (pickerGroupKey === group.key) setPickerGroupKey(null);
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
    void (async () => {
      const existing = groups.flatMap((group) =>
        group.items
          .filter(
            (row) =>
              row.itemType === item.itemType && row.catalogItemId === item.catalogItemId,
          )
          .map((row) => {
            const coverage =
              row.coverage === 'percent_off'
                ? `${row.percentOff || '?'}% off`
                : row.coverage === 'copay'
                  ? `copay ${row.copayPrice || '?'}`
                  : 'included';
            const qty = isUnlimitedDraft(row.quantity)
              ? 'unlimited'
              : `×${allowanceFromDraft(row.quantity, 1)}`;
            return `• ${row.name} — ${coverage}, ${qty}`;
          }),
      );
      if (existing.length > 0) {
        const ok = await appConfirm({
          title: 'Already on this plan',
          message:
            `${item.name} is already on this plan:\n\n${existing.join('\n')}\n\n` +
            'Add another benefit line anyway? Use this when the first is fully included and later visits get a different discount (for example 50% off).',
          confirmLabel: 'Add another line',
          cancelLabel: 'Cancel',
        });
        if (!ok) {
          setPickerGroupKey(null);
          return;
        }
      }
      setGroups((cur) =>
        cur.map((group) => {
          if (group.key !== groupKey) return group;
          const items = [...group.items, item];
          return {
            ...group,
            items,
            name:
              group.selectionMode === 'choice'
                ? autoGroupName({ ...group, items })
                : item.name,
          };
        }),
      );
      setPickerGroupKey(null);
    })();
  }

  function removeItem(groupKey: string, itemKey: string) {
    setGroups((cur) =>
      cur.flatMap((group) => {
        if (group.key !== groupKey) return [group];
        const items = group.items.filter((item) => item.key !== itemKey);
        if (items.length === 0) return [];
        if (group.selectionMode === 'choice' && items.length < 2) {
          return [
            {
              ...group,
              items,
              selectionMode: 'all' as const,
              name: items[0]?.name ?? group.name,
            },
          ];
        }
        return [{ ...group, items, name: autoGroupName({ ...group, items }) }];
      })
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
    const problem = validate(
      planDraft,
      groups,
      selection?.mode === 'plan' ? selection.id : undefined,
    );
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

    setSaving(true);
    try {
      const saved = await updateBundle(detail.id, fields, {
        groups: groupInputs,
      });
      absorbSaved(saved);
      onMessage?.(`Saved ${saved.name}.`, 'success');
      if (auditOpen) void loadAudit(saved.id);
    } catch (e) {
      onMessage?.(extractErr(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function applyBenefitsToExisting() {
    if (!detail) return;
    const members = detail.activeMemberCount;
    if (members <= 0) {
      onMessage?.('No current members on this plan to update.', 'error');
      return;
    }
    const problem = validate(planDraft, groups, detail.id);
    if (problem) {
      onMessage?.(problem, 'error');
      return;
    }
    const pending = diffBenefits(baselineSnaps, snapsFromGroups(groups));
    const removals = removeDropped ? pending.removed : [];
    if (pending.added.length === 0 && pending.updated.length === 0 && removals.length === 0) {
      onMessage?.(
        'Nothing to apply. This only pushes benefits you changed since opening this plan — not the rest of the plan.',
        'error',
      );
      return;
    }
    const sections: string[] = [
      `This only applies the ${pending.added.length + pending.updated.length + removals.length} change${pending.added.length + pending.updated.length + removals.length === 1 ? '' : 's'} you made since opening this plan. Other benefits already on the plan are left alone.`,
    ];
    if (pending.added.length) {
      sections.push(`Add:\n${pending.added.map(formatBenefitSnap).join('\n')}`);
    }
    if (pending.updated.length) {
      sections.push(`Update:\n${pending.updated.map(formatBenefitSnap).join('\n')}`);
    }
    if (removals.length) {
      sections.push(`Take away:\n${removals.map(formatBenefitSnap).join('\n')}`);
    }
    const ok = await appConfirm({
      title: `Apply these changes to current ${detail.name} members?`,
      message: `${members} patient${members === 1 ? ' is' : 's are'} on ${detail.name} right now.\n\n${sections.join('\n\n')}`,
      confirmLabel: `Apply ${pending.added.length + pending.updated.length + removals.length} change${pending.added.length + pending.updated.length + removals.length === 1 ? '' : 's'} to ${members} membership${members === 1 ? '' : 's'}`,
      danger: removals.length > 0,
    });
    if (!ok) return;

    setSaving(true);
    try {
      const saved = await updateBundle(detail.id, planFieldsFrom(planDraft), {
        groups: groupInputsFrom(groups),
      });
      absorbSaved(saved);
      const savedSnaps = snapsFromBundle(saved);
      const baselineIds = new Set(
        baselineSnaps.map((row) => row.id).filter((id): id is number => id != null),
      );
      const packageItemIds = [
        ...resolveAddedIds(pending.added, savedSnaps, baselineIds),
        ...pending.updated.map((row) => row.id).filter((id): id is number => id != null),
      ];
      const result = await applyBundleToExistingMemberships(saved.id, {
        removeBenefitsDroppedFromPlan: removals.length > 0,
        packageItemIds,
        removePackageItemIds: removals
          .map((row) => row.id)
          .filter((id): id is number => id != null),
      });
      setBaselineSnaps(savedSnaps);
      writeStoredBaseline(saved.id, savedSnaps);
      onMessage?.(
        `Saved ${saved.name}. ${propagationSummary(result, saved.name)}`,
        'success',
      );
      if (auditOpen) void loadAudit(saved.id);
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
        'Archiving takes the plan off the list staff and the portal can enroll into. ' +
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
      title: 'Adding an OR to a line',
      message:
        'Each line is included with the membership unless you add an OR to it. ' +
        'Lyme and lepto stay as their own lines — members always get those. ' +
        'On a lab line, tap OR and pick the other lab; the member then gets one of those options, not both. ' +
        'You can keep adding ORs to that same line. Taking any option uses the line’s allowance.',
      confirmLabel: 'Got it',
    });
  }

  function renderBenefitItem(
    group: GroupDraft,
    item: ItemDraft,
    itemIndex: number,
    opts: {
      showOr: boolean;
      showAddOr: boolean;
      moveWholeGroup: boolean;
      groupIndex: number;
    },
  ) {
    const isChoice = group.selectionMode === 'choice';
    const upDisabled = opts.moveWholeGroup ? opts.groupIndex === 0 : itemIndex === 0;
    const downDisabled = opts.moveWholeGroup
      ? opts.groupIndex === groups.length - 1
      : itemIndex === group.items.length - 1;

    return (
      <li key={item.key} className="memberships-item">
        {opts.showOr ? (
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
              {item.catalogPrice == null ? '' : ` · catalog ${money(item.catalogPrice)}`}
            </span>
          </div>

          <div className="memberships-item__controls">
            {isChoice ? null : (
              <label className="settings-label memberships-item__qty">
                Allowance
                <select
                  className="settings-select"
                  value={isUnlimitedDraft(item.quantity) ? UNLIMITED_TOKEN : 'limited'}
                  onChange={(e) =>
                    updateItem(group.key, item.key, {
                      quantity:
                        e.target.value === UNLIMITED_TOKEN
                          ? UNLIMITED_TOKEN
                          : item.quantity === UNLIMITED_TOKEN
                            ? '1'
                            : item.quantity || '1',
                    })
                  }
                >
                  <option value="limited">Limited</option>
                  <option value={UNLIMITED_TOKEN}>Unlimited</option>
                </select>
                {isUnlimitedDraft(item.quantity) ? (
                  <span className="settings-muted memberships-item__qty-hint">
                    Every visit gets member pricing
                  </span>
                ) : (
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
                )}
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
            <label className="settings-label memberships-item__production">
              Doctor production
              <select
                className="settings-select"
                value={item.productionBasis}
                onChange={(e) =>
                  updateItem(group.key, item.key, {
                    productionBasis: e.target.value as ItemProductionBasis,
                  })
                }
              >
                {PRODUCTION_BASIS_ORDER.map((basis) => (
                  <option key={basis} value={basis}>
                    {PRODUCTION_BASIS_LABELS[basis]}
                  </option>
                ))}
              </select>
            </label>
            {item.productionBasis === 'custom' ? (
              <label className="settings-label memberships-item__money">
                Production ($)
                <input
                  className="settings-input"
                  type="number"
                  min={0}
                  step={0.01}
                  value={item.productionOverride}
                  onChange={(e) =>
                    updateItem(group.key, item.key, {
                      productionOverride: e.target.value,
                    })
                  }
                />
              </label>
            ) : null}
          </div>

          <div className="memberships-item__tools">
            {opts.showAddOr ? (
              <button
                type="button"
                className="memberships-item__or-btn"
                onClick={() => addOr(group, item.key)}
              >
                OR
              </button>
            ) : null}
            <button
              type="button"
              className="btn-link"
              aria-label={opts.moveWholeGroup ? 'Move line up' : 'Move option up'}
              disabled={upDisabled}
              onClick={() =>
                opts.moveWholeGroup
                  ? moveGroup(opts.groupIndex, -1)
                  : moveItem(group.key, itemIndex, -1)
              }
            >
              <ChevronUp size={15} aria-hidden />
            </button>
            <button
              type="button"
              className="btn-link"
              aria-label={opts.moveWholeGroup ? 'Move line down' : 'Move option down'}
              disabled={downDisabled}
              onClick={() =>
                opts.moveWholeGroup
                  ? moveGroup(opts.groupIndex, 1)
                  : moveItem(group.key, itemIndex, 1)
              }
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
    );
  }

  const isNew = selection?.mode === 'new';
  const editing = isNew || detail != null;

  return (
    <div className="settings-section memberships">
      <h2 className="settings-section-title">Memberships</h2>
      <p className="settings-section-description">
        Wellness plans patients subscribe to. Each line is included with the membership. Add an{' '}
        <strong>OR</strong> to a line when the member picks one of several options — this lab{' '}
        <em>or</em> that lab — while other lines stay included. Price and restrictions apply to
        new enrollments only. Current members keep what they have unless you push benefits from
        the items section.
      </p>

      <div className="settings-card" style={{ marginBottom: 16 }}>
        <h3 className="settings-card-title">Membership fee on invoices</h3>
        <p className="settings-muted" style={{ marginBottom: 12, fontSize: 13 }}>
          When a pet is enrolled and the plan is added to an invoice, should that fee count toward
          a provider’s VSD, or stay unassigned in Not Specified?
        </p>
        {feeSettingLoading ? (
          <p className="settings-muted">Loading…</p>
        ) : (
          <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend className="settings-label" style={{ marginBottom: 8 }}>
              Assign membership fees to a provider?
            </legend>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                marginRight: 16,
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              <input
                type="radio"
                name="membershipAssignFeeToProvider"
                checked={assignFeeToProvider}
                onChange={() => void saveFeeProviderSetting(true)}
                disabled={feeSettingSaving}
              />
              Yes — assign to a provider
            </label>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              <input
                type="radio"
                name="membershipAssignFeeToProvider"
                checked={!assignFeeToProvider}
                onChange={() => void saveFeeProviderSetting(false)}
                disabled={feeSettingSaving}
              />
              No — Not Specified VSD
            </label>
          </fieldset>
        )}
      </div>

      <div className="settings-card" style={{ marginBottom: 16 }}>
        <h3 className="settings-card-title">Post-visit membership signup</h3>
        <p className="settings-muted" style={{ marginBottom: 12, fontSize: 13 }}>
          How long after a visit (or store) payment a care lead can re-price that bill under a
          new membership without an override. The financial workspace lists invoices from the
          last 48 business hours, with Load more for older ones. Outside this window, staff must
          confirm an override — it is written to the membership audit.
        </p>
        {feeSettingLoading ? (
          <p className="settings-muted">Loading…</p>
        ) : (
          <label className="settings-field" style={{ maxWidth: 280 }}>
            <span className="settings-label">Signup window (calendar hours)</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                className="settings-input"
                type="number"
                min={1}
                max={720}
                step={1}
                value={postVisitWindowHours}
                disabled={feeSettingSaving}
                onChange={(e) => setPostVisitWindowHours(e.target.value)}
                onBlur={() => void savePostVisitWindowHours()}
              />
              <button
                type="button"
                className="btn secondary"
                disabled={feeSettingSaving}
                onClick={() => void savePostVisitWindowHours()}
              >
                Save
              </button>
            </div>
          </label>
        )}
      </div>

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
                      {speciesLabel(plan.species)}
                    </span>
                    <span className="memberships-rail__item-prices">
                      {listedAmount(plan) == null
                        ? '—'
                        : planCadence(plan) === 'annual'
                          ? `${money(listedAmount(plan))}/yr`
                          : `${money(listedAmount(plan))}/mo`}
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
                    {planCadence(planDraft) === 'annual'
                      ? 'Annual price'
                      : planCadence(planDraft) === 'monthly'
                        ? 'Monthly price'
                        : 'Price'}
                    <input
                      className="settings-input"
                      type="number"
                      min={0}
                      step={0.01}
                      value={planDraft.price}
                      onChange={(e) => setField('price', e.target.value)}
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
                  {onlineStoreEnabled ? (
                    <label className="settings-label">
                      Online store discount (%)
                      <input
                        className="settings-input"
                        type="number"
                        min={0}
                        max={100}
                        step={0.01}
                        value={planDraft.onlineStoreDiscount}
                        onChange={(e) => setField('onlineStoreDiscount', e.target.value)}
                        placeholder="10"
                      />
                    </label>
                  ) : null}
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
                </div>

                <div className="memberships-flags">
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

              <div className="settings-card memberships-restrictions">
                <div className="memberships-restrictions__head">
                  <h3 className="settings-card-title memberships-detail__title">Restrictions</h3>
                  <p className="settings-muted">
                    Who may enroll on this plan, the length of a membership year, and where they
                    move at renewal or when they age out. Owners are emailed 14 days before the
                    year ends.
                  </p>
                </div>
                <div className="memberships-fields">
                  <label className="settings-label">
                    Species
                    <select
                      className="settings-select"
                      value={planDraft.species}
                      onChange={(e) => setField('species', e.target.value)}
                    >
                      <option value="">Any species</option>
                      <option value="dog">Dog</option>
                      <option value="cat">Cat</option>
                    </select>
                  </label>
                  <label className="settings-label">
                    Youngest age (years)
                    <input
                      className="settings-input"
                      type="number"
                      min={0}
                      step={1}
                      placeholder="e.g. 0 for puppies"
                      value={planDraft.minAgeYears}
                      onChange={(e) => setField('minAgeYears', e.target.value)}
                    />
                  </label>
                  <label className="settings-label">
                    Oldest age (years)
                    <input
                      className="settings-input"
                      type="number"
                      min={0}
                      step={1}
                      placeholder="e.g. 8 for Foundations"
                      value={planDraft.maxAgeYears}
                      onChange={(e) => setField('maxAgeYears', e.target.value)}
                    />
                  </label>
                  <label className="settings-label">
                    Membership year (months)
                    <input
                      className="settings-input"
                      type="number"
                      min={1}
                      step={1}
                      value={planDraft.termMonths}
                      onChange={(e) => setField('termMonths', e.target.value)}
                    />
                  </label>
                  <label className="settings-label memberships-fields__wide">
                    On renewal, move to
                    <select
                      className="settings-select"
                      value={planDraft.renewalSuccessorPackageId}
                      onChange={(e) => setField('renewalSuccessorPackageId', e.target.value)}
                    >
                      <option value="">Stay on this plan</option>
                      {renewalSuccessorOptions.map((plan) => {
                        const cadence = planCadenceLabel(plan);
                        const species = speciesLabel(plan.species);
                        const meta = [species, cadence].filter(Boolean).join(' · ');
                        return (
                          <option key={plan.id} value={String(plan.id)}>
                            {plan.name}
                            {meta ? ` (${meta})` : ''}
                            {plan.isArchived ? ' — archived' : ''}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <label className="settings-label memberships-fields__wide">
                    When age limit is reached, move to
                    <select
                      className="settings-select"
                      value={planDraft.ageLimitSuccessorPackageId}
                      onChange={(e) => setField('ageLimitSuccessorPackageId', e.target.value)}
                    >
                      <option value="">Use the on-renewal plan above</option>
                      {renewalSuccessorOptions.map((plan) => {
                        const cadence = planCadenceLabel(plan);
                        const species = speciesLabel(plan.species);
                        const meta = [species, cadence].filter(Boolean).join(' · ');
                        return (
                          <option key={plan.id} value={String(plan.id)}>
                            {plan.name}
                            {meta ? ` (${meta})` : ''}
                            {plan.isArchived ? ' — archived' : ''}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                </div>
                {planDraft.renewalSuccessorPackageId.trim() ? (
                  <p className="settings-muted memberships-restrictions__hint">
                    At each renewal, members still within the age window move to{' '}
                    {renewalSuccessorOptions.find(
                      (plan) => String(plan.id) === planDraft.renewalSuccessorPackageId,
                    )?.name ?? detail?.renewalSuccessorPackageName ?? 'the selected plan'}
                    .
                  </p>
                ) : null}
                {planDraft.maxAgeYears.trim() && planDraft.ageLimitSuccessorPackageId.trim() ? (
                  <p className="settings-muted memberships-restrictions__hint">
                    Members older than {planDraft.maxAgeYears} years move to{' '}
                    {renewalSuccessorOptions.find(
                      (plan) => String(plan.id) === planDraft.ageLimitSuccessorPackageId,
                    )?.name ?? detail?.ageLimitSuccessorPackageName ?? 'the selected plan'}{' '}
                    instead.
                  </p>
                ) : null}
              </div>

              <div className="settings-card">
                <div className="memberships-groups__head">
                  <div>
                    <h3 className="settings-card-title memberships-detail__title">
                      What the plan includes
                    </h3>
                    <p className="settings-muted">
                      Every line is included. Add <strong>OR</strong> on a line when the member
                      picks one option from that line.{' '}
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() => void explainChoiceGroups()}
                      >
                        How does OR work?
                      </button>
                    </p>
                  </div>
                  <div className="memberships-groups__add">
                    <button type="button" className="btn secondary" onClick={addLine}>
                      <Plus size={13} aria-hidden /> Add a benefit
                    </button>
                  </div>
                </div>

                {groups.length === 0 ? (
                  <p className="settings-muted memberships-groups__empty">
                    No benefits yet. Add the items every member gets. If they pick this lab{' '}
                    <em>or</em> that lab, add an OR on that line.
                  </p>
                ) : (
                  <div className="memberships-groups">
                    {groups.map((group, groupIndex) => {
                      const isChoice = group.selectionMode === 'choice';
                      const picking = pickerGroupKey === group.key;
                      const allowanceUnlimited = isUnlimitedDraft(group.allowedQuantity);
                      const allowance = allowanceUnlimited
                        ? 'any'
                        : String(allowanceFromDraft(group.allowedQuantity, 1));
                      const tooFewAlternatives = isChoice && group.items.length < 2;

                      if (group.items.length === 0) {
                        return (
                          <section key={group.key} className="memberships-line-placeholder">
                            <p className="settings-muted memberships-line-placeholder__hint">
                              Search for a catalog item to add.
                            </p>
                            <CatalogItemPicker
                              onClose={closePicker}
                              onPick={(item) => pickItem(group.key, item)}
                            />
                          </section>
                        );
                      }

                      if (!isChoice) {
                        return (
                          <section key={group.key} className="memberships-line">
                            <ul className="memberships-items">
                              {renderBenefitItem(group, group.items[0], 0, {
                                showOr: false,
                                showAddOr: !picking,
                                moveWholeGroup: true,
                                groupIndex,
                              })}
                            </ul>
                            {picking ? (
                              <CatalogItemPicker
                                onClose={closePicker}
                                onPick={(item) => pickItem(group.key, item)}
                              />
                            ) : null}
                          </section>
                        );
                      }

                      return (
                        <section key={group.key} className="memberships-or-cluster">
                          <header className="memberships-or-cluster__head">
                            <span className="memberships-or-cluster__badge">
                              <Shuffle size={12} aria-hidden /> Member picks {allowance}
                            </span>
                            <p className="memberships-or-cluster__explainer">
                              One allowance for this set — taking any option uses it.
                            </p>
                            <label className="settings-label memberships-or-cluster__allowance">
                              Allowance
                              <select
                                className="settings-select"
                                value={
                                  isUnlimitedDraft(group.allowedQuantity)
                                    ? UNLIMITED_TOKEN
                                    : 'limited'
                                }
                                onChange={(e) =>
                                  updateGroup(group.key, {
                                    allowedQuantity:
                                      e.target.value === UNLIMITED_TOKEN
                                        ? UNLIMITED_TOKEN
                                        : group.allowedQuantity === UNLIMITED_TOKEN
                                          ? '1'
                                          : group.allowedQuantity || '1',
                                  })
                                }
                              >
                                <option value="limited">Limited</option>
                                <option value={UNLIMITED_TOKEN}>Unlimited</option>
                              </select>
                              {isUnlimitedDraft(group.allowedQuantity) ? null : (
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
                              )}
                            </label>
                            <div className="memberships-group__tools">
                              <button
                                type="button"
                                className="btn-link"
                                aria-label="Move this set up"
                                disabled={groupIndex === 0}
                                onClick={() => moveGroup(groupIndex, -1)}
                              >
                                <ChevronUp size={15} aria-hidden />
                              </button>
                              <button
                                type="button"
                                className="btn-link"
                                aria-label="Move this set down"
                                disabled={groupIndex === groups.length - 1}
                                onClick={() => moveGroup(groupIndex, 1)}
                              >
                                <ChevronDown size={15} aria-hidden />
                              </button>
                              <button
                                type="button"
                                className="btn-link"
                                aria-label="Remove this either / or set"
                                onClick={() => void removeGroup(group)}
                              >
                                <Trash2 size={14} aria-hidden />
                              </button>
                            </div>
                          </header>

                          {tooFewAlternatives ? (
                            <p className="settings-message settings-error-message memberships-group__warning">
                              Add at least one more option, or close the search to leave this as a
                              regular included line.
                            </p>
                          ) : null}

                          <ul className="memberships-items">
                            {group.items.map((item, itemIndex) =>
                              renderBenefitItem(group, item, itemIndex, {
                                showOr: itemIndex > 0,
                                showAddOr: false,
                                moveWholeGroup: false,
                                groupIndex,
                              }),
                            )}
                          </ul>

                          {picking ? (
                            <CatalogItemPicker
                              onClose={closePicker}
                              onPick={(item) => pickItem(group.key, item)}
                            />
                          ) : (
                            <button
                              type="button"
                              className="btn secondary memberships-group__add-item"
                              onClick={() => addOr(group)}
                            >
                              <Plus size={13} aria-hidden /> Add another OR
                            </button>
                          )}
                        </section>
                      );
                    })}
                    <button
                      type="button"
                      className="btn secondary memberships-group__add-item"
                      onClick={addLine}
                    >
                      <Plus size={13} aria-hidden /> Add a benefit
                    </button>
                  </div>
                )}

                {detail && !isNew && detail.activeMemberCount > 0 ? (
                  <div className="memberships-apply">
                    <p className="settings-muted memberships-apply__hint">
                      {detail.activeMemberCount} patient
                      {detail.activeMemberCount === 1 ? ' is' : 's are'} already on this plan.
                      Saving does not change what they get. Apply only pushes benefits you
                      changed since opening this plan — not the rest of the list, and not
                      price, species, age, or other restrictions.
                    </p>
                    <label className="settings-checkbox-item memberships-apply__danger">
                      <input
                        type="checkbox"
                        checked={removeDropped}
                        onChange={(e) => setRemoveDropped(e.target.checked)}
                      />
                      Also take away benefits that are no longer on the plan
                    </label>
                    {removeDropped ? (
                      <p className="memberships-apply__warning">
                        This removes benefits from patients who are already on {detail.name}, even
                        if they have not used them. Leave it off unless you mean to claw something
                        back.
                      </p>
                    ) : null}
                    <button
                      type="button"
                      className="btn secondary memberships-apply__button"
                      disabled={saving}
                      onClick={() => void applyBenefitsToExisting()}
                    >
                      Apply benefits to existing members
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="settings-card">
                <div className="settings-action-bar memberships-actions">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={saving || !planDraft.name.trim()}
                    onClick={() => void save()}
                  >
                    {saving ? 'Saving…' : isNew ? 'Create plan' : 'Save plan'}
                  </button>
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
