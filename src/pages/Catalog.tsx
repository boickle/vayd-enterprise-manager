import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { usePermissions } from '../permissions/PermissionContext';
import {
  searchItems,
  getItemWithPriceBreaks,
  type SearchResultItem,
  type ItemWithPriceBreaks,
  type ItemType,
  type InventoryItem,
  type Lab,
  type Procedure,
} from '../api/quantityPriceBreaks';
import {
  patchPracticeInventoryItem,
  postBulkInventoryPriceAdjust,
  uploadInventoryItemImage,
  deleteInventoryItemImage,
  inventoryItemImageUrl,
} from '../api/inventoryTools';
import {
  createCatalogItem,
  patchCatalogItem,
  setCatalogItemActive,
} from '../api/catalogItems';
import {
  AFTERCARE_ITEM_LABELS,
  type AftercareItemType,
} from '../utils/aftercare';
import QuantityPriceBreaksEditor from '../components/catalog/QuantityPriceBreaksEditor';
import { appConfirm, appPrompt } from '../utils/appDialog';
import {
  createOnlineStoreProduct,
  createStoreCategory,
  getCatalogStoreListing,
  getStoreItemAvailability,
  type StoreAvailabilityDetail,
  type StoreAvailabilityMode,
  listStoreCategories,
  patchOnlineStoreItem,
  patchOnlineStoreListing,
  storeListingImageUrl,
  uploadOnlineStoreListingImage,
  type StoreAdminListing,
  type StoreCategory,
} from '../api/onlineStore';
import CatalogBundles from '../components/catalog/CatalogBundles';
import { listBundles, type Bundle } from '../api/memberships';
import CatalogInventoryClinicalFields from '../components/catalog/CatalogInventoryClinicalFields';
import CatalogItemRemindersEditor from '../components/catalog/CatalogItemRemindersEditor';
import LabIntegrationEditor from '../components/catalog/LabIntegrationEditor';
import CatalogItemLotsEditor from '../components/catalog/CatalogItemLotsEditor';
import CatalogTagalongsEditor from '../components/catalog/CatalogTagalongsEditor';
import InventoryItemHistory from '../components/inventory/InventoryItemHistory';
import RecommendedAbcInfo from '../components/inventory/RecommendedAbcInfo';
import { listPatientStatuses, type PatientStatusRow } from '../api/patientStatuses';
import {
  listPracticeBranches,
  getInventoryBranchStock,
  upsertInventoryBranchStock,
  postInventoryMovement,
  upsertBranchPriceOverride,
  postEffectiveBranchPrice,
  type PracticeBranch,
  type BranchPriceOverride,
  type BranchPriceOverrideEntityType,
  type MoneyFields,
  type InventoryBranchStock,
  type PostInventoryMovementBody,
} from '../api/branchInventory';
import { resolveDefaultLocationId } from '../utils/inventoryLocationTargets';
import { refreshInventoryAbc } from '../api/inventoryCounts';
import {
  getPracticeSettings,
  isOnlineStoreImplemented,
} from '../api/practiceSettings';
import { getPracticeTaxSettings, type PracticeTaxSettings } from '../api/taxes';
import {
  listCatalogCategories,
  categorySelectValue,
  type CatalogCategory,
} from '../api/catalogCategories';
import TaxLevelSelect, {
  taxLevelSelectValue,
} from '../components/catalog/TaxLevelSelect';
import CategorySelect from '../components/catalog/CategorySelect';
import { getPreDiscountForOneUnit } from '../utils/catalogItemPricing';
import { Archive, ArchiveRestore, Copy, X, ChevronDown, ChevronRight } from 'lucide-react';
import './Settings.css';
import './Catalog.css';
import { currentPracticeId } from '../utils/practiceIdFromToken';

const BRANCH_STORAGE_PREFIX = 'vayd_inventory_branch:';
/** Pseudo-id in priceTargetBranchIds for the Online Store price target (not a real branch). */
const ONLINE_STORE_TARGET_ID = -1;

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function resolvePracticeId(token: string | null): number {
  if (token) {
    const p = decodeJwtPayload(token);
    const raw = p?.practiceId ?? p?.practice_id;
    if (raw != null) {
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
    }
  }
  return currentPracticeId();
}

function toMoneyNumber(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

type ResolvedMoney = { price: number; cost: number; serviceFee: number; minimumPrice: number };

function moneyBaseFromCatalogRow(row: Record<string, unknown>): ResolvedMoney {
  return {
    price: toMoneyNumber(row.price),
    cost: toMoneyNumber(row.cost),
    serviceFee: toMoneyNumber(row.serviceFee),
    minimumPrice: toMoneyNumber(row.minimumPrice),
  };
}

function effectiveToResolved(m: MoneyFields): ResolvedMoney {
  return {
    price: m.price ?? 0,
    cost: m.cost ?? 0,
    serviceFee: m.serviceFee ?? 0,
    minimumPrice: m.minimumPrice ?? 0,
  };
}

/**
 * Sell total for one unit using the same formulas SOAP / checkout run
 * ({@link getPreDiscountForOneUnit}): labs are price only, procedures add the service fee, and
 * inventory adds the fee then floors at the minimum price.
 */
function unitSellTotal(
  itemType: ItemType,
  money: { price?: number | null; serviceFee?: number | null; minimumPrice?: number | null }
): number {
  return getPreDiscountForOneUnit({
    itemType,
    price: toMoneyNumber(money.price),
    serviceFee: toMoneyNumber(money.serviceFee),
    minimumPrice: toMoneyNumber(money.minimumPrice),
  });
}

function itemTypeToEntityType(itemType: ItemType): BranchPriceOverrideEntityType {
  if (itemType === 'inventory') return 'inventory_item';
  if (itemType === 'lab') return 'lab';
  return 'procedure';
}

function entityIdFromSelection(itemType: ItemType, row: SearchResultItem): number | null {
  if (itemType === 'inventory') return row.inventoryItem?.id ?? null;
  if (itemType === 'lab') return row.lab?.id ?? null;
  return row.procedure?.id ?? null;
}

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function catalogEntity(row: SearchResultItem): InventoryItem | Lab | Procedure | null {
  if (row.itemType === 'inventory') return row.inventoryItem ?? null;
  if (row.itemType === 'lab') return row.lab ?? null;
  return row.procedure ?? null;
}

function catalogCost(row: SearchResultItem): number {
  const e = catalogEntity(row);
  if (!e) return 0;
  return toMoneyNumber((e as Record<string, unknown>).cost);
}

function catalogServiceFee(row: SearchResultItem): number {
  const e = catalogEntity(row);
  if (!e) return 0;
  return toMoneyNumber((e as Record<string, unknown>).serviceFee);
}

function catalogSellUnit(row: SearchResultItem): string {
  if (row.itemType !== 'inventory' || !row.inventoryItem) return 'each';
  const u = pickStr(row.inventoryItem.sellUnitType);
  return u ?? 'each';
}

/**
 * `bundle` is not a catalog table like the others — it is the sell-once package store, which
 * has its own list and editor rather than a row in the item search results.
 */
type CatalogTypeFilter = ItemType | 'all' | 'bundle';

const CATALOG_PAGE_SIZE = 100;

function defaultStockLocation(stock?: InventoryBranchStock | null) {
  const locs = stock?.locations ?? [];
  const id = resolveDefaultLocationId(locs);
  if (id == null) return null;
  return locs.find((l) => l.branchLocationId === id) ?? null;
}

function typeFilterFromSearch(search: string): CatalogTypeFilter {
  const t = new URLSearchParams(search).get('type');
  if (t === 'procedure' || t === 'lab' || t === 'inventory' || t === 'bundle') return t;
  return 'all';
}

function applyCatalogTypeFilter(
  rows: SearchResultItem[],
  typeFilter: CatalogTypeFilter
): SearchResultItem[] {
  if (typeFilter === 'all' || typeFilter === 'bundle') return rows;
  return rows.filter((r) => r.itemType === typeFilter);
}

function catalogTypeLabel(itemType: ItemType): string {
  if (itemType === 'inventory') return 'Product';
  if (itemType === 'lab') return 'Lab';
  return 'Procedure';
}

function addItemLabel(typeFilter: CatalogTypeFilter): string {
  if (typeFilter === 'procedure') return 'Add procedure';
  if (typeFilter === 'lab') return 'Add lab';
  if (typeFilter === 'inventory') return 'Add product';
  if (typeFilter === 'bundle') return 'Add bundle';
  return 'Add item';
}

function catalogIsActive(row: SearchResultItem): boolean {
  const e = catalogEntity(row);
  if (!e) return true;
  const a = (e as Record<string, unknown>).isActive;
  return a !== false;
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function catalogMarkupPct(price: number, cost: number): string {
  if (!Number.isFinite(cost) || cost <= 0) return '—';
  const pct = (price / cost) * 100;
  return `${pct.toFixed(1)}%`;
}

const SELL_UNIT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '(not set)' },
  { value: 'capsule', label: 'Capsule' },
  { value: 'tablet', label: 'Tablet' },
  { value: 'bottle', label: 'Bottle' },
  { value: 'package', label: 'Package' },
  { value: 'ml', label: 'mL' },
  { value: 'gram', label: 'Gram' },
  { value: 'each', label: 'Each' },
  { value: 'other', label: 'Other' },
];

const VACCINE_TYPE_OPTIONS = [
  'Live',
  'Modified Live',
  'Killed',
  'Recombinant',
  'RNA',
  'Other',
];

const EMPTY_INVENTORY_CREATE = {
  name: '',
  code: '',
  price: '',
  cost: '',
  markup: '',
  serviceFee: '',
  minimumPrice: '',
  isMedication: false,
  excludePercentageDiscount: false,
  isShippingType: false,
  taxLevelValue: 1,
  category: '',
  manufacturer: '',
  vendorName: '',
  vendorDrugNumber: '',
  barcode: '',
  defaultQuantity: '',
  requireExpirationOnLots: true,
  requireLotNumber: false,
  trackLots: true,
  isVaccine: false,
  dispenseNote: '',
  isControlled: false,
  isMicrochip: false,
  hasClientNotes: false,
  clientNote: '',
  hideOnInvoice: false,
  hideOnMedicalRecordView: false,
  hideOnMedicalRecordPrint: false,
  excludeFromProduction: false,
  changePatientStatusTo: '',
  changePatientSex: false,
  vaccineName: '',
  vaccineManufacturer: '',
  vaccineType: '',
  dosageType: '',
  createRabiesCertificate: false,
  usdaLicensingMonths: '',
  animalControlLicensingMonths: '',
  tagIssuePeriodMonths: '',
};

function optionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

type CatalogDiscountDraft = {
  excludePercentageDiscount: boolean;
};

function catalogDiscountFromItem(item: Lab | Procedure | InventoryItem): CatalogDiscountDraft {
  return { excludePercentageDiscount: Boolean(item.excludePercentageDiscount) };
}

function catalogDiscountBody(d: CatalogDiscountDraft): Record<string, unknown> {
  return { excludePercentageDiscount: d.excludePercentageDiscount };
}

function CatalogDiscountRulesFields({
  value,
  onChange,
}: {
  value: CatalogDiscountDraft;
  onChange: (patch: Partial<CatalogDiscountDraft>) => void;
}) {
  return (
    <div style={{ marginTop: 16, marginBottom: 8 }}>
      <h4 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 6px' }}>Discounts</h4>
      <label className="settings-checkbox-item" style={{ marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={value.excludePercentageDiscount}
          onChange={(e) =>
            onChange({ excludePercentageDiscount: e.target.checked })
          }
        />
        <span>
          Exclude percentage discounts
          <small style={{ display: 'block', color: '#6b7280' }}>
            Percent-off client statuses and personal % off won’t apply to this item.
            Staff accounts still get their employee pricing.
          </small>
        </span>
      </label>
    </div>
  );
}

/** Markup the way eVet stores and shows it: price as a percent of cost (200 = cost × 2). */
function markupPctFromCostPrice(costStr: string, priceStr: string): string {
  const cost = optionalNumber(costStr);
  const price = optionalNumber(priceStr);
  if (cost === null || price === null || cost <= 0) return '';
  return ((price / cost) * 100).toFixed(2);
}

/** Price = cost × markup %, blank when either is missing. */
function priceFromCostMarkup(costStr: string, markupStr: string): string {
  const cost = optionalNumber(costStr);
  const markup = optionalNumber(markupStr);
  if (cost === null || markup === null) return '';
  return ((cost * markup) / 100).toFixed(2);
}

export type CatalogEmbedProps = {
  itemId: number;
  itemType?: ItemType;
  label?: string;
  onClose: () => void;
  /** Walk through every tab with Save & next (new items). */
  guidedSetup?: boolean;
  /**
   * Opened from a cost review: Details starts with the invoice cost and suggested price filled
   * in (highlighted). Nothing changes until the user saves; `onConfirm` then resolves the review.
   */
  costReview?: {
    previousCost: number | null;
    newCost: number;
    previousPrice: number | null;
    suggestedPrice: number | null;
    onConfirm: (values: { cost: number | null; price: number | null }) => Promise<void>;
  };
};

const SETUP_TAB_LABELS: Record<string, string> = {
  details: 'Details',
  clinical: 'Clinical',
  lots: 'Lots',
  stock: 'Stock',
  pricing: 'Pricing',
  'online-store': 'Online store',
  associations: 'Associations',
};

const SETUP_TAB_HINTS: Record<string, string> = {
  details: 'Name, code, unit, cost, markup, price, category, and which offices see it.',
  clinical: 'Medication, vaccine, controlled, lot rules, label directions, and invoice/record flags.',
  lots: 'Add any lots already on the shelf (lot #, expiration, quantity). Skip if none yet.',
  stock: 'Reorder points and par levels per office. These save as you set them.',
  pricing: 'Office-specific prices and quantity price breaks. These save as you set them.',
  'online-store': 'Listing, web price, description, category, picture, and home page.',
  associations: 'Draws from (stock link), tagalongs, and reminders. These save as you set them.',
};

export default function Catalog({ embed }: { embed?: CatalogEmbedProps } = {}) {
  const { token } = useAuth() as { token: string | null };
  const { can } = usePermissions();
  const canCreateItem = can('catalog.item.create');
  const canEditItem = can('catalog.item.edit');
  const practiceId = useMemo(() => resolvePracticeId(token), [token]);

  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [branchId, setBranchId] = useState<number | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [bundleHits, setBundleHits] = useState<Bundle[]>([]);
  const [focusBundleId, setFocusBundleId] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showAllItems, setShowAllItems] = useState(false);
  const [hasMoreResults, setHasMoreResults] = useState(false);
  const [loadingMoreResults, setLoadingMoreResults] = useState(false);
  const searchSeq = useRef(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const typeFilter = typeFilterFromSearch(searchParams.toString());
  const [showArchived, setShowArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createType, setCreateType] = useState<ItemType>('inventory');
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState(EMPTY_INVENTORY_CREATE);
  const [createPatientStatuses, setCreatePatientStatuses] = useState<PatientStatusRow[]>([]);

  useEffect(() => {
    if (!createOpen) return;
    let cancelled = false;
    void listPatientStatuses()
      .then((rows) => {
        if (!cancelled) setCreatePatientStatuses(rows);
      })
      .catch(() => {
        if (!cancelled) setCreatePatientStatuses([]);
      });
    return () => {
      cancelled = true;
    };
  }, [createOpen]);

  /** Latest cost/price typed during a cost review, so detail refreshes don't wipe them. */
  const reviewValuesRef = useRef<{ cost: string; price: string; markup?: string } | null>(null);
  const [reviewFlashKey, setReviewFlashKey] = useState(0);
  const [reviewConfirming, setReviewConfirming] = useState(false);
  const hasCostReview = Boolean(embed?.costReview);

  const [coreDraft, setCoreDraft] = useState({
    name: '',
    code: '',
    price: '',
    cost: '',
    markup: '',
    serviceFee: '',
    minimumPrice: '',
    isMedication: false,
    excludePercentageDiscount: false,
    isShippingType: false,
    hideOnInvoice: false,
    excludeFromProduction: false,
    changePatientStatusTo: '',
    changePatientSex: false,
    isAftercare: false,
    aftercareType: '' as AftercareItemType | '',
    aftercareDisplayName: '',
    taxLevelValue: 1,
    category: '',
    assignedAbc: '',
    sellUnitType: '',
    sellUnitTypeDetail: '',
  });
  const [taxSettings, setTaxSettings] = useState<PracticeTaxSettings | null>(null);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [storeCategories, setStoreCategories] = useState<StoreCategory[]>([]);
  const [storeListing, setStoreListing] = useState<StoreAdminListing | null>(null);
  /** A store product grouping several SKUs; its description and category are shared. */
  const sharedStoreListing =
    storeListing && storeListing.variants.length > 1 ? storeListing : null;

  function setTypeFilter(next: CatalogTypeFilter) {
    const nextParams = new URLSearchParams(searchParams);
    if (next === 'all') nextParams.delete('type');
    else nextParams.set('type', next);
    setSearchParams(nextParams, { replace: true });
  }

  const [coreSaving, setCoreSaving] = useState(false);
  const [coreError, setCoreError] = useState<string | null>(null);
  const [archiveBusyId, setArchiveBusyId] = useState<string | null>(null);

  const [selected, setSelected] = useState<{
    itemType: ItemType;
    itemId: number;
    label: string;
  } | null>(null);

  useEffect(() => {
    if (!createOpen) return;
    let cancelled = false;
    listCatalogCategories(practiceId, createType)
      .then((cats) => {
        if (!cancelled) setCategories(cats);
      })
      .catch(() => {
        if (!cancelled) setCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [createOpen, createType, practiceId]);

  useEffect(() => {
    if (!selected || createOpen) return;
    let cancelled = false;
    listCatalogCategories(practiceId, selected.itemType)
      .then((cats) => {
        if (!cancelled) setCategories(cats);
      })
      .catch(() => {
        if (!cancelled) setCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [createOpen, practiceId, selected]);

  // Online store "+ Add inventory item" opens the catalog create modal.
  useEffect(() => {
    const create = searchParams.get('create');
    if (create !== 'inventory' && create !== 'product' && create !== '1') return;
    if (!canCreateItem) return;
    setCreateError(null);
    setCreateForm(EMPTY_INVENTORY_CREATE);
    setCreateType('inventory');
    setCreateOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('create');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, canCreateItem]);

  useEffect(() => {
    if (!embed) return;
    setSelected({
      itemType: embed.itemType ?? 'inventory',
      itemId: embed.itemId,
      label: embed.label?.trim() || 'Item',
    });
  }, [embed?.itemId, embed?.itemType, embed?.label]);

  // Deep-link from counts / other pages: /inventory/items?itemId=123&name=...
  useEffect(() => {
    if (embed) return;
    const raw = searchParams.get('itemId');
    if (raw == null || String(raw).trim() === '') return;
    const itemId = Number(raw);
    if (!Number.isFinite(itemId) || itemId <= 0) return;
    const name = searchParams.get('name')?.trim() || 'Item';
    const itemType =
      searchParams.get('itemType') === 'procedure' ? 'procedure' : 'inventory';
    setSelected((prev) => {
      if (prev?.itemType === itemType && prev.itemId === itemId) {
        return prev.label === name ? prev : { ...prev, label: name };
      }
      return { itemType, itemId, label: name };
    });
  }, [searchParams, embed]);

  function catalogReturnTo() {
    const raw = searchParams.get('returnTo');
    if (!raw) return null;
    if (!raw.startsWith('/') || raw.startsWith('//')) return null;
    return raw;
  }

  function closeItemDetailModal() {
    setSetupForId(null);
    setSetupListOnStore(false);
    if (embed) {
      embed.onClose();
      return;
    }
    setSelected(null);
    const dest = catalogReturnTo();
    if (dest) {
      navigate(dest);
      return;
    }
    if (!searchParams.has('itemId') && !searchParams.has('name')) return;
    const next = new URLSearchParams(searchParams);
    next.delete('itemId');
    next.delete('name');
    setSearchParams(next, { replace: true });
  }

  function closeCreateModal() {
    const dest = catalogReturnTo();
    if (dest) {
      navigate(dest);
      return;
    }
    setCreateOpen(false);
  }

  const [detail, setDetail] = useState<ItemWithPriceBreaks | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'details' | 'clinical' | 'lots' | 'stock' | 'pricing' | 'online-store' | 'associations' | 'history'>('details');

  const procedureDetailOpen = detail?.itemType === 'procedure';
  useEffect(() => {
    if (!procedureDetailOpen || createPatientStatuses.length > 0) return;
    let cancelled = false;
    void listPatientStatuses()
      .then((rows) => {
        if (!cancelled) setCreatePatientStatuses(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [procedureDetailOpen, createPatientStatuses.length]);

  /** Tab to land on when the next item opens (a just-created item continues past Details). */
  const pendingStartTabRef = useRef<typeof detailTab | null>(null);

  // Reset to Details tab whenever a new item is opened
  useEffect(() => {
    setDetailTab(pendingStartTabRef.current ?? 'details');
    pendingStartTabRef.current = null;
  }, [selected?.itemType, selected?.itemId]);

  const [stockByBranchId, setStockByBranchId] = useState<Record<number, InventoryBranchStock>>({});
  /** Item the counts / reorder / movements apply to: the linked stock item, else this item. */
  const [stockItemId, setStockItemId] = useState<number | null>(null);
  const [countsExpandedBranchId, setCountsExpandedBranchId] = useState<number | null>(null);
  const [reorderDraftByBranchId, setReorderDraftByBranchId] = useState<Record<number, string>>({});
  const [parDraftByBranchId, setParDraftByBranchId] = useState<Record<number, string>>({});
  const [parDraftByLocationKey, setParDraftByLocationKey] = useState<Record<string, string>>({});
  /** Manual on-hand drafts keyed by `${branchId}:${branchLocationId}`. */
  const [qtyDraftByLocationKey, setQtyDraftByLocationKey] = useState<Record<string, string>>({});
  const [stockLoading, setStockLoading] = useState(false);
  const [stockSaving, setStockSaving] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);

  /** Page-level locations (cost summary branch). */

  const [effective, setEffective] = useState<MoneyFields | null>(null);
  /** Effective money for every active practice branch (item pricing table). */
  const [branchEffectiveById, setBranchEffectiveById] = useState<Record<number, MoneyFields>>({});
  /** Each branch's own override row (null = follows the practice). */
  const [branchOverrideById, setBranchOverrideById] = useState<
    Record<number, BranchPriceOverride | null>
  >({});
  const [branchHiddenSaving, setBranchHiddenSaving] = useState<number | null>(null);
  /** Branch modal markup (percent of cost); blank = fixed price. */
  const [priceMarkup, setPriceMarkup] = useState('');
  const [branchPricesLoading, setBranchPricesLoading] = useState(false);
  const [branchPricesError, setBranchPricesError] = useState<string | null>(null);
  const [priceModalOpen, setPriceModalOpen] = useState(false);
  const [priceForm, setPriceForm] = useState<ResolvedMoney>({
    price: 0,
    cost: 0,
    serviceFee: 0,
    minimumPrice: 0,
  });
  /** Branches that receive the override on Save / Clear. May include ONLINE_STORE_TARGET_ID. */
  const [priceTargetBranchIds, setPriceTargetBranchIds] = useState<number[]>([]);
  const [priceSaving, setPriceSaving] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  /** Company setting: practice runs an online store (Settings → Inventory). */
  const [onlineStoreImplemented, setOnlineStoreImplemented] = useState(false);

  const [toast, setToast] = useState<string | null>(null);
  const [justSavedKey, setJustSavedKey] = useState<string | null>(null);
  const justSavedClearRef = useRef<number | null>(null);


  const [bulkSelectMode, setBulkSelectMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Record<number, string>>({});
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkPctPractice, setBulkPctPractice] = useState('');
  const [bulkPctOnline, setBulkPctOnline] = useState('');
  const [bulkFlatPractice, setBulkFlatPractice] = useState('');
  const [bulkFlatOnline, setBulkFlatOnline] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const [storeStock, setStoreStock] = useState<StoreAvailabilityDetail | null>(null);
  const [catalogSaving, setCatalogSaving] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogDraft, setCatalogDraft] = useState({
    description: '',
    shippable: false,
    showOnOnlineStore: false,
    requiresDoctorApproval: false,
    passThroughByDefault: false,
    storeAvailability: 'always' as StoreAvailabilityMode,
    storeBackInStockDate: '',
    storeAllowBackorder: false,
    storeStockBuffer: '0',
    autoshipOffered: false,
    autoshipFrequency: 'monthly',
    onlineStorePrice: '',
    storeCategory: '',
    featuredOnHome: false,
  });
  /** Item being walked through every tab after it was created (or from a new-item cost review). */
  const [setupForId, setSetupForId] = useState<number | null>(
    embed?.guidedSetup ? embed.itemId : null
  );
  /** Pre-check “Listed” and the web price when guided setup reaches the Online store tab. */
  const [setupListOnStore, setSetupListOnStore] = useState(false);
  const clinicalSaveRef = useRef<(() => Promise<boolean>) | null>(null);
  /**
   * Master stock item this code draws down (null = draws on itself). Counts, reorder points and
   * movements all belong to the stock item, not to each sellable code.
   */
  const [stockLinkItemId, setStockLinkItemId] = useState<number | null>(null);
  const [stockLinkItemLabel, setStockLinkItemLabel] = useState('');
  const [stockLinkQty, setStockLinkQty] = useState('');
  const [stockLinkQuery, setStockLinkQuery] = useState('');
  const [stockLinkResults, setStockLinkResults] = useState<SearchResultItem[]>([]);
  const [stockLinkSearching, setStockLinkSearching] = useState(false);
  const [stockLinkSaving, setStockLinkSaving] = useState(false);
  const [stockLinkError, setStockLinkError] = useState<string | null>(null);
  const stockLinkSearchSeq = useRef(0);

  const [itemHasImage, setItemHasImage] = useState(false);
  const [itemImageVersion, setItemImageVersion] = useState(0);
  const [imageUploading, setImageUploading] = useState(false);
  const itemImageInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [list, settings, tax, cats] = await Promise.all([
          listPracticeBranches(practiceId),
          getPracticeSettings(practiceId).catch(() => ({})),
          getPracticeTaxSettings(practiceId).catch(() => null),
          listCatalogCategories(practiceId, 'inventory').catch(() => []),
        ]);
        if (cancelled) return;
        setOnlineStoreImplemented(isOnlineStoreImplemented(settings));
        setTaxSettings(tax);
        setCategories(cats);
        const active = list.filter((b) => b.isActive !== false);
        setBranches(active);
        let initial: number | null = null;
        try {
          const stored = localStorage.getItem(`${BRANCH_STORAGE_PREFIX}${practiceId}`);
          if (stored) {
            const n = Number(stored);
            if (Number.isFinite(n) && active.some((b) => b.id === n)) initial = n;
          }
        } catch {
          /* ignore */
        }
        if (initial == null) {
          const def = active.find((b) => b.isDefault);
          initial = def?.id ?? active[0]?.id ?? null;
        }
        setBranchId(initial);
      } catch {
        if (!cancelled) {
          setBranches([]);
          setBranchId(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [practiceId]);

  useEffect(() => {
    if (!onlineStoreImplemented) {
      setStoreCategories([]);
      return;
    }
    let cancelled = false;
    listStoreCategories(practiceId)
      .then((rows) => {
        if (!cancelled) setStoreCategories(rows);
      })
      .catch(() => {
        if (!cancelled) setStoreCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [onlineStoreImplemented, practiceId]);

  useEffect(() => {
    if (!detail) return;
    const item = detail.item as InventoryItem | Lab | Procedure;
    const review = embed?.costReview;
    const reviewValues = review
      ? (reviewValuesRef.current ?? {
          cost: String(review.newCost),
          price:
            review.suggestedPrice != null
              ? String(review.suggestedPrice)
              : item.price != null && item.price !== ''
                ? String(item.price)
                : '',
        })
      : null;
    if (review && !reviewValuesRef.current) setReviewFlashKey(Date.now());
    setCoreDraft({
      name: String(item.name ?? ''),
      code: item.code != null ? String(item.code) : '',
      price: reviewValues
        ? reviewValues.price
        : item.price != null && item.price !== ''
          ? String(item.price)
          : '',
      cost: reviewValues
        ? reviewValues.cost
        : item.cost != null && item.cost !== ''
          ? String(item.cost)
          : '',
      markup:
        reviewValues?.markup != null
          ? reviewValues.markup
          : detail.itemType === 'inventory'
          ? (item as InventoryItem).markup != null
            ? String(Number((item as InventoryItem).markup))
            : ''
          : markupPctFromCostPrice(
              item.cost != null ? String(item.cost) : '',
              item.price != null ? String(item.price) : ''
            ),
      serviceFee:
        (item as Procedure | InventoryItem).serviceFee != null &&
        (item as Procedure | InventoryItem).serviceFee !== ''
          ? String((item as Procedure | InventoryItem).serviceFee)
          : '',
      minimumPrice:
        detail.itemType === 'inventory' &&
        (item as InventoryItem).minimumPrice != null &&
        (item as InventoryItem).minimumPrice !== ''
          ? String((item as InventoryItem).minimumPrice)
          : '',
      isMedication:
        detail.itemType === 'inventory' && (item as InventoryItem).isMedication === true,
      ...catalogDiscountFromItem(item as Lab | Procedure | InventoryItem),
      isShippingType: Boolean((item as Procedure).isShippingType),
      hideOnInvoice: Boolean((item as Procedure).hideOnInvoice),
      excludeFromProduction: Boolean((item as Procedure).excludeFromProduction),
      changePatientStatusTo:
        detail.itemType === 'procedure'
          ? ((item as Procedure).changePatientStatusTo ?? '').trim()
          : '',
      changePatientSex:
        detail.itemType === 'procedure' && (item as Procedure).changePatientSex === true,
      isAftercare: Boolean((item as Procedure).isAftercare),
      aftercareType: ((item as Procedure).aftercareType ?? '') as AftercareItemType | '',
      aftercareDisplayName: (item as Procedure).aftercareDisplayName ?? '',
      taxLevelValue: taxLevelSelectValue(
        (item as InventoryItem | Lab | Procedure).taxLevelValue
      ),
      category: categorySelectValue(
        (item as InventoryItem | Lab | Procedure).category
      ),
      assignedAbc:
        detail.itemType === 'inventory' && (item as InventoryItem).assignedAbc
          ? String((item as InventoryItem).assignedAbc)
          : '',
      sellUnitType:
        detail.itemType === 'inventory' ? (item as InventoryItem).sellUnitType || '' : '',
      sellUnitTypeDetail:
        detail.itemType === 'inventory' ? (item as InventoryItem).sellUnitTypeDetail || '' : '',
    });
    if (reviewValues && !reviewValuesRef.current) reviewValuesRef.current = reviewValues;
  }, [detail]);

  useEffect(() => {
    if (!hasCostReview || !reviewValuesRef.current) return;
    reviewValuesRef.current = {
      cost: coreDraft.cost,
      price: coreDraft.price,
      markup: coreDraft.markup,
    };
  }, [coreDraft.cost, coreDraft.price, coreDraft.markup, hasCostReview]);

  async function confirmCostReview() {
    const review = embed?.costReview;
    if (!review) return;
    setReviewConfirming(true);
    try {
      const saved = await saveCoreFields();
      if (!saved) return;
      await review.onConfirm({
        cost: optionalNumber(coreDraft.cost),
        price: optionalNumber(coreDraft.price),
      });
      embed?.onClose();
    } catch (e: unknown) {
      setCoreError(e instanceof Error ? e.message : 'Could not finish the cost review');
    } finally {
      setReviewConfirming(false);
    }
  }

  useEffect(() => {
    if (!detail || detail.itemType !== 'procedure') return;
    const item = detail.item as Procedure;
    setCatalogDraft({
      description: '',
      shippable: false,
      showOnOnlineStore: false,
      requiresDoctorApproval: false,
      passThroughByDefault: false,
      storeAvailability: 'always',
      storeBackInStockDate: '',
      storeAllowBackorder: false,
      storeStockBuffer: '0',
      autoshipOffered: false,
      autoshipFrequency: 'monthly',
      onlineStorePrice:
        item.price != null && String(item.price).trim() !== '' ? String(item.price) : '',
      storeCategory: '',
      featuredOnHome: false,
    });
    setItemHasImage(false);
  }, [detail]);

  useEffect(() => {
    if (!detail || (detail.itemType !== 'inventory' && detail.itemType !== 'procedure')) {
      setStoreListing(null);
      return;
    }
    let cancelled = false;
    const q =
      detail.itemType === 'procedure'
        ? { procedureId: selected?.itemId }
        : { inventoryItemId: selected?.itemId };
    if (!q.procedureId && !q.inventoryItemId) return undefined;
    getCatalogStoreListing(practiceId, q)
      .then((listing) => {
        if (cancelled) return;
        setStoreListing(listing);
        if (detail.itemType === 'procedure') {
          setItemHasImage(Boolean(listing?.hasImage));
        }
        setCatalogDraft((d) => ({
          ...d,
          storeCategory: listing?.storeCategory || d.storeCategory || '',
          featuredOnHome: Boolean(listing?.featuredOnHome),
          showOnOnlineStore:
            detail.itemType === 'procedure'
              ? Boolean(listing?.listed)
              : d.showOnOnlineStore,
          description:
            detail.itemType === 'procedure'
              ? listing?.description || d.description
              : d.description,
          requiresDoctorApproval:
            detail.itemType === 'procedure'
              ? listing?.approvalTag === 'needs_doctor_approval'
              : d.requiresDoctorApproval,
        }));
      })
      .catch(() => {
        if (!cancelled) setStoreListing(null);
      });
    return () => {
      cancelled = true;
    };
  }, [detail, practiceId, selected?.itemId]);

  useEffect(() => {
    setStoreStock(null);
    if (!detail || detail.itemType !== 'inventory' || !selected?.itemId) return;
    if (((detail.item as InventoryItem).storeAvailability || 'always') !== 'stock') return;
    let cancelled = false;
    void getStoreItemAvailability(practiceId, selected.itemId)
      .then((row) => {
        if (!cancelled) setStoreStock(row);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [detail, practiceId, selected?.itemId]);

  useEffect(() => {
    if (!detail || detail.itemType !== 'inventory') return;
    const item = detail.item as InventoryItem;
    const raw = item.showOnOnlineStore as unknown;
    const shipRaw = item.shippable as unknown;
    setCatalogDraft((prev) => ({
      featuredOnHome: prev.featuredOnHome,
      description: item.description != null ? String(item.description) : '',
      shippable: shipRaw === true || shipRaw === 'true' || shipRaw === 1 || shipRaw === '1',
      showOnOnlineStore: raw === true || raw === 'true' || raw === 1 || raw === '1',
      requiresDoctorApproval: item.requiresDoctorApproval === true,
      passThroughByDefault: item.passThroughByDefault === true,
      storeAvailability: item.storeAvailability || 'always',
      storeBackInStockDate: (item.storeBackInStockDate || '').slice(0, 10),
      storeAllowBackorder: item.storeAllowBackorder === true,
      storeStockBuffer: String(item.storeStockBuffer ?? 0),
      autoshipOffered: Boolean(item.autoshipRecommendedFrequency),
      autoshipFrequency: item.autoshipRecommendedFrequency || 'monthly',
      onlineStorePrice:
        item.onlineStorePrice != null && String(item.onlineStorePrice).trim() !== ''
          ? String(item.onlineStorePrice)
          : '',
      storeCategory: '',
    }));
    setItemHasImage(Boolean(item.imageUrl && String(item.imageUrl).trim()));

    const linkedId =
      item.linkedInventoryItemId != null && Number.isFinite(Number(item.linkedInventoryItemId))
        ? Number(item.linkedInventoryItemId)
        : null;
    setStockLinkItemId(linkedId);
    setStockLinkQty(
      item.linkedInventoryItemDefaultQuantity != null &&
        String(item.linkedInventoryItemDefaultQuantity).trim() !== ''
        ? String(item.linkedInventoryItemDefaultQuantity)
        : ''
    );
    setStockLinkQuery('');
    setStockLinkResults([]);
    setStockLinkError(null);
  }, [detail]);

  useEffect(() => {
    if (!setupListOnStore || detailTab !== 'online-store') return;
    if (!detail || detail.itemType !== 'inventory' || setupForId !== selected?.itemId) return;
    const item = detail.item as InventoryItem;
    const catalogPrice =
      item.price != null && String(item.price).trim() !== '' ? String(item.price) : '';
    setSetupListOnStore(false);
    setCatalogDraft((d) => ({
      ...d,
      showOnOnlineStore: true,
      onlineStorePrice: d.onlineStorePrice.trim() === '' ? catalogPrice : d.onlineStorePrice,
    }));
  }, [setupListOnStore, detailTab, detail, setupForId, selected?.itemId]);

  useEffect(() => {
    if (!detail || detail.itemType !== 'lab') return;
    const lab = detail.item as Lab;
    const linkedId =
      lab.linkedInventoryItemId != null && Number.isFinite(Number(lab.linkedInventoryItemId))
        ? Number(lab.linkedInventoryItemId)
        : null;
    setStockLinkItemId(linkedId);
    setStockLinkQty(
      lab.linkedInventoryItemDefaultQuantity != null ? String(lab.linkedInventoryItemDefaultQuantity) : ''
    );
    setStockLinkQuery('');
    setStockLinkResults([]);
    setStockLinkError(null);
  }, [detail]);

  /** The link is stored as an id; fetch the stock item so the picker can name it. */
  useEffect(() => {
    if (stockLinkItemId == null) {
      setStockLinkItemLabel('');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const linked = await getItemWithPriceBreaks('inventory', stockLinkItemId, practiceId);
        if (!cancelled) setStockLinkItemLabel(linked.item.name);
      } catch {
        if (!cancelled) setStockLinkItemLabel(`Item #${stockLinkItemId}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stockLinkItemId, practiceId]);

  useEffect(() => {
    const q = stockLinkQuery.trim();
    if (!q) {
      setStockLinkResults([]);
      return;
    }
    const seq = ++stockLinkSearchSeq.current;
    const t = window.setTimeout(async () => {
      setStockLinkSearching(true);
      try {
        // Stock rows like "4dx Tests" or "Gabapentin 100 mg inventory" are often inactive.
        const rows = await searchItems(q, practiceId, 25, { includeInactive: true });
        if (stockLinkSearchSeq.current !== seq) return;
        setStockLinkResults(
          rows.filter(
            (r) =>
              r.itemType === 'inventory' &&
              r.inventoryItem?.id !== selected?.itemId &&
              r.inventoryItem?.linkedInventoryItemId == null &&
              r.inventoryItem?.isDeleted !== true
          )
        );
      } catch {
        if (stockLinkSearchSeq.current === seq) setStockLinkResults([]);
      } finally {
        if (stockLinkSearchSeq.current === seq) setStockLinkSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [stockLinkQuery, practiceId, selected?.itemId]);

  const fetchCatalogPage = useCallback(
    (offset: number, limit: number) =>
      searchItems(searchQuery.trim(), practiceId, limit, {
        includeInactive: showArchived,
        all: showAllItems,
        offset,
        types: typeFilter === 'all' || typeFilter === 'bundle' ? undefined : [typeFilter],
      }),
    [searchQuery, practiceId, showArchived, showAllItems, typeFilter]
  );

  useEffect(() => {
    const q = searchQuery.trim();
    if ((!q && !showAllItems) || typeFilter === 'bundle') {
      setSearchResults([]);
      setBundleHits([]);
      setSearchError(null);
      setHasMoreResults(false);
      return;
    }
    const seq = ++searchSeq.current;
    const t = window.setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const [rows, bundles] = await Promise.all([
          fetchCatalogPage(0, CATALOG_PAGE_SIZE),
          typeFilter === 'all'
            ? listBundles({
                kind: 'bundle',
                includeArchived: showArchived,
                q: q || undefined,
              }).catch(() => [] as Bundle[])
            : Promise.resolve([] as Bundle[]),
        ]);
        if (searchSeq.current !== seq) return;
        setSearchResults(applyCatalogTypeFilter(rows, typeFilter));
        setHasMoreResults(rows.length === CATALOG_PAGE_SIZE);
        const needle = q.toLowerCase();
        setBundleHits(
          q
            ? bundles
                .filter(
                  (b) =>
                    b.name.toLowerCase().includes(needle) ||
                    (b.code ?? '').toLowerCase().includes(needle) ||
                    (b.marketingSummary ?? '').toLowerCase().includes(needle),
                )
                .slice(0, 25)
            : bundles,
        );
      } catch (e: unknown) {
        if (searchSeq.current === seq) {
          setSearchResults([]);
          setBundleHits([]);
          setSearchError(
            e instanceof Error ? e.message : 'Search failed. Try again.',
          );
        }
      } finally {
        if (searchSeq.current === seq) setSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchQuery, showAllItems, showArchived, typeFilter, fetchCatalogPage]);

  async function loadMoreCatalogRows() {
    const seq = searchSeq.current;
    setLoadingMoreResults(true);
    try {
      const rows = await fetchCatalogPage(searchResults.length, CATALOG_PAGE_SIZE);
      if (searchSeq.current !== seq) return;
      setSearchResults((prev) => [...prev, ...applyCatalogTypeFilter(rows, typeFilter)]);
      setHasMoreResults(rows.length === CATALOG_PAGE_SIZE);
    } catch (e: unknown) {
      setToast(e instanceof Error ? e.message : 'Could not load more items');
      window.setTimeout(() => setToast(null), 4000);
    } finally {
      setLoadingMoreResults(false);
    }
  }

  const loadBranchStock = useCallback(
    async (countedItemId: number, branchList: PracticeBranch[]) => {
      setStockLoading(true);
      try {
        const stockSettled = await Promise.all(
          branchList.map(async (b) => {
            try {
              const s = await getInventoryBranchStock(practiceId, b.id, countedItemId);
              return { id: b.id, stock: s, ok: true as const };
            } catch {
              return { id: b.id, stock: null, ok: false as const };
            }
          })
        );
        const stockMap: Record<number, InventoryBranchStock> = {};
        const reorderMap: Record<number, string> = {};
        const parMap: Record<number, string> = {};
        const locParMap: Record<string, string> = {};
        const locQtyMap: Record<string, string> = {};
        for (const row of stockSettled) {
          if (row.ok && row.stock) {
            stockMap[row.id] = row.stock;
            reorderMap[row.id] =
              row.stock.reorderPoint == null || Number.isNaN(Number(row.stock.reorderPoint))
                ? ''
                : String(row.stock.reorderPoint);
            parMap[row.id] =
              row.stock.parLevel == null || Number.isNaN(Number(row.stock.parLevel))
                ? ''
                : String(row.stock.parLevel);
            for (const loc of row.stock.locations ?? []) {
              const locKey = `${row.id}:${loc.branchLocationId}`;
              locParMap[locKey] =
                loc.parLevel == null || Number.isNaN(Number(loc.parLevel))
                  ? ''
                  : String(loc.parLevel);
              locQtyMap[locKey] =
                loc.quantityOnHand == null || Number.isNaN(Number(loc.quantityOnHand))
                  ? ''
                  : String(loc.quantityOnHand);
            }
          }
        }
        setStockByBranchId(stockMap);
        setReorderDraftByBranchId(reorderMap);
        setParDraftByBranchId(parMap);
        setParDraftByLocationKey((prev) => ({ ...prev, ...locParMap }));
        setQtyDraftByLocationKey((prev) => ({ ...prev, ...locQtyMap }));
      } catch {
        setStockByBranchId({});
        setReorderDraftByBranchId({});
        setParDraftByBranchId({});
        setParDraftByLocationKey({});
        setQtyDraftByLocationKey({});
      } finally {
        setStockLoading(false);
      }
    },
    [practiceId]
  );

  const refreshDetailBundle = useCallback(
    async (sel: { itemType: ItemType; itemId: number }) => {
      setDetailLoading(true);
      setDetailError(null);
      setStockError(null);
      setBranchPricesError(null);
      try {
        if (sel.itemType === 'inventory') {
          try {
            await refreshInventoryAbc(practiceId);
          } catch {
            /* recommended class stays stale until next successful refresh */
          }
        }
        const item = await getItemWithPriceBreaks(sel.itemType, sel.itemId, practiceId);
        setDetail(item);

        const entityType = itemTypeToEntityType(item.itemType);
        const base = moneyBaseFromCatalogRow(item.item as Record<string, unknown>);

        setBranchPricesLoading(true);
        const branchList = branches.length
          ? branches
          : (await listPracticeBranches(practiceId)).filter((b) => b.isActive !== false);
        const settled = await Promise.all(
          branchList.map(async (b) => {
            try {
              const eff = await postEffectiveBranchPrice(practiceId, b.id, {
                entityType,
                entityId: sel.itemId,
                base,
              });
              return {
                id: b.id,
                effective: eff.effective as MoneyFields,
                override: eff.override ?? null,
                ok: true as const,
              };
            } catch {
              return { id: b.id, effective: null, override: null, ok: false as const };
            }
          })
        );
        const map: Record<number, MoneyFields> = {};
        const overrides: Record<number, BranchPriceOverride | null> = {};
        let failCount = 0;
        for (const row of settled) {
          if (row.ok && row.effective) {
            map[row.id] = row.effective;
            overrides[row.id] = row.override;
          } else failCount += 1;
        }
        setBranchEffectiveById(map);
        setBranchOverrideById(overrides);
        if (failCount > 0 && Object.keys(map).length === 0) {
          setBranchPricesError('Could not load branch prices.');
        } else if (failCount > 0) {
          setBranchPricesError(`Could not load prices for ${failCount} branch${failCount === 1 ? '' : 'es'}.`);
        }
        setBranchPricesLoading(false);

        if (item.itemType === 'inventory') {
          // Counts belong to the stock item, so a code that draws from a master shows the
          // master's on-hand rather than a confusing zero of its own.
          const rawLink = (item.item as InventoryItem).linkedInventoryItemId;
          const countedItemId =
            rawLink != null && Number.isFinite(Number(rawLink)) ? Number(rawLink) : sel.itemId;
          setStockItemId(countedItemId);
          await loadBranchStock(countedItemId, branchList);
        } else {
          setStockByBranchId({});
          setReorderDraftByBranchId({});
          setStockItemId(null);
        }
      } catch (e: unknown) {
        setDetail(null);
        setBranchEffectiveById({});
        setStockByBranchId({});
        setDetailError(e instanceof Error ? e.message : 'Failed to load item');
      } finally {
        setDetailLoading(false);
        setBranchPricesLoading(false);
      }
    },
    [practiceId, branches, loadBranchStock]
  );

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setEffective(null);
      setBranchEffectiveById({});
      setStockByBranchId({});
      setCountsExpandedBranchId(null);
      return;
    }
    setCountsExpandedBranchId(null);
    void refreshDetailBundle(selected);
  }, [selected, refreshDetailBundle]);

  useEffect(() => {
    if (branchId != null && branchEffectiveById[branchId]) {
      setEffective(branchEffectiveById[branchId]);
    } else {
      setEffective(null);
    }
  }, [branchId, branchEffectiveById]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (priceModalOpen || bulkModalOpen) return;
      e.preventDefault();
      closeItemDetailModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, priceModalOpen, bulkModalOpen, searchParams, setSearchParams]);

  function openPriceModal(opts?: {
    seedBranchId?: number | null;
    targetBranchIds?: number[];
    onlineStoreOnly?: boolean;
  }) {
    const seedId = opts?.seedBranchId ?? branchId;
    const seed = (seedId != null ? branchEffectiveById[seedId] : null) ?? effective;
    if (seed) {
      setPriceForm(effectiveToResolved(seed));
    } else if (detail) {
      setPriceForm(moneyBaseFromCatalogRow(detail.item as Record<string, unknown>));
    }
    setPriceMarkup(seedMarkupFor(seedId != null ? branchOverrideById[seedId] : null));
    if (opts?.onlineStoreOnly) {
      setPriceMarkup('');
      setPriceTargetBranchIds(
        onlineStoreImplemented && detail?.itemType === 'inventory' ? [ONLINE_STORE_TARGET_ID] : []
      );
      const base =
        catalogDraft.onlineStorePrice.trim() !== ''
          ? Number(catalogDraft.onlineStorePrice)
          : NaN;
      setPriceForm({
        price: Number.isFinite(base) ? base : 0,
        cost: practiceMoney?.cost ?? 0,
        serviceFee: practiceMoney?.serviceFee ?? 0,
        minimumPrice: practiceMoney?.minimumPrice ?? 0,
      });
    } else {
      const targets =
        opts?.targetBranchIds ??
        (seedId != null ? [seedId] : branchId != null ? [branchId] : []);
      setPriceTargetBranchIds(targets);
    }
    setPriceError(null);
    setPriceModalOpen(true);
  }

  /** A branch's own markup, else the practice markup unless the branch set a fixed price. */
  function seedMarkupFor(override: BranchPriceOverride | null | undefined): string {
    if (override?.markup != null) return String(Number(override.markup));
    if (override?.price != null) return '';
    return practiceMarkup != null ? String(practiceMarkup) : '';
  }

  /**
   * Only what differs from the practice is saved, so the branch keeps following Details for
   * everything else. A markup is saved instead of a price, so the price follows cost.
   */
  function branchOverrideBody(): {
    price: number | null;
    cost: number | null;
    serviceFee: number | null;
    minimumPrice: number | null;
    markup: number | null;
  } {
    const differs = (v: number, practice: number | undefined) =>
      Math.abs((Number(v) || 0) - (Number(practice) || 0)) >= 0.005;
    const cost = differs(priceForm.cost, practiceMoney?.cost) ? priceForm.cost : null;
    const serviceFee = differs(priceForm.serviceFee, practiceMoney?.serviceFee)
      ? priceForm.serviceFee
      : null;
    const minimumPrice = differs(priceForm.minimumPrice, practiceMoney?.minimumPrice)
      ? priceForm.minimumPrice
      : null;
    const markup = optionalNumber(priceMarkup);
    if (markup != null) {
      const sameAsPractice =
        practiceMarkup != null && Math.abs(markup - practiceMarkup) < 0.005 && cost == null;
      return { price: null, cost, serviceFee, minimumPrice, markup: sameAsPractice ? null : markup };
    }
    const price = differs(priceForm.price, practiceMoney?.price) ? priceForm.price : null;
    return { price, cost, serviceFee, minimumPrice, markup: null };
  }

  function openPriceModalAllBranches() {
    const targets = branches.map((b) => b.id);
    if (onlineStoreImplemented && detail?.itemType === 'inventory') {
      targets.push(ONLINE_STORE_TARGET_ID);
    }
    openPriceModal({
      seedBranchId: branchId,
      targetBranchIds: targets,
    });
  }

  async function setHiddenAtBranch(forBranchId: number, hidden: boolean) {
    if (!selected) return;
    setBranchHiddenSaving(forBranchId);
    try {
      const row = await upsertBranchPriceOverride(practiceId, forBranchId, {
        entityType: itemTypeToEntityType(selected.itemType),
        entityId: selected.itemId,
        hidden,
      });
      setBranchOverrideById((prev) => ({ ...prev, [forBranchId]: row }));
    } catch (e: unknown) {
      setToast(e instanceof Error ? e.message : 'Could not update search visibility');
      window.setTimeout(() => setToast(null), 3500);
    } finally {
      setBranchHiddenSaving(null);
    }
  }

  async function saveBranchPrices() {
    if (!selected || !detail) return;
    const realBranchIds = priceTargetBranchIds.filter((id) => id !== ONLINE_STORE_TARGET_ID);
    const applyOnlineStore =
      onlineStoreImplemented &&
      selected.itemType === 'inventory' &&
      priceTargetBranchIds.includes(ONLINE_STORE_TARGET_ID);
    if (realBranchIds.length === 0 && !applyOnlineStore) {
      setPriceError('Select at least one branch, or Online Store.');
      return;
    }
    setPriceSaving(true);
    setPriceError(null);
    try {
      const entityType = itemTypeToEntityType(detail.itemType);
      const body = {
        entityType,
        entityId: selected.itemId,
        ...branchOverrideBody(),
      };
      const branchResults = await Promise.allSettled(
        realBranchIds.map((id) => upsertBranchPriceOverride(practiceId, id, body))
      );
      const branchFailed = branchResults.filter((r) => r.status === 'rejected').length;
      const branchOk = branchResults.length - branchFailed;

      let storeOk = false;
      if (applyOnlineStore) {
        // Price only — leave per-SKU showOnOnlineStore as the doctor set it.
        await patchPracticeInventoryItem(practiceId, selected.itemId, {
          onlineStorePrice: priceForm.price,
        });
        storeOk = true;
      }

      if (branchFailed > 0 && branchOk === 0 && !storeOk) {
        setPriceError(`Could not save prices (${branchFailed} failed).`);
        return;
      }
      if (branchFailed > 0) {
        setPriceError(
          `Saved to ${branchOk} branch${branchOk === 1 ? '' : 'es'}; ${branchFailed} failed.`
        );
      }

      const parts: string[] = [];
      if (branchOk > 0) parts.push(`${branchOk} branch${branchOk === 1 ? '' : 'es'}`);
      if (storeOk) parts.push('online store');
      setToast(parts.length ? `Prices saved to ${parts.join(' and ')}` : 'Saved');
      window.setTimeout(() => setToast(null), 3500);
      if (branchFailed === 0) setPriceModalOpen(false);
      await refreshDetailBundle(selected);
    } catch (e: unknown) {
      setPriceError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setPriceSaving(false);
    }
  }

  async function resetBranchPrices() {
    if (!selected || !detail) return;
    const realBranchIds = priceTargetBranchIds.filter((id) => id !== ONLINE_STORE_TARGET_ID);
    if (realBranchIds.length === 0) {
      setPriceError('Select at least one branch to clear (Online Store is not cleared here).');
      return;
    }
    setPriceSaving(true);
    setPriceError(null);
    try {
      const entityType = itemTypeToEntityType(detail.itemType);
      const body = {
        entityType,
        entityId: selected.itemId,
        price: null,
        cost: null,
        serviceFee: null,
        minimumPrice: null,
        markup: null,
      };
      const results = await Promise.allSettled(
        realBranchIds.map((id) => upsertBranchPriceOverride(practiceId, id, body))
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      const ok = results.length - failed;
      if (failed > 0 && ok === 0) {
        setPriceError('Could not clear overrides.');
        return;
      }
      if (failed > 0) {
        setPriceError(`Cleared ${ok}; ${failed} failed.`);
      }
      setToast(
        `Branch price overrides cleared on ${ok} branch${ok === 1 ? '' : 'es'}`
      );
      window.setTimeout(() => setToast(null), 3500);
      if (failed === 0) setPriceModalOpen(false);
      await refreshDetailBundle(selected);
    } catch (e: unknown) {
      setPriceError(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      setPriceSaving(false);
    }
  }

  function parseOptionalQty(raw: string, label: string): number | null | undefined {
    const draft = raw.trim();
    if (draft === '') return null;
    const n = Number(draft);
    if (!Number.isFinite(n) || n < 0) {
      setStockError(`${label} must be a number 0 or greater`);
      return undefined;
    }
    return n;
  }

  async function saveReorderPoint(forBranchId: number) {
    if (!selected || selected.itemType !== 'inventory' || stockItemId == null) return;
    setStockSaving(true);
    setStockError(null);
    try {
      const reorderPoint = parseOptionalQty(reorderDraftByBranchId[forBranchId] ?? '', 'Re-order point');
      if (reorderPoint === undefined) return;
      const stock = stockByBranchId[forBranchId];
      const defaultLoc = defaultStockLocation(stock);
      const locations = (stock?.locations ?? []).map((loc) => {
        const isDefault = defaultLoc?.branchLocationId === loc.branchLocationId;
        const raw = parDraftByLocationKey[`${forBranchId}:${loc.branchLocationId}`] ?? '';
        const locPar = parseOptionalQty(raw, isDefault ? 'Max' : `${loc.name} par`);
        return { loc, locPar, isDefault };
      });
      if (locations.some((l) => l.locPar === undefined)) return;
      const defaultMax = locations.find((l) => l.isDefault)?.locPar ?? null;
      if (
        reorderPoint != null &&
        defaultMax != null &&
        reorderPoint > defaultMax
      ) {
        setStockError('Re-order point cannot be greater than max');
        return;
      }

      // Location qty edits post as adjustments. Prefer Lots for lot-tracked items so
      // lot balances stay aligned (role gating for inventory manager+ comes later).
      for (const { loc } of locations) {
        const key = `${forBranchId}:${loc.branchLocationId}`;
        const draftRaw = (qtyDraftByLocationKey[key] ?? '').trim();
        const current =
          loc.quantityOnHand == null || Number.isNaN(Number(loc.quantityOnHand))
            ? 0
            : Number(loc.quantityOnHand);
        if (draftRaw === '') continue;
        const target = Number(draftRaw);
        if (!Number.isFinite(target) || target < 0) {
          setStockError(`${loc.name} qty must be a number 0 or greater`);
          return;
        }
        const delta = target - current;
        if (delta === 0) continue;
        const up = delta > 0;
        const body: PostInventoryMovementBody = {
          movementType: up ? 'adjustment_increase' : 'adjustment_decrease',
          inventoryItemId: stockItemId,
          quantity: Math.abs(delta),
          note: 'Manual count adjustment',
        };
        if (up) body.toBranchLocationId = loc.branchLocationId;
        else body.fromBranchLocationId = loc.branchLocationId;
        await postInventoryMovement(practiceId, forBranchId, body);
      }

      const updated = await upsertInventoryBranchStock(
        practiceId,
        forBranchId,
        stockItemId,
        {
          reorderPoint,
          locations: locations.map((l) => ({
            branchLocationId: l.loc.branchLocationId,
            parLevel: l.locPar ?? null,
          })),
        }
      );
      setStockByBranchId((prev) => ({
        ...prev,
        [forBranchId]: { ...prev[forBranchId], ...updated },
      }));
      setReorderDraftByBranchId((prev) => ({
        ...prev,
        [forBranchId]:
          updated.reorderPoint == null || Number.isNaN(Number(updated.reorderPoint))
            ? ''
            : String(updated.reorderPoint),
      }));
      setParDraftByBranchId((prev) => ({
        ...prev,
        [forBranchId]:
          updated.parLevel == null || Number.isNaN(Number(updated.parLevel))
            ? ''
            : String(updated.parLevel),
      }));
      setParDraftByLocationKey((prev) => {
        const next = { ...prev };
        for (const loc of updated.locations ?? []) {
          next[`${forBranchId}:${loc.branchLocationId}`] =
            loc.parLevel == null || Number.isNaN(Number(loc.parLevel))
              ? ''
              : String(loc.parLevel);
        }
        return next;
      });
      if (stockItemId != null) {
        await loadBranchStock(stockItemId, branches);
      }
      setToast('Counts, re-order point, max, and par saved');
      window.setTimeout(() => setToast(null), 3500);
    } catch (e: unknown) {
      setStockError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setStockSaving(false);
    }
  }

  async function saveCoreFields(): Promise<boolean> {
    if (!selected) return false;
    if (!coreDraft.name.trim()) {
      setCoreError('Name is required');
      return false;
    }
    setCoreSaving(true);
    setCoreError(null);
    try {
      const body: Record<string, unknown> = {
        name: coreDraft.name.trim(),
        code: coreDraft.code.trim() || null,
        price: coreDraft.price.trim() === '' ? null : Number(coreDraft.price),
        cost: coreDraft.cost.trim() === '' ? null : Number(coreDraft.cost),
      };
      if (selected.itemType === 'procedure' || selected.itemType === 'inventory') {
        body.serviceFee =
          coreDraft.serviceFee.trim() === '' ? null : Number(coreDraft.serviceFee);
      }
      if (selected.itemType === 'inventory') {
        body.minimumPrice =
          coreDraft.minimumPrice.trim() === '' ? null : Number(coreDraft.minimumPrice);
        body.markup = optionalNumber(coreDraft.markup);
        body.taxLevelValue = coreDraft.taxLevelValue;
        body.category =
          coreDraft.category.trim() === '' ? null : Number(coreDraft.category);
        body.assignedAbc =
          coreDraft.assignedAbc === 'A' ||
          coreDraft.assignedAbc === 'B' ||
          coreDraft.assignedAbc === 'C'
            ? coreDraft.assignedAbc
            : null;
        body.sellUnitType = coreDraft.sellUnitType || null;
        body.sellUnitTypeDetail =
          coreDraft.sellUnitType === 'other' ? coreDraft.sellUnitTypeDetail.trim() || null : null;
      }
      if (selected.itemType === 'procedure') {
        body.hideOnInvoice = coreDraft.hideOnInvoice;
        body.excludeFromProduction = coreDraft.excludeFromProduction;
        body.changePatientStatusTo = coreDraft.changePatientStatusTo.trim() || null;
        body.changePatientSex = coreDraft.changePatientSex;
        if (coreDraft.isAftercare && !coreDraft.aftercareType) {
          throw new Error('Choose which aftercare plan this item is before saving.');
        }
        body.isAftercare = coreDraft.isAftercare;
        body.aftercareType = coreDraft.isAftercare ? coreDraft.aftercareType : null;
        body.aftercareDisplayName = coreDraft.isAftercare
          ? coreDraft.aftercareDisplayName.trim() || null
          : null;
      }
      Object.assign(body, catalogDiscountBody(coreDraft));
      if (selected.itemType === 'lab' || selected.itemType === 'procedure') {
        body.taxLevelValue = coreDraft.taxLevelValue;
        body.category =
          coreDraft.category.trim() === '' ? null : Number(coreDraft.category);
      }
      const newPrice = body.price as number | null;
      const ownPriceBranches = branches.filter((b) => branchOverrideById[b.id]?.price != null);
      const priceChanged =
        newPrice != null && Math.abs(newPrice - (practiceMoney?.price ?? 0)) >= 0.005;
      const updateOwnPrices =
        priceChanged && ownPriceBranches.length > 0
          ? await appConfirm({
              title: 'Update branch prices too?',
              message: `${ownPriceBranches
                .map(
                  (b) =>
                    `${b.name} ($${Number(branchOverrideById[b.id]?.price ?? 0).toFixed(2)})`
                )
                .join(', ')} ${
                ownPriceBranches.length === 1 ? 'has its' : 'have their'
              } own price. Every other branch will use the new $${newPrice.toFixed(
                2
              )}. Should ${ownPriceBranches.length === 1 ? 'it' : 'they'} switch to it too?`,
              confirmLabel: 'Use the new price',
              cancelLabel: 'Keep their own price',
            })
          : false;
      await patchCatalogItem(selected.itemType, practiceId, selected.itemId, body);
      if (updateOwnPrices) {
        const entityType = itemTypeToEntityType(selected.itemType);
        await Promise.all(
          ownPriceBranches.map((b) =>
            upsertBranchPriceOverride(practiceId, b.id, {
              entityType,
              entityId: selected.itemId,
              price: null,
            })
          )
        );
      }
      const savedKey = `${selected.itemType}:${selected.itemId}`;
      const savedName = coreDraft.name.trim();
      setSearchResults((rows) =>
        rows.map((row) => {
          if (entityIdFromSelection(row.itemType, row) !== selected.itemId) return row;
          if (row.itemType !== selected.itemType) return row;
          return { ...row, name: savedName || row.name };
        }),
      );
      setToast('Saved');
      window.setTimeout(() => setToast(null), 3500);
      setJustSavedKey(savedKey);
      if (justSavedClearRef.current != null) {
        window.clearTimeout(justSavedClearRef.current);
      }
      justSavedClearRef.current = window.setTimeout(() => setJustSavedKey(null), 4000);
      if (embed || setupForId === selected.itemId) {
        setSelected((s) => (s ? { ...s, label: savedName } : s));
        await refreshDetailBundle(selected);
      } else {
        closeItemDetailModal();
        window.requestAnimationFrame(() => {
          document
            .querySelector<HTMLElement>(`[data-catalog-row="${savedKey}"]`)
            ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
      }
      return true;
    } catch (e: unknown) {
      setCoreError(e instanceof Error ? e.message : 'Save failed');
      return false;
    } finally {
      setCoreSaving(false);
    }
  }

  function setupSteps(): (typeof detailTab)[] {
    if (!detail) return [];
    return setupStepsFor(detail.itemType);
  }

  function setupStepsFor(itemType: ItemType): (typeof detailTab)[] {
    if (itemType !== 'inventory') return ['details', 'pricing', 'associations'];
    return [
      'details',
      'clinical',
      'lots',
      'stock',
      'pricing',
      'associations',
      ...(onlineStoreImplemented ? (['online-store'] as const) : []),
    ];
  }

  /** Save the tab's own form before moving on; tabs that save as you go need nothing. */
  async function saveSetupStep(tab: typeof detailTab): Promise<boolean> {
    if (tab === 'details') return saveCoreFields();
    if (tab === 'clinical') return clinicalSaveRef.current ? clinicalSaveRef.current() : true;
    if (tab === 'online-store') return saveOnlineStoreFields();
    return true;
  }

  const [setupBusy, setSetupBusy] = useState(false);

  async function setupMove(direction: 1 | -1, opts?: { finish?: boolean }) {
    const steps = setupSteps();
    const index = Math.max(0, steps.indexOf(detailTab));
    setSetupBusy(true);
    try {
      if (direction === 1 && !(await saveSetupStep(steps[index]))) return;
      const next = index + direction;
      if (direction === 1 && steps[next] === 'online-store') setSetupListOnStore(true);
      if (next >= steps.length || opts?.finish) {
        if (embed?.costReview) {
          setDetailError(null);
          try {
            await embed.costReview.onConfirm({
              cost: optionalNumber(coreDraft.cost),
              price: optionalNumber(coreDraft.price),
            });
          } catch (e: unknown) {
            setDetailError(
              e instanceof Error
                ? e.message
                : 'Could not finish the cost review. The item was saved; the review is still open.'
            );
            return;
          }
          embed.onClose();
          return;
        }
        setSetupForId(null);
        setToast('Setup complete');
        window.setTimeout(() => setToast(null), 3500);
        return;
      }
      setDetailTab(steps[Math.max(0, next)]);
      document.querySelector('.inv-item-detail-modal__body')?.scrollTo({ top: 0 });
    } finally {
      setSetupBusy(false);
    }
  }

  async function submitCreateItem(opts?: { startTab?: typeof detailTab }) {
    if (!createForm.name.trim()) {
      setCreateError(
        opts?.startTab
          ? `Enter a name first, then open ${SETUP_TAB_LABELS[opts.startTab]}`
          : 'Name is required'
      );
      return;
    }
    setCreateSaving(true);
    setCreateError(null);
    try {
      const body: Record<string, unknown> = {
        name: createForm.name.trim(),
        code: createForm.code.trim() || null,
        price: optionalNumber(createForm.price),
        cost: optionalNumber(createForm.cost),
        serviceFee: optionalNumber(createForm.serviceFee),
        minimumPrice: optionalNumber(createForm.minimumPrice),
        markup: optionalNumber(createForm.markup),
        isMedication: createForm.isMedication,
        ...catalogDiscountBody(createForm),
        taxLevelValue: createForm.taxLevelValue,
        category:
          createForm.category.trim() === '' ? null : Number(createForm.category),
        manufacturer: createForm.manufacturer.trim() || null,
        vendorName: createForm.vendorName.trim() || null,
        vendorDrugNumber: createForm.vendorDrugNumber.trim() || null,
        barcode: createForm.barcode.trim() || null,
        defaultQuantity: optionalNumber(createForm.defaultQuantity),
        requireExpirationOnLots: true,
        requireLotNumber:
          createForm.isVaccine || createForm.isControlled ? true : createForm.requireLotNumber,
        trackLots: createForm.isVaccine || createForm.isControlled ? true : createForm.trackLots,
        isVaccine: createForm.isVaccine,
        isDispensable: createForm.isMedication,
        dispenseNote: createForm.isMedication
          ? createForm.dispenseNote.trim() || null
          : null,
        isControlled: createForm.isControlled,
        isMicrochip: createForm.isMicrochip,
        hasClientNotes: createForm.hasClientNotes,
        clientNote: createForm.hasClientNotes
          ? createForm.clientNote.trim() || null
          : null,
        hideOnInvoice: createForm.hideOnInvoice,
        hideOnMedicalRecordView: createForm.hideOnMedicalRecordView,
        hideOnMedicalRecordPrint: createForm.hideOnMedicalRecordPrint,
        excludeFromProduction: createForm.excludeFromProduction,
        changePatientStatusTo: createForm.changePatientStatusTo.trim() || null,
        changePatientSex: createForm.changePatientSex,
      };
      if (createForm.isVaccine) {
        body.vaccineDetails = {
          name: createForm.vaccineName.trim() || createForm.name.trim(),
          manufacturer:
            createForm.vaccineManufacturer.trim() ||
            createForm.manufacturer.trim() ||
            null,
          vaccineType: createForm.vaccineType || null,
          dosageType: createForm.dosageType || null,
          createRabiesCertificate: createForm.createRabiesCertificate,
          usdaLicensingMonths: optionalNumber(createForm.usdaLicensingMonths),
          animalControlLicensingMonths: optionalNumber(
            createForm.animalControlLicensingMonths
          ),
          tagIssuePeriodMonths: optionalNumber(createForm.tagIssuePeriodMonths),
          defaultSerial: null,
        };
      }
      const created = await createCatalogItem(
        createType,
        practiceId,
        createType === 'inventory'
          ? body
          : {
              name: createForm.name.trim(),
              code: createForm.code.trim() || null,
              price: optionalNumber(createForm.price),
              cost: optionalNumber(createForm.cost),
              serviceFee: optionalNumber(createForm.serviceFee),
              minimumPrice: optionalNumber(createForm.minimumPrice),
              ...catalogDiscountBody(createForm),
              taxLevelValue: createForm.taxLevelValue,
              category: createForm.category.trim() === '' ? null : Number(createForm.category),
            }
      );
      const newId = Number(created.id);
      const createdName = createForm.name.trim();
      setCreateOpen(false);
      setCreateForm(EMPTY_INVENTORY_CREATE);
      setToast(`${catalogTypeLabel(createType)} saved — continue through each tab`);
      window.setTimeout(() => setToast(null), 4000);
      if (Number.isFinite(newId) && newId > 0) {
        const steps = setupStepsFor(createType);
        const startTab = opts?.startTab ?? steps[1] ?? 'details';
        pendingStartTabRef.current = startTab;
        setSetupForId(newId);
        setSetupListOnStore(startTab === 'online-store');
        setSelected({
          itemType: createType,
          itemId: newId,
          label: createdName,
        });
      }
      setSearchQuery(createdName);
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setCreateSaving(false);
    }
  }

  async function archiveOrRestoreRow(row: SearchResultItem) {
    const itemId = entityIdFromSelection(row.itemType, row);
    if (itemId == null) return;
    const active = catalogIsActive(row);
    const key = `${row.itemType}:${itemId}`;
    const ok = await appConfirm({
      title: active ? 'Archive item?' : 'Restore item?',
      message: active
        ? `Archive “${row.name}”? It will be hidden from default search.`
        : `Restore “${row.name}”?`,
      confirmLabel: active ? 'Archive' : 'Restore',
      danger: active,
    });
    if (!ok) return;
    setArchiveBusyId(key);
    try {
      await setCatalogItemActive(row.itemType, practiceId, itemId, !active);
      setToast(active ? 'Item archived' : 'Item restored');
      window.setTimeout(() => setToast(null), 3500);
      const pageSize = Math.min(Math.max(searchResults.length, CATALOG_PAGE_SIZE), 200);
      const rows = await fetchCatalogPage(0, pageSize);
      setSearchResults(applyCatalogTypeFilter(rows, typeFilter));
      setHasMoreResults(rows.length === pageSize);
      if (selected?.itemType === row.itemType && selected.itemId === itemId) {
        await refreshDetailBundle(selected);
      }
    } catch (e: unknown) {
      setToast(e instanceof Error ? e.message : 'Archive failed');
      window.setTimeout(() => setToast(null), 4000);
    } finally {
      setArchiveBusyId(null);
    }
  }

  async function saveStockLink() {
    if (!selected || (selected.itemType !== 'inventory' && selected.itemType !== 'lab')) return;
    const isLab = selected.itemType === 'lab';
    setStockLinkSaving(true);
    setStockLinkError(null);
    try {
      const qty = stockLinkQty.trim() === '' ? 1 : Number(stockLinkQty);
      if (stockLinkItemId != null && (!Number.isFinite(qty) || qty <= 0)) {
        setStockLinkError(
          isLab
            ? 'Enter how many kits one test uses (usually 1).'
            : 'Enter how many stock units one sale consumes (e.g. 100).'
        );
        return;
      }
      const link = {
        linkedInventoryItemId: stockLinkItemId,
        linkedInventoryItemDefaultQuantity: stockLinkItemId == null ? null : qty,
      };
      if (isLab) {
        await patchCatalogItem('lab', practiceId, selected.itemId, link);
      } else {
        await patchPracticeInventoryItem(practiceId, selected.itemId, link);
      }
      setToast(stockLinkItemId == null ? 'Stock link cleared' : 'Stock item saved');
      window.setTimeout(() => setToast(null), 3500);
      await refreshDetailBundle(selected);
    } catch (e: unknown) {
      setStockLinkError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setStockLinkSaving(false);
    }
  }

  async function rememberStoreCategory(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (storeCategories.some((row) => row.name === trimmed)) return;
    try {
      const created = await createStoreCategory(practiceId, trimmed);
      setStoreCategories((rows) =>
        rows.some((row) => row.id === created.id) ? rows : [...rows, created]
      );
    } catch {
      setStoreCategories((rows) =>
        rows.some((row) => row.name === trimmed)
          ? rows
          : [...rows, { id: 0, name: trimmed, sortOrder: 0, source: 'manual', productCount: 0 }]
      );
    }
  }

  async function saveOnlineStoreFields(): Promise<boolean> {
    if (!selected || (selected.itemType !== 'inventory' && selected.itemType !== 'procedure')) {
      return true;
    }
    if (
      selected.itemType === 'inventory' &&
      catalogDraft.showOnOnlineStore &&
      catalogDraft.onlineStorePrice.trim() === ''
    ) {
      setCatalogError('Enter the online store price to list this item');
      return false;
    }
    setCatalogSaving(true);
    setCatalogError(null);
    try {
      if (catalogDraft.storeCategory.trim()) {
        await rememberStoreCategory(catalogDraft.storeCategory.trim());
      }
      if (selected.itemType === 'inventory') {
        await patchPracticeInventoryItem(practiceId, selected.itemId, {
          ...(sharedStoreListing
            ? {}
            : { description: catalogDraft.description.trim() || null }),
          shippable: catalogDraft.shippable,
          showOnOnlineStore: catalogDraft.showOnOnlineStore,
          passThroughByDefault: catalogDraft.passThroughByDefault,
          storeAvailability: catalogDraft.storeAvailability,
          storeBackInStockDate: catalogDraft.storeBackInStockDate || null,
          storeAllowBackorder: catalogDraft.storeAllowBackorder,
          storeStockBuffer: Math.max(0, Math.floor(Number(catalogDraft.storeStockBuffer) || 0)),
          autoshipRecommendedFrequency: catalogDraft.autoshipOffered
            ? catalogDraft.autoshipFrequency || 'monthly'
            : null,
          onlineStorePrice:
            catalogDraft.onlineStorePrice.trim() === ''
              ? null
              : Number(catalogDraft.onlineStorePrice),
        });
        if (catalogDraft.storeAvailability === 'stock') {
          void getStoreItemAvailability(practiceId, selected.itemId)
            .then(setStoreStock)
            .catch(() => undefined);
        } else {
          setStoreStock(null);
        }
        await patchOnlineStoreItem(practiceId, selected.itemId, {
          listed: catalogDraft.showOnOnlineStore,
          ...(sharedStoreListing
            ? {}
            : {
                storeCategory: catalogDraft.storeCategory.trim() || null,
                featuredOnHome: catalogDraft.featuredOnHome,
              }),
        });
        if (storeListing && !sharedStoreListing) {
          await patchOnlineStoreListing(practiceId, storeListing.listingId, {
            listed: catalogDraft.showOnOnlineStore,
            featuredOnHome: catalogDraft.featuredOnHome,
            storeCategory: catalogDraft.storeCategory.trim() || null,
            description: catalogDraft.description.trim() || null,
          });
        }
      } else {
        const payload = {
          name: coreDraft.name.trim() || selected.label,
          description: catalogDraft.description.trim() || null,
          procedureId: selected.itemId,
          storeCategory: catalogDraft.storeCategory.trim() || null,
          approvalTag: catalogDraft.requiresDoctorApproval
            ? ('needs_doctor_approval' as const)
            : ('approved' as const),
        };
        if (!storeListing && !catalogDraft.showOnOnlineStore) {
          setToast('Nothing to save — this procedure is not listed on the store');
          window.setTimeout(() => setToast(null), 3500);
          return true;
        }
        if (sharedStoreListing) {
          setToast(`Edit “${sharedStoreListing.name}” on Store items`);
          window.setTimeout(() => setToast(null), 3500);
          return true;
        }
        const listing = storeListing
          ? await patchOnlineStoreListing(practiceId, storeListing.listingId, {
              listed: catalogDraft.showOnOnlineStore,
              description: payload.description,
              storeCategory: payload.storeCategory,
              approvalTag: payload.approvalTag,
            })
          : await createOnlineStoreProduct(practiceId, payload);
        setStoreListing(listing ?? null);
      }
      setToast('Online store details saved');
      window.setTimeout(() => setToast(null), 3500);
      await refreshDetailBundle(selected);
      return true;
    } catch (e: unknown) {
      setCatalogError(e instanceof Error ? e.message : 'Save failed');
      return false;
    } finally {
      setCatalogSaving(false);
    }
  }

  async function onInventoryImageSelected(file: File | null) {
    if (!file || !selected) return;
    if (selected.itemType === 'procedure') {
      setImageUploading(true);
      setCatalogError(null);
      try {
        let listing = storeListing;
        if (!listing) {
          listing = await createOnlineStoreProduct(practiceId, {
            name: coreDraft.name.trim() || selected.label,
            procedureId: selected.itemId,
            storeCategory: catalogDraft.storeCategory.trim() || null,
            description: catalogDraft.description.trim() || null,
          });
          setStoreListing(listing);
        }
        if (!listing) throw new Error('Could not create a store listing for this picture.');
        const next = await uploadOnlineStoreListingImage(
          practiceId,
          listing.listingId,
          file
        );
        setStoreListing(next ?? listing);
        setItemHasImage(Boolean(next?.hasImage ?? listing.hasImage));
        setItemImageVersion((v) => v + 1);
        setToast('Picture uploaded');
        window.setTimeout(() => setToast(null), 3500);
      } catch (e: unknown) {
        setCatalogError(e instanceof Error ? e.message : 'Image upload failed');
      } finally {
        setImageUploading(false);
        if (itemImageInputRef.current) itemImageInputRef.current.value = '';
      }
      return;
    }
    if (selected.itemType !== 'inventory') return;
    setImageUploading(true);
    setCatalogError(null);
    try {
      await uploadInventoryItemImage(practiceId, selected.itemId, file);
      setItemHasImage(true);
      setItemImageVersion((v) => v + 1);
      setToast('Picture uploaded');
      window.setTimeout(() => setToast(null), 3500);
      await refreshDetailBundle(selected);
    } catch (e: unknown) {
      setCatalogError(e instanceof Error ? e.message : 'Image upload failed');
    } finally {
      setImageUploading(false);
      if (itemImageInputRef.current) itemImageInputRef.current.value = '';
    }
  }

  async function removeInventoryImage() {
    if (!selected || selected.itemType !== 'inventory') return;
    setImageUploading(true);
    setCatalogError(null);
    try {
      await deleteInventoryItemImage(practiceId, selected.itemId);
      setItemHasImage(false);
      setItemImageVersion((v) => v + 1);
      setToast('Picture removed');
      window.setTimeout(() => setToast(null), 3500);
      await refreshDetailBundle(selected);
    } catch (e: unknown) {
      setCatalogError(e instanceof Error ? e.message : 'Could not remove image');
    } finally {
      setImageUploading(false);
    }
  }

  function toggleBulkInventoryRow(itemId: number | null, name: string) {
    if (itemId == null) return;
    setBulkSelected((prev) => {
      const next = { ...prev };
      if (next[itemId]) delete next[itemId];
      else next[itemId] = name;
      return next;
    });
  }

  async function submitBulkPriceAdjust() {
    const ids = Object.keys(bulkSelected).map(Number);
    if (!ids.length) return;
    setBulkSaving(true);
    setBulkError(null);
    try {
      const pctP = bulkPctPractice.trim() === '' ? null : Number(bulkPctPractice);
      const pctO = bulkPctOnline.trim() === '' ? null : Number(bulkPctOnline);
      const fP = bulkFlatPractice.trim() === '' ? null : Number(bulkFlatPractice);
      const fO = bulkFlatOnline.trim() === '' ? null : Number(bulkFlatOnline);
      const hasPctP = pctP != null && Number.isFinite(pctP);
      const hasPctO = pctO != null && Number.isFinite(pctO);
      const hasFP = fP != null && Number.isFinite(fP);
      const hasFO = fO != null && Number.isFinite(fO);
      if (!hasPctP && !hasPctO && !hasFP && !hasFO) {
        setBulkError('Enter at least one percent or flat adjustment.');
        return;
      }
      const res = await postBulkInventoryPriceAdjust(practiceId, {
        inventoryItemIds: ids,
        percentChangePracticePrice: hasPctP ? pctP : undefined,
        percentChangeOnlineStorePrice: hasPctO ? pctO : undefined,
        flatAddPracticePrice: hasFP ? fP : undefined,
        flatAddOnlineStorePrice: hasFO ? fO : undefined,
      });
      const branchCount = res.branchPricesUpdated ?? 0;
      setToast(
        branchCount
          ? `Bulk price adjustment applied, including ${branchCount} branch price${branchCount === 1 ? '' : 's'}`
          : 'Bulk price adjustment applied'
      );
      window.setTimeout(() => setToast(null), 3500);
      setBulkModalOpen(false);
      setBulkSelected({});
      setBulkPctPractice('');
      setBulkPctOnline('');
      setBulkFlatPractice('');
      setBulkFlatOnline('');
      if (selected?.itemType === 'inventory' && branchId != null) {
        await refreshDetailBundle(selected);
      }
    } catch (e: unknown) {
      setBulkError(e instanceof Error ? e.message : 'Bulk adjust failed');
    } finally {
      setBulkSaving(false);
    }
  }

  const practiceMoney: ResolvedMoney | null = detail
    ? moneyBaseFromCatalogRow(detail.item as Record<string, unknown>)
    : null;
  const practiceMarkupRaw = (detail?.item as { markup?: unknown } | undefined)?.markup;
  const practiceMarkup =
    practiceMarkupRaw != null && Number.isFinite(Number(practiceMarkupRaw))
      ? Number(practiceMarkupRaw)
      : null;

  const typeFilterOptions: { value: CatalogTypeFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'inventory', label: 'Products' },
    { value: 'procedure', label: 'Procedures' },
    { value: 'lab', label: 'Labs' },
    { value: 'bundle', label: 'Bundles' },
  ];

  const typeFilterBar = (
    <div className="inv-type-filters" role="tablist" aria-label="Item type">
      {typeFilterOptions.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={typeFilter === opt.value}
          className={`inv-type-filters__btn${typeFilter === opt.value ? ' inv-type-filters__btn--active' : ''}`}
          onClick={() => setTypeFilter(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  // Bundles are their own store rather than rows in the item search, so they get their own view.
  if (typeFilter === 'bundle') {
    return (
      <div className="settings-section">
        <div className="settings-form-group" style={{ marginBottom: 24 }}>
          {typeFilterBar}
        </div>
        <CatalogBundles
          practiceId={practiceId}
          focusBundleId={focusBundleId}
          initialQuery={searchQuery}
          onFocusBundleConsumed={() => setFocusBundleId(null)}
        />
      </div>
    );
  }

  return (
    <>
      {toast && (
        <div
          className="settings-message settings-success-message"
          style={{ marginBottom: embed ? 0 : 16 }}
        >
          {toast}
        </div>
      )}

      {!embed ? (
      <div className="settings-section">
      <div className="settings-form-group" style={{ marginBottom: 24 }}>
        {typeFilterBar}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            alignItems: 'center',
            marginBottom: 10,
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>
          {canEditItem && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
            <input
              type="checkbox"
              checked={bulkSelectMode}
              onChange={(e) => {
                setBulkSelectMode(e.target.checked);
                if (!e.target.checked) setBulkSelected({});
              }}
            />
            Select inventory rows for bulk price change
          </label>
          )}
          {canEditItem && Object.keys(bulkSelected).length > 0 && (
            <>
              <span className="settings-muted">{Object.keys(bulkSelected).length} selected</span>
              <button
                type="button"
                className="btn primary"
                style={{ fontSize: 13, padding: '6px 12px' }}
                onClick={() => {
                  setBulkError(null);
                  setBulkModalOpen(true);
                }}
              >
                Bulk adjust prices…
              </button>
              <button
                type="button"
                className="btn secondary"
                style={{ fontSize: 13, padding: '6px 12px' }}
                onClick={() => setBulkSelected({})}
              >
                Clear selection
              </button>
            </>
          )}
        </div>
        <div style={{ position: 'relative', maxWidth: '100%' }}>
          <input
            type="text"
            className="settings-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              typeFilter === 'all'
                ? 'Search products, procedures, and labs…'
                : `Search ${typeFilterOptions.find((o) => o.value === typeFilter)?.label.toLowerCase() ?? 'items'}…`
            }
            style={{ width: '100%', maxWidth: 720, paddingRight: searching ? 40 : 12 }}
          />
          {searching && (
            <div
              style={{
                position: 'absolute',
                right: 12,
                top: '50%',
                transform: 'translateY(-50%)',
              }}
            >
              <div className="settings-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
            </div>
          )}
        </div>
      </div>

      <div className="inv-catalog-results">
        <div className="inv-catalog-results__toolbar">
          <div className="inv-catalog-results__toolbar-left">
            {canCreateItem && (
              <button
                type="button"
                className="inv-catalog-results__text-btn"
                onClick={() => {
                  setCreateError(null);
                  setCreateForm(EMPTY_INVENTORY_CREATE);
                  setCreateType(typeFilter === 'all' ? 'inventory' : typeFilter);
                  setCreateOpen(true);
                }}
              >
                {addItemLabel(typeFilter)}
              </button>
            )}
            <span className="inv-catalog-results__count">
              {hasMoreResults ? 'Showing:' : 'Total count:'}{' '}
              {searchQuery.trim() || showAllItems
                ? searching
                  ? '…'
                  : searchResults.length + bundleHits.length
                : 0}
            </span>
            <button
              type="button"
              className={`inv-type-filters__btn${showAllItems ? ' inv-type-filters__btn--active' : ''}`}
              aria-pressed={showAllItems}
              onClick={() => setShowAllItems((v) => !v)}
              title="List every item without searching"
            >
              Show all
            </button>
          </div>
          <div className="inv-catalog-results__toolbar-right" aria-label="Export (coming soon)">
            <span className="inv-catalog-results__export-pill" title="Excel export">
              XLS
            </span>
            <span className="inv-catalog-results__export-pill" title="PDF export">
              PDF
            </span>
          </div>
        </div>

        {!searchQuery.trim() && !showAllItems && (
          <p className="settings-muted" style={{ marginTop: 0 }}>
            Type to search, or choose Show all to list every item.
          </p>
        )}
        {(searchQuery.trim() || showAllItems) &&
          !searching &&
          searchError && (
          <p className="settings-error-message" style={{ marginTop: 0 }}>
            {searchError}
          </p>
        )}
        {(searchQuery.trim() || showAllItems) &&
          !searching &&
          !searchError &&
          searchResults.length === 0 &&
          bundleHits.length === 0 && (
          <p className="settings-muted" style={{ marginTop: 0 }}>
            No matches.
          </p>
        )}
        {(searchResults.length > 0 || bundleHits.length > 0) && (
          <div className="inv-catalog-results__table-scroll">
            <table className="inv-catalog-results__table">
              <thead>
                <tr>
                  {bulkSelectMode && <th className="inv-catalog-results__th-narrow" />}
                  <th>Item</th>
                  <th>Manufacturer</th>
                  <th>Vendor</th>
                  <th className="inv-catalog-results__th-num">Cost</th>
                  <th className="inv-catalog-results__th-num">Markup</th>
                  <th className="inv-catalog-results__th-num">Price</th>
                  <th className="inv-catalog-results__th-num" title="Service fee">
                    Fee
                  </th>
                  <th>Unit</th>
                  <th>Status</th>
                  <th className="inv-catalog-results__th-actions">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {bundleHits.map((bundle) => (
                  <tr
                    key={`bundle-${bundle.id}`}
                    onClick={() => {
                      setFocusBundleId(bundle.id);
                      setTypeFilter('bundle');
                    }}
                  >
                    {bulkSelectMode ? <td /> : null}
                    <td>
                      <div className="inv-catalog-results__item">
                        <span className="inv-catalog-results__type-tag inv-catalog-results__type-tag--bundle">
                          Bundle
                        </span>
                        <div className="inv-catalog-results__item-text">
                          <span className="inv-catalog-results__name">{bundle.name}</span>
                          <span className="inv-catalog-results__code">
                            {bundle.code || 'No code'}
                            {bundle.marketingSummary
                              ? ` · ${bundle.marketingSummary}`
                              : ''}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="inv-catalog-results__empty">—</td>
                    <td className="inv-catalog-results__empty">—</td>
                    <td className="inv-catalog-results__td-num inv-catalog-results__empty">—</td>
                    <td className="inv-catalog-results__td-num inv-catalog-results__empty">—</td>
                    <td className="inv-catalog-results__td-num">
                      {bundle.price != null ? formatUsd(bundle.price) : '—'}
                    </td>
                    <td className="inv-catalog-results__td-num inv-catalog-results__empty">—</td>
                    <td className="inv-catalog-results__empty">—</td>
                    <td>
                      <span
                        className={
                          bundle.isActive && !bundle.isArchived
                            ? 'inv-catalog-results__status inv-catalog-results__status--ok'
                            : 'inv-catalog-results__status inv-catalog-results__status--off'
                        }
                      >
                        {bundle.isArchived
                          ? 'Archived'
                          : bundle.isActive
                            ? 'Active'
                            : 'Inactive'}
                      </span>
                    </td>
                    <td />
                  </tr>
                ))}
                {searchResults.map((row, i) => {
                  const itemType = row.itemType;
                  const itemId = entityIdFromSelection(itemType, row);
                  const cost = catalogCost(row);
                  const busyKey = itemId != null ? `${itemType}:${itemId}` : '';
                  const active = catalogIsActive(row);
                  const manufacturer =
                    itemType === 'inventory'
                      ? (row.inventoryItem as InventoryItem | undefined)?.manufacturer
                      : null;
                  const vendor =
                    itemType === 'inventory'
                      ? (row.inventoryItem as InventoryItem | undefined)?.vendorName
                      : null;
                  const price = Number(row.price);
                  return (
                    <tr
                      key={`${itemType}-${itemId}-${i}`}
                      data-catalog-row={itemId != null ? `${itemType}:${itemId}` : undefined}
                      className={
                        itemId != null && justSavedKey === `${itemType}:${itemId}`
                          ? 'inv-catalog-results__row--just-saved'
                          : undefined
                      }
                      onClick={(e) => {
                        const el = e.target as HTMLElement;
                        if (el.closest('button, input, label')) return;
                        if (itemId == null) return;
                        setSelected({ itemType, itemId, label: row.name });
                      }}
                    >
                      {bulkSelectMode && (
                        <td>
                          {itemType === 'inventory' ? (
                            <input
                              type="checkbox"
                              checked={itemId != null && !!bulkSelected[itemId]}
                              onChange={() => toggleBulkInventoryRow(itemId, row.name)}
                              aria-label={`Select ${row.name} for bulk pricing`}
                            />
                          ) : (
                            <span className="inv-catalog-results__empty">—</span>
                          )}
                        </td>
                      )}
                      <td>
                        <div className="inv-catalog-results__item">
                          <span
                            className={`inv-catalog-results__type-tag inv-catalog-results__type-tag--${itemType}`}
                          >
                            {catalogTypeLabel(itemType)}
                          </span>
                          <div className="inv-catalog-results__item-text">
                            <span className="inv-catalog-results__name">{row.name}</span>
                            <span className="inv-catalog-results__code">{row.code || 'No code'}</span>
                          </div>
                        </div>
                      </td>
                      <td className={manufacturer ? undefined : 'inv-catalog-results__empty'}>
                        {manufacturer || '—'}
                      </td>
                      <td className={vendor ? undefined : 'inv-catalog-results__empty'}>
                        {vendor || '—'}
                      </td>
                      <td className="inv-catalog-results__td-num">{formatUsd(cost)}</td>
                      <td className="inv-catalog-results__td-num">{catalogMarkupPct(row.price, cost)}</td>
                      <td
                        className={`inv-catalog-results__td-num${
                          Number.isFinite(price) && price < 0
                            ? ' inv-catalog-results__td-num--neg'
                            : ''
                        }`}
                      >
                        {formatUsd(price)}
                      </td>
                      <td className="inv-catalog-results__td-num">
                        {formatUsd(catalogServiceFee(row))}
                      </td>
                      <td className="inv-catalog-results__unit">{catalogSellUnit(row)}</td>
                      <td>
                        <span
                          className={
                            active
                              ? 'inv-catalog-results__status inv-catalog-results__status--ok'
                              : 'inv-catalog-results__status inv-catalog-results__status--off'
                          }
                        >
                          {active ? 'Active' : 'Archived'}
                        </span>
                      </td>
                      <td>
                        <div className="inv-catalog-results__row-actions">
                          <button
                            type="button"
                            className="inv-catalog-results__icon-btn"
                            title="Copy name"
                            aria-label={`Copy ${row.name}`}
                            onClick={() => {
                              void navigator.clipboard.writeText(row.name).then(() => {
                                setToast('Copied to clipboard');
                                window.setTimeout(() => setToast(null), 2000);
                              });
                            }}
                          >
                            <Copy size={15} />
                          </button>
                          {canEditItem && (
                            <button
                              type="button"
                              className="inv-catalog-results__icon-btn"
                              disabled={itemId == null || archiveBusyId === busyKey}
                              title={active ? 'Archive' : 'Restore'}
                              aria-label={active ? `Archive ${row.name}` : `Restore ${row.name}`}
                              onClick={() => void archiveOrRestoreRow(row)}
                            >
                              {active ? <Archive size={15} /> : <ArchiveRestore size={15} />}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {hasMoreResults && !searching && (
          <button
            type="button"
            className="btn secondary"
            style={{ marginTop: 12 }}
            disabled={loadingMoreResults}
            onClick={() => void loadMoreCatalogRows()}
          >
            {loadingMoreResults ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
      </div>
      ) : null}

      {selected && (
        <div
          className="inv-item-detail-modal__backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="inv-item-detail-modal-title"
          onClick={() => closeItemDetailModal()}
        >
          <div className="inv-item-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="inv-item-detail-modal__header">
              <div>
                <h2 id="inv-item-detail-modal-title">
                  {selected.itemType === 'inventory'
                    ? 'View / edit product'
                    : selected.itemType === 'lab'
                      ? 'View / edit lab'
                      : 'View / edit procedure'}
                </h2>
                <p className="inv-item-detail-modal__subtitle">{selected.label}</p>
              </div>
              <div className="inv-item-detail-modal__header-actions">
                <button
                  type="button"
                  className="inv-item-detail-modal__close"
                  aria-label="Close"
                  onClick={() => closeItemDetailModal()}
                >
                  <X size={20} aria-hidden />
                </button>
              </div>
            </div>
            <div className="inv-item-detail-modal__body">
              <div className="settings-card" style={{ margin: 0 }}>
          {selected && detailLoading && (
            <div className="settings-loading">
              <div className="settings-spinner" />
              <span>Loading…</span>
            </div>
          )}
          {detailError && (
            <div className="settings-message settings-error-message">{detailError}</div>
          )}
          {selected && !detailLoading && detail && (
            <>
              <p className="settings-card-subtitle" style={{ marginBottom: 16 }}>
                <strong>{detail.item.name}</strong> ·{' '}
                <span style={{ textTransform: 'capitalize' }}>
                  {detail.itemType === 'inventory' ? 'product' : detail.itemType}
                </span>
                {detail.item.code != null && detail.item.code !== '' && (
                  <> · Code {String(detail.item.code)}</>
                )}
                {String((detail.item as { pimsType?: string }).pimsType ?? '')
                  .toUpperCase()
                  .trim() === 'VAYD' && (
                  <>
                    {' '}
                    ·{' '}
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 4,
                        background: '#e8f5e9',
                        color: '#1b5e20',
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      Managed in Scout
                    </span>
                  </>
                )}
              </p>

              {/* ── Tab bar ─────────────────────────────────────── */}
              <div className="inv-detail-tabs">
                <button
                  type="button"
                  className={`inv-detail-tab${detailTab === 'details' ? ' inv-detail-tab--active' : ''}`}
                  onClick={() => setDetailTab('details')}
                >
                  Details
                </button>
                {detail.itemType === 'inventory' && (
                  <button
                    type="button"
                    className={`inv-detail-tab${detailTab === 'clinical' ? ' inv-detail-tab--active' : ''}`}
                    onClick={() => setDetailTab('clinical')}
                  >
                    Clinical
                  </button>
                )}
                {detail.itemType === 'inventory' && (
                  <button
                    type="button"
                    className={`inv-detail-tab${detailTab === 'lots' ? ' inv-detail-tab--active' : ''}`}
                    onClick={() => setDetailTab('lots')}
                  >
                    Lots
                  </button>
                )}
                {detail.itemType === 'inventory' && (
                  <button
                    type="button"
                    className={`inv-detail-tab${detailTab === 'stock' ? ' inv-detail-tab--active' : ''}`}
                    onClick={() => setDetailTab('stock')}
                  >
                    Stock
                  </button>
                )}
                <button
                  type="button"
                  className={`inv-detail-tab${detailTab === 'pricing' ? ' inv-detail-tab--active' : ''}`}
                  onClick={() => setDetailTab('pricing')}
                >
                  Pricing
                </button>
                {detail.itemType === 'inventory' && (
                  <button
                    type="button"
                    className={`inv-detail-tab${detailTab === 'online-store' ? ' inv-detail-tab--active' : ''}`}
                    onClick={() => setDetailTab('online-store')}
                  >
                    Online Store
                  </button>
                )}
                <button
                  type="button"
                  className={`inv-detail-tab${detailTab === 'associations' ? ' inv-detail-tab--active' : ''}`}
                  onClick={() => setDetailTab('associations')}
                >
                  Associations
                </button>
                {detail.itemType === 'inventory' && (
                  <button
                    type="button"
                    className={`inv-detail-tab${detailTab === 'history' ? ' inv-detail-tab--active' : ''}`}
                    onClick={() => setDetailTab('history')}
                  >
                    History
                  </button>
                )}
              </div>

              {!canEditItem && (
                <div className="settings-muted" style={{ margin: '8px 0 12px', fontSize: 13 }}>
                  View only. An admin or inventory manager can change this item.
                </div>
              )}

              {detailTab === 'history' && detail.itemType === 'inventory' && selected && (
                <InventoryItemHistory
                  practiceId={practiceId}
                  inventoryItemId={selected.itemId}
                  branches={branches.filter((b) => b.isActive !== false)}
                />
              )}

              {/* ── Details tab ─────────────────────────────────── */}
              {detailTab === 'details' && <div style={{ marginBottom: 20 }}>
                {embed?.costReview && (
                  <div className="inv-cost-review-banner" key={reviewFlashKey}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Cost review — not saved yet</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', fontSize: 14 }}>
                      <span>
                        Cost{' '}
                        {embed.costReview.previousCost != null
                          ? `$${embed.costReview.previousCost.toFixed(4)}`
                          : '—'}{' '}
                        →{' '}
                        <span className="inv-cost-review-banner__change">
                          {coreDraft.cost.trim() !== '' ? `$${Number(coreDraft.cost).toFixed(4)}` : '—'}
                        </span>
                      </span>
                      <span>
                        Price{' '}
                        {embed.costReview.previousPrice != null
                          ? `$${embed.costReview.previousPrice.toFixed(2)}`
                          : '—'}{' '}
                        →{' '}
                        <span className="inv-cost-review-banner__change">
                          {coreDraft.price.trim() !== ''
                            ? `$${Number(coreDraft.price).toFixed(2)}`
                            : '—'}
                        </span>
                      </span>
                    </div>
                    <p className="settings-muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
                      {setupForId != null && setupForId === selected?.itemId
                        ? 'The new cost and suggested price are filled in. Next saves this step and continues through the rest of the item, the same as adding a product. Closing before the last step leaves the review open.'
                        : 'The new cost and suggested price are filled in below. Change them or anything else on this item, then save. Closing without saving leaves the review pending.'}
                    </p>
                    {!(setupForId != null && setupForId === selected?.itemId) && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                      <button
                        type="button"
                        className="btn primary"
                        disabled={reviewConfirming || coreSaving || !canEditItem}
                        onClick={() => void confirmCostReview()}
                      >
                        {reviewConfirming ? 'Saving…' : 'Save & update catalog'}
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={reviewConfirming}
                        onClick={() => embed.onClose()}
                      >
                        Cancel
                      </button>
                    </div>
                    )}
                  </div>
                )}
                <h4 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>
                  Catalog fields
                </h4>
                {coreError && (
                  <div className="settings-message settings-error-message" style={{ marginBottom: 8 }}>
                    {coreError}
                  </div>
                )}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                    gap: 10,
                    marginBottom: 12,
                  }}
                >
                  <label className="settings-label">
                    Name
                    <input
                      className="settings-input"
                      value={coreDraft.name}
                      onChange={(e) => setCoreDraft((d) => ({ ...d, name: e.target.value }))}
                    />
                  </label>
                  <label className="settings-label">
                    Code
                    <input
                      className="settings-input"
                      value={coreDraft.code}
                      onChange={(e) => setCoreDraft((d) => ({ ...d, code: e.target.value }))}
                    />
                  </label>
                  {detail.itemType === 'inventory' && (
                    <label className="settings-label">
                      Unit
                      <select
                        className="settings-input"
                        value={coreDraft.sellUnitType}
                        onChange={(e) =>
                          setCoreDraft((d) => ({ ...d, sellUnitType: e.target.value }))
                        }
                      >
                        {SELL_UNIT_OPTIONS.map((o) => (
                          <option key={o.value || 'empty'} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {detail.itemType === 'inventory' && coreDraft.sellUnitType === 'other' && (
                    <label className="settings-label">
                      Unit name
                      <input
                        className="settings-input"
                        value={coreDraft.sellUnitTypeDetail}
                        onChange={(e) =>
                          setCoreDraft((d) => ({ ...d, sellUnitTypeDetail: e.target.value }))
                        }
                        placeholder="e.g. vial"
                      />
                    </label>
                  )}
                </div>
                {branches.length > 1 && (
                  <div style={{ marginBottom: 14 }}>
                    <div className="settings-label" style={{ marginBottom: 4 }}>
                      Shows in search at
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
                      {branches.map((b) => (
                        <label
                          key={b.id}
                          style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}
                        >
                          <input
                            type="checkbox"
                            checked={!branchOverrideById[b.id]?.hidden}
                            disabled={branchHiddenSaving === b.id}
                            onChange={(e) => void setHiddenAtBranch(b.id, !e.target.checked)}
                          />
                          {b.name}
                        </label>
                      ))}
                    </div>
                    <p className="settings-muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
                      Unticked branches won’t see this item when searching on a visit, invoice or
                      estimate there. It stays in the Catalog. Saves right away.
                    </p>
                  </div>
                )}
                <h4 style={{ fontSize: 15, fontWeight: 600, margin: '4px 0 8px' }}>Pricing</h4>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-end',
                    gap: 8,
                    flexWrap: 'wrap',
                    marginBottom: 6,
                  }}
                >
                  <label className="settings-label" style={{ width: 150 }}>
                    Cost
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      key={`cost-${reviewFlashKey}`}
                      className={`settings-input${hasCostReview ? ' inv-cost-review-field' : ''}`}
                      value={coreDraft.cost}
                      onChange={(e) => {
                        const cost = e.target.value;
                        setCoreDraft((d) => {
                          if (optionalNumber(d.markup) !== null) {
                            const price = priceFromCostMarkup(cost, d.markup);
                            if (price !== '') return { ...d, cost, price };
                          }
                          return { ...d, cost };
                        });
                      }}
                    />
                  </label>
                  <span style={{ fontSize: 18, padding: '0 2px 8px', color: '#6b7280' }}>×</span>
                  <label className="settings-label" style={{ width: 150 }}>
                    Markup % of cost (optional)
                    <input
                      type="number"
                      step="0.01"
                      className="settings-input"
                      value={coreDraft.markup}
                      placeholder="none"
                      onChange={(e) => {
                        const markup = e.target.value;
                        setCoreDraft((d) => {
                          const price = priceFromCostMarkup(d.cost, markup);
                          return { ...d, markup, price: price !== '' ? price : d.price };
                        });
                      }}
                    />
                  </label>
                  <span style={{ fontSize: 18, padding: '0 2px 8px', color: '#6b7280' }}>=</span>
                  <label className="settings-label" style={{ width: 150 }}>
                    Price
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      key={`price-${reviewFlashKey}`}
                      className={`settings-input${hasCostReview ? ' inv-cost-review-field' : ''}`}
                      value={coreDraft.price}
                      onChange={(e) => {
                        const price = e.target.value;
                        setCoreDraft((d) => ({
                          ...d,
                          price,
                          markup:
                            d.markup.trim() === ''
                              ? ''
                              : markupPctFromCostPrice(d.cost, price) || d.markup,
                        }));
                      }}
                    />
                  </label>
                </div>
                <p className="settings-muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
                  {(() => {
                    const cost = optionalNumber(coreDraft.cost);
                    const price = optionalNumber(coreDraft.price);
                    const markup = optionalNumber(coreDraft.markup);
                    const money = (n: number) => `$${n.toFixed(2)}`;
                    if (cost === null || cost <= 0) {
                      return 'Add a cost to price by markup, or just enter the price.';
                    }
                    if (markup === null) {
                      return price !== null
                        ? `No markup set. Price is entered directly (${money(price - cost)} over cost). Enter a markup to calculate the price from cost instead.`
                        : 'Enter a markup to calculate the price from cost, or just enter the price.';
                    }
                    const calc = (cost * markup) / 100;
                    if (price !== null && Math.abs(calc - price) > 0.01) {
                      return (
                        <span style={{ color: '#b45309' }}>
                          The saved markup doesn’t match the price: {money(cost)} cost × {markup}%
                          would be {money(calc)}, but the price is {money(price)}. Re-enter
                          the markup to recalculate the price, or re-enter the price to fix the
                          markup.
                        </span>
                      );
                    }
                    return (
                      <>
                        {money(cost)} cost × {markup}% = <strong>{money(calc)}</strong> price (
                        {money(calc - cost)} over cost). Changing the markup or cost updates the
                        price; typing a price updates the markup.
                        {price !== null && price < cost && (
                          <span style={{ color: '#b91c1c' }}> Price is below cost.</span>
                        )}
                      </>
                    );
                  })()}
                </p>
                {(detail.itemType === 'procedure' || detail.itemType === 'inventory') && (
                  <div
                    style={{
                      display: 'flex',
                      gap: 10,
                      flexWrap: 'wrap',
                      marginBottom: 12,
                    }}
                  >
                    <label className="settings-label" style={{ width: 150 }}>
                      Service fee
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="settings-input"
                        value={coreDraft.serviceFee}
                        onChange={(e) =>
                          setCoreDraft((d) => ({ ...d, serviceFee: e.target.value }))
                        }
                      />
                    </label>
                    {detail.itemType === 'inventory' && (
                      <label className="settings-label" style={{ width: 150 }}>
                        Minimum price
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className="settings-input"
                          value={coreDraft.minimumPrice}
                          onChange={(e) =>
                            setCoreDraft((d) => ({ ...d, minimumPrice: e.target.value }))
                          }
                        />
                      </label>
                    )}
                  </div>
                )}
                <div style={{ maxWidth: 280, marginBottom: 12 }}>
                  <CategorySelect
                    categories={categories}
                    label="Scout catalog category"
                    value={coreDraft.category}
                    onChange={(category) =>
                      setCoreDraft((d) => ({ ...d, category }))
                    }
                  />
                </div>
                {detail.itemType === 'inventory' && (
                  <div
                    style={{
                      display: 'flex',
                      gap: 16,
                      flexWrap: 'wrap',
                      marginBottom: 12,
                      maxWidth: 560,
                    }}
                  >
                    {selected && (
                      <RecommendedAbcInfo
                        practiceId={practiceId}
                        itemId={selected.itemId}
                        recommendedAbc={(detail.item as InventoryItem).recommendedAbc ?? null}
                      />
                    )}
                    <label className="settings-label">
                      Assigned class
                      <select
                        className="settings-input"
                        value={coreDraft.assignedAbc}
                        onChange={(e) =>
                          setCoreDraft((d) => ({ ...d, assignedAbc: e.target.value }))
                        }
                      >
                        <option value="">Auto (use recommended)</option>
                        <option value="A">A — count monthly</option>
                        <option value="B">B — count quarterly</option>
                        <option value="C">C — count twice a year</option>
                      </select>
                    </label>
                  </div>
                )}
                <div style={{ maxWidth: 280, marginBottom: 12 }}>
                  <TaxLevelSelect
                    settings={taxSettings}
                    value={coreDraft.taxLevelValue}
                    onChange={(taxLevelValue) =>
                      setCoreDraft((d) => ({ ...d, taxLevelValue }))
                    }
                  />
                </div>
                {/*
                  Worded the way eVet words them, and stored the way eVet stores
                  them — hence the inversions. Staff recognize these four labels.
                */}
                {detail.itemType === 'procedure' && (
                  <div style={{ marginBottom: 8 }}>
                    <label className="settings-checkbox-item">
                      <input
                        type="checkbox"
                        checked={!coreDraft.hideOnInvoice}
                        onChange={(e) =>
                          setCoreDraft((d) => ({ ...d, hideOnInvoice: !e.target.checked }))
                        }
                      />
                      <span>
                        Show on invoice
                        <small style={{ display: 'block', color: '#6b7280' }}>
                          Off keeps the charge on the invoice but off the client&rsquo;s copy.
                        </small>
                      </span>
                    </label>
                    <label className="settings-checkbox-item">
                      <input
                        type="checkbox"
                        checked={!coreDraft.excludeFromProduction}
                        onChange={(e) =>
                          setCoreDraft((d) => ({
                            ...d,
                            excludeFromProduction: !e.target.checked,
                          }))
                        }
                      />
                      <span>
                        Include in provider production
                        <small style={{ display: 'block', color: '#6b7280' }}>
                          Off means the revenue stays with the practice — use this for
                          shipping and handling.
                        </small>
                      </span>
                    </label>
                    <label className="settings-checkbox-item">
                      <input
                        type="checkbox"
                        checked={coreDraft.changePatientSex}
                        onChange={(e) =>
                          setCoreDraft((d) => ({ ...d, changePatientSex: e.target.checked }))
                        }
                      />
                      <span>
                        Change patient sex
                        <small style={{ display: 'block', color: '#6b7280' }}>
                          For spays and neuters: when the invoice is finalized, the pet is changed
                          to spayed or neutered.
                        </small>
                      </span>
                    </label>
                    <label className="settings-label" style={{ display: 'block', margin: '8px 0', maxWidth: 320 }}>
                      Change patient status to
                      <select
                        className="settings-input"
                        value={coreDraft.changePatientStatusTo}
                        onChange={(e) =>
                          setCoreDraft((d) => ({ ...d, changePatientStatusTo: e.target.value }))
                        }
                      >
                        <option value="">No change</option>
                        {coreDraft.changePatientStatusTo &&
                        !createPatientStatuses.some(
                          (s) => s.name === coreDraft.changePatientStatusTo
                        ) ? (
                          <option value={coreDraft.changePatientStatusTo}>
                            {coreDraft.changePatientStatusTo}
                          </option>
                        ) : null}
                        {createPatientStatuses.map((s) => (
                          <option key={s.id} value={s.name}>
                            {s.name}
                            {s.marksInactive ? ' (marks inactive)' : ''}
                          </option>
                        ))}
                      </select>
                      <small style={{ display: 'block', color: '#6b7280', marginTop: 4 }}>
                        Set when the invoice is finalized. A status that marks inactive also
                        stops the pet&rsquo;s memberships, auto-ships, reminders, refills, and
                        future visits.
                      </small>
                    </label>
                    {/*
                      The euthanasia consent form reads this item off the estimate
                      and asks the family to confirm it, so the plan has to be
                      named here. Urns, nameplates, and paw prints are not
                      aftercare — only the cremation or burial charge itself.
                    */}
                    <label className="settings-checkbox-item">
                      <input
                        type="checkbox"
                        checked={coreDraft.isAftercare}
                        onChange={(e) =>
                          setCoreDraft((d) => ({
                            ...d,
                            isAftercare: e.target.checked,
                            aftercareType: e.target.checked ? d.aftercareType : '',
                            aftercareDisplayName: e.target.checked ? d.aftercareDisplayName : '',
                          }))
                        }
                      />
                      <span>
                        This is an aftercare item
                        <small style={{ display: 'block', color: '#6b7280' }}>
                          The charge that decides what happens to the pet. Families confirm it
                          on the euthanasia consent form.
                        </small>
                      </span>
                    </label>
                    {coreDraft.isAftercare && (
                      <div style={{ margin: '4px 0 8px 28px', maxWidth: 420 }}>
                        <label style={{ display: 'block', marginBottom: 8 }}>
                          <span style={{ display: 'block', marginBottom: 4 }}>
                            Which plan is it?
                          </span>
                          <select
                            value={coreDraft.aftercareType}
                            onChange={(e) =>
                              setCoreDraft((d) => ({
                                ...d,
                                aftercareType: e.target.value as AftercareItemType | '',
                              }))
                            }
                          >
                            <option value="">Choose a plan…</option>
                            <option value="private_cremation">
                              Private cremation (ashes returned)
                            </option>
                            <option value="burial_at_sea">
                              Cremation, no ashes returned (burial at sea)
                            </option>
                            <option value="home_burial">Home burial / owner arranges</option>
                          </select>
                        </label>
                        <label style={{ display: 'block' }}>
                          <span style={{ display: 'block', marginBottom: 4 }}>
                            What the family reads (optional)
                          </span>
                          <input
                            style={{ width: '100%' }}
                            maxLength={255}
                            placeholder={
                              coreDraft.aftercareType
                                ? AFTERCARE_ITEM_LABELS[coreDraft.aftercareType]
                                : 'Leave blank for our standard wording'
                            }
                            value={coreDraft.aftercareDisplayName}
                            onChange={(e) =>
                              setCoreDraft((d) => ({
                                ...d,
                                aftercareDisplayName: e.target.value,
                              }))
                            }
                          />
                        </label>
                      </div>
                    )}
                  </div>
                )}
                {canEditItem && !(setupForId != null && setupForId === selected?.itemId) && (
                  <button
                    type="button"
                    className="btn primary"
                    disabled={coreSaving}
                    onClick={() => void saveCoreFields()}
                  >
                    {coreSaving ? 'Saving…' : 'Save catalog fields'}
                  </button>
                )}
                {detail.itemType === 'lab' && selected && (
                  <LabIntegrationEditor
                    practiceId={practiceId}
                    lab={detail.item as Lab}
                    onSaved={() => refreshDetailBundle(selected)}
                  />
                )}
              </div>}

              {/* ── Clinical tab (inventory only) ────────────────── */}
              {detailTab === 'clinical' && detail.itemType === 'inventory' && (
                <CatalogInventoryClinicalFields
                  practiceId={practiceId}
                  item={detail.item as InventoryItem}
                  alwaysExpanded
                  saveRef={clinicalSaveRef}
                  readOnly={!canEditItem}
                  onSaved={() => {
                    setToast('Supply & clinical flags saved');
                    window.setTimeout(() => setToast(null), 3500);
                    if (selected) void refreshDetailBundle(selected);
                  }}
                />
              )}

              {/* ── Lots tab (inventory only) ─────────────────────── */}
              {detailTab === 'lots' && detail.itemType === 'inventory' && (
                <CatalogItemLotsEditor
                  practiceId={practiceId}
                  inventoryItemId={selected!.itemId}
                  stockItemId={stockItemId}
                  stockItemName={stockLinkItemLabel}
                  branches={branches}
                  trackLots={
                    (detail.item as InventoryItem).trackLots === true || stockItemId != null
                  }
                  requireExpirationOnLots
                  requireLotNumber={
                    (detail.item as InventoryItem).requireLotNumber === true
                  }
                        weightUnit={(() => {
                          const it = detail.item as InventoryItem;
                          return it.isControlled === true &&
                            (it.controlledMeasure === 'weight' || it.controlledMeasure === 'both')
                            ? it.weightUnit === 'oz'
                              ? 'oz'
                              : 'g'
                            : null;
                        })()}
                        bottleMl={(() => {
                          const n = Number((detail.item as InventoryItem).unitsPerPackage);
                          return Number.isFinite(n) && n > 0 ? n : null;
                        })()}
                  onLotsChanged={() => {
                    if (stockItemId != null) void loadBranchStock(stockItemId, branches);
                  }}
                  onOpenStockItem={
                    stockItemId != null &&
                    selected != null &&
                    stockItemId !== selected.itemId
                      ? () =>
                          setSelected({
                            itemType: 'inventory',
                            itemId: stockItemId,
                            label: stockLinkItemLabel || `Item #${stockItemId}`,
                          })
                      : undefined
                  }
                />
              )}

              {detailTab === 'associations' &&
                (detail.itemType === 'inventory' || detail.itemType === 'lab') && (
                <div style={{ marginBottom: 20 }}>
                  <h4 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>Stock item</h4>
                  {detail.itemType === 'lab' ? (
                    <p className="settings-muted" style={{ marginBottom: 12, fontSize: 13 }}>
                      For tests run in house (4Dx SNAP, FeLV/FIV combo): the kit this test uses up
                      when it&apos;s charged, so kits are counted and restocked like other
                      inventory. Leave empty for send-out labs; they don&apos;t use any of our
                      stock.
                    </p>
                  ) : (
                    <p className="settings-muted" style={{ marginBottom: 12, fontSize: 13 }}>
                      Which item is counted when this one is sold. Leave empty when this item is its
                      own stock. Point several sellable codes at one stock item — a single capsule and
                      a bottle of 100 both draw from the same capsule pool — and counts stay in one
                      place no matter how you sell.
                    </p>
                  )}
                  {stockLinkError && (
                    <div className="settings-message settings-error-message" style={{ marginBottom: 8 }}>
                      {stockLinkError}
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 520 }}>
                    <div>
                      <div className="settings-label" style={{ marginBottom: 6 }}>
                        Draws from
                      </div>
                      {stockLinkItemId == null ? (
                        <>
                          <input
                            className="settings-input"
                            value={stockLinkQuery}
                            onChange={(e) => setStockLinkQuery(e.target.value)}
                            placeholder={
                              detail.itemType === 'lab'
                                ? 'Search stock items, e.g. 4dx Tests (blank = send-out, uses no stock)'
                                : 'Search inventory items (blank = draws on itself)'
                            }
                          />
                          {stockLinkSearching && (
                            <p className="settings-muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
                              Searching…
                            </p>
                          )}
                          {stockLinkResults.length > 0 && (
                            <div className="inv-stock-link__results">
                              {stockLinkResults.map((r) => (
                                <button
                                  key={`stock-link-${r.inventoryItem?.id}`}
                                  type="button"
                                  className="inv-stock-link__result"
                                  onClick={() => {
                                    const id = r.inventoryItem?.id;
                                    if (id == null) return;
                                    setStockLinkItemId(Number(id));
                                    setStockLinkItemLabel(r.name);
                                    setStockLinkQuery('');
                                    setStockLinkResults([]);
                                  }}
                                >
                                  {r.name}
                                  {r.code ? (
                                    <span className="settings-muted"> · {r.code}</span>
                                  ) : null}
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <strong>{stockLinkItemLabel || `Item #${stockLinkItemId}`}</strong>
                          <button
                            type="button"
                            className="btn secondary"
                            style={{ padding: '4px 10px', fontSize: 13 }}
                            onClick={() => {
                              setStockLinkItemId(null);
                              setStockLinkItemLabel('');
                              setStockLinkQty('');
                            }}
                          >
                            Change
                          </button>
                        </div>
                      )}
                    </div>
                    {stockLinkItemId != null && (
                      <label className="settings-label" style={{ maxWidth: 320 }}>
                        {detail.itemType === 'lab'
                          ? 'Kits used per test'
                          : 'Stock units consumed per unit sold'}
                        <input
                          type="text"
                          inputMode="decimal"
                          className="settings-input"
                          value={stockLinkQty}
                          onChange={(e) => setStockLinkQty(e.target.value)}
                          placeholder="1"
                        />
                        <small className="settings-muted" style={{ display: 'block', fontWeight: 400, marginTop: 4 }}>
                          Multiplied by the quantity charged. At 1, charging 2 uses 2 of{' '}
                          {stockLinkItemLabel || 'the stock item'}; a bottle of 100 would be 100.
                          Blank means 1.
                        </small>
                      </label>
                    )}
                    <div>
                      <button
                        type="button"
                        className="btn primary"
                        disabled={stockLinkSaving}
                        onClick={() => void saveStockLink()}
                      >
                        {stockLinkSaving ? 'Saving…' : 'Save stock item'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Associations tab ─────────────────────────────── */}
              {detailTab === 'associations' && selected && (
                <CatalogItemRemindersEditor
                  practiceId={practiceId}
                  itemType={detail.itemType}
                  itemId={selected.itemId}
                  itemName={String(detail.item.name ?? selected.label)}
                />
              )}
              {detailTab === 'associations' && selected && (
                <CatalogTagalongsEditor
                  key={`tagalong-${detail.itemType}-${selected.itemId}`}
                  practiceId={practiceId}
                  itemType={detail.itemType}
                  itemId={selected.itemId}
                  onlineStoreEnabled={onlineStoreImplemented}
                />
              )}

              {/* ── Pricing tab ──────────────────────────────────── */}
              {detailTab === 'pricing' && <div style={{ marginBottom: 16 }}>
                  <h4 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>
                    Prices by branch
                  </h4>
                  <p className="settings-muted" style={{ marginBottom: 10, fontSize: 13 }}>
                    Branches follow the prices in Details unless you give them their own. A branch
                    markup keeps the price following cost. Sell total uses the same formula as SOAP
                    and checkout.
                  </p>
                  {branchPricesError && (
                    <div className="settings-message settings-error-message" style={{ marginBottom: 8 }}>
                      {branchPricesError}
                    </div>
                  )}
                  {branchPricesLoading && Object.keys(branchEffectiveById).length === 0 ? (
                    <p className="settings-muted">Loading branch prices…</p>
                  ) : (
                    <table className="settings-table">
                      <thead>
                        <tr>
                          <th>Branch</th>
                          <th>Pricing</th>
                          <th>Price</th>
                          <th>Cost</th>
                          <th>Service fee</th>
                          <th>Min</th>
                          <th>Sell total</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {branches.map((b) => {
                          const m = branchEffectiveById[b.id];
                          const o = branchOverrideById[b.id];
                          const ownMoney =
                            o != null &&
                            (o.price != null ||
                              o.cost != null ||
                              o.serviceFee != null ||
                              o.minimumPrice != null ||
                              o.markup != null);
                          const pricing =
                            o?.markup != null
                              ? `Own markup ${Number(o.markup)}%`
                              : o?.price != null
                                ? 'Own price'
                                : ownMoney
                                  ? 'Details, with branch changes'
                                  : 'Follows Details';
                          return (
                            <tr key={b.id}>
                              <td>{b.name}</td>
                              <td className={ownMoney ? undefined : 'settings-muted'}>{pricing}</td>
                              <td>{m?.price != null ? `$${Number(m.price).toFixed(2)}` : '—'}</td>
                              <td>{m?.cost != null ? `$${Number(m.cost).toFixed(2)}` : '—'}</td>
                              <td>
                                {m?.serviceFee != null ? `$${Number(m.serviceFee).toFixed(2)}` : '—'}
                              </td>
                              <td>
                                {m?.minimumPrice != null
                                  ? `$${Number(m.minimumPrice).toFixed(2)}`
                                  : '—'}
                              </td>
                              <td>
                                {m?.price != null ? (
                                  <strong>
                                    ${unitSellTotal(detail.itemType, m).toFixed(2)}
                                  </strong>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="btn secondary"
                                  style={{ padding: '4px 10px', fontSize: 13 }}
                                  onClick={() =>
                                    openPriceModal({
                                      seedBranchId: b.id,
                                      targetBranchIds: [b.id],
                                    })
                                  }
                                >
                                  Edit
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                        {detail.itemType === 'inventory' && onlineStoreImplemented && (
                          (() => {
                            const base =
                              catalogDraft.onlineStorePrice.trim() === ''
                                ? null
                                : Number(catalogDraft.onlineStorePrice);
                            const hasBase = base != null && Number.isFinite(base);
                            // Online store is not a branch: it carries its own web price but uses
                            // the practice catalog cost / fee / minimum in the sell formula.
                            const storeMoney: ResolvedMoney = {
                              price: hasBase ? (base as number) : 0,
                              cost: practiceMoney?.cost ?? 0,
                              serviceFee: practiceMoney?.serviceFee ?? 0,
                              minimumPrice: practiceMoney?.minimumPrice ?? 0,
                            };
                            return (
                              <tr>
                                <td>
                                  Online store
                                  {!catalogDraft.showOnOnlineStore && (
                                    <span className="settings-muted" style={{ fontSize: 12 }}>
                                      {' '}
                                      · not listed
                                    </span>
                                  )}
                                </td>
                                <td className="settings-muted">Web price</td>
                                <td>{hasBase ? `$${storeMoney.price.toFixed(2)}` : '—'}</td>
                                <td>${storeMoney.cost.toFixed(2)}</td>
                                <td>${storeMoney.serviceFee.toFixed(2)}</td>
                                <td>${storeMoney.minimumPrice.toFixed(2)}</td>
                                <td>
                                  {hasBase ? (
                                    <strong>
                                      ${unitSellTotal(detail.itemType, storeMoney).toFixed(2)}
                                    </strong>
                                  ) : (
                                    '—'
                                  )}
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    className="btn secondary"
                                    style={{ padding: '4px 10px', fontSize: 13 }}
                                    onClick={() =>
                                      openPriceModal({
                                        seedBranchId: branchId,
                                        onlineStoreOnly: true,
                                      })
                                    }
                                  >
                                    Edit
                                  </button>
                                </td>
                              </tr>
                            );
                          })()
                        )}
                      </tbody>
                    </table>
                  )}
                  <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() => openPriceModalAllBranches()}
                      disabled={!branches.length}
                    >
                      Apply prices to all…
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => refreshDetailBundle(selected)}
                    >
                      Refresh
                    </button>
                  </div>
                  <CatalogDiscountRulesFields
                    value={coreDraft}
                    onChange={(patch) => setCoreDraft((d) => ({ ...d, ...patch }))}
                  />
                  {canEditItem && (
                    <button
                      type="button"
                      className="btn primary"
                      style={{ marginTop: 8 }}
                      disabled={coreSaving}
                      onClick={() => void saveCoreFields()}
                    >
                      {coreSaving ? 'Saving…' : 'Save discount rules'}
                    </button>
                  )}
                </div>}

              {/* ── Stock tab ────────────────────────────────────── */}
              {detailTab === 'stock' && detail.itemType === 'inventory' && (
                <div style={{ marginBottom: 20 }}>
                  <h4 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>
                    Counts by branch
                  </h4>
                  <p className="settings-muted" style={{ marginBottom: 10, fontSize: 13 }}>
                    {stockLinkItemId != null && stockLinkItemId !== selected?.itemId ? (
                      <>
                        This sellable has no count of its own. On-hand, reorder points, and
                        movements live on{' '}
                        <strong>{stockLinkItemLabel || `item #${stockLinkItemId}`}</strong>.
                        <button
                          type="button"
                          className="btn"
                          style={{ marginLeft: 8 }}
                          onClick={() =>
                            setSelected({
                              itemType: 'inventory',
                              itemId: stockLinkItemId,
                              label: stockLinkItemLabel || `Item #${stockLinkItemId}`,
                            })
                          }
                        >
                          Open inventory item
                        </button>
                      </>
                    ) : (
                      <>
                    Click a branch to edit on-hand counts, default re-order point/max, and location
                    pars.
                    {(detail.item as InventoryItem).trackLots === true && (
                      <>
                        {' '}
                        Lot-tracked items: change on-hand under <strong>Lots</strong> so lot balances
                        stay aligned.
                      </>
                    )}
                      </>
                    )}
                  </p>
                  {stockLinkItemId != null && stockLinkItemId !== selected?.itemId ? null : stockError && (
                    <div className="settings-message settings-error-message" style={{ marginBottom: 8 }}>
                      {stockError}
                    </div>
                  )}
                  {stockLinkItemId != null && stockLinkItemId !== selected?.itemId ? null : stockLoading && Object.keys(stockByBranchId).length === 0 ? (
                    <p className="settings-muted">Loading stock…</p>
                  ) : (
                    <table className="settings-table inv-counts-by-branch">
                      <thead>
                        <tr>
                          <th style={{ width: 28 }} />
                          <th>Branch</th>
                          <th>On hand</th>
                          <th>Max</th>
                          <th>Re-order point</th>
                        </tr>
                      </thead>
                      <tbody>
                        {branches.map((b) => {
                          const stock = stockByBranchId[b.id];
                          const expanded = countsExpandedBranchId === b.id;
                          const onHand =
                            stock?.quantityOnHandTotal == null ||
                            Number.isNaN(Number(stock.quantityOnHandTotal))
                              ? '—'
                              : String(stock.quantityOnHandTotal);
                          const defaultLoc = defaultStockLocation(stock);
                          const par =
                            defaultLoc?.parLevel == null || Number.isNaN(Number(defaultLoc.parLevel))
                              ? '—'
                              : String(defaultLoc.parLevel);
                          const reorder =
                            stock?.reorderPoint == null || Number.isNaN(Number(stock.reorderPoint))
                              ? '—'
                              : String(stock.reorderPoint);
                          const unitCost = toMoneyNumber(
                            branchEffectiveById[b.id]?.cost ?? practiceMoney?.cost
                          );
                          const extCost =
                            stock?.quantityOnHandTotal != null &&
                            !Number.isNaN(Number(stock.quantityOnHandTotal))
                              ? unitCost * Number(stock.quantityOnHandTotal)
                              : null;
                          return (
                            <Fragment key={b.id}>
                              <tr
                                className="inv-counts-by-branch__row"
                                onClick={() =>
                                  setCountsExpandedBranchId((prev) => (prev === b.id ? null : b.id))
                                }
                              >
                                <td>
                                  {expanded ? (
                                    <ChevronDown size={16} aria-hidden />
                                  ) : (
                                    <ChevronRight size={16} aria-hidden />
                                  )}
                                </td>
                                <td>{b.name}</td>
                                <td>{onHand}</td>
                                <td>{par}</td>
                                <td>{reorder}</td>
                              </tr>
                              {expanded && (
                                <tr className="inv-counts-by-branch__detail">
                                  <td colSpan={5}>
                                    {extCost != null && (
                                      <p style={{ margin: '0 0 12px', fontSize: 14 }}>
                                        <strong>Extended cost:</strong> ${extCost.toFixed(2)}
                                        <span
                                          className="settings-muted"
                                          style={{ marginLeft: 8, fontSize: 13 }}
                                        >
                                          (unit cost × on hand)
                                        </span>
                                      </p>
                                    )}
                                    {stock?.locations && stock.locations.length > 0 ? (
                                      <div
                                        className="settings-table-container"
                                        style={{ marginBottom: 12 }}
                                      >
                                        <table className="settings-table">
                                          <thead>
                                            <tr>
                                              <th>Location</th>
                                              <th>Code</th>
                                              <th>Qty</th>
                                              <th>Re-order point</th>
                                              <th>Max / Par</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {stock.locations.map((row) => {
                                              const isDefault =
                                                defaultLoc?.branchLocationId ===
                                                row.branchLocationId;
                                              const qtyKey = `${b.id}:${row.branchLocationId}`;
                                              return (
                                              <tr key={row.branchLocationId}>
                                                <td>
                                                  {row.name}
                                                  {isDefault ? ' (default)' : ''}
                                                </td>
                                                <td>
                                                  <code>{row.code}</code>
                                                </td>
                                                <td onClick={(e) => e.stopPropagation()}>
                                                  <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    className="settings-input"
                                                    style={{ maxWidth: 88 }}
                                                    value={qtyDraftByLocationKey[qtyKey] ?? ''}
                                                    onChange={(e) =>
                                                      setQtyDraftByLocationKey((prev) => ({
                                                        ...prev,
                                                        [qtyKey]: e.target.value,
                                                      }))
                                                    }
                                                    placeholder="—"
                                                    aria-label={`${row.name} on hand`}
                                                  />
                                                </td>
                                                <td onClick={(e) => e.stopPropagation()}>
                                                  {isDefault ? (
                                                    <input
                                                      type="text"
                                                      inputMode="decimal"
                                                      className="settings-input"
                                                      style={{ maxWidth: 88 }}
                                                      value={reorderDraftByBranchId[b.id] ?? ''}
                                                      onChange={(e) =>
                                                        setReorderDraftByBranchId((prev) => ({
                                                          ...prev,
                                                          [b.id]: e.target.value,
                                                        }))
                                                      }
                                                      placeholder="—"
                                                      aria-label={`${row.name} re-order point`}
                                                    />
                                                  ) : (
                                                    <span className="settings-muted">—</span>
                                                  )}
                                                </td>
                                                <td onClick={(e) => e.stopPropagation()}>
                                                  <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    className="settings-input"
                                                    style={{ maxWidth: 88 }}
                                                    value={
                                                      parDraftByLocationKey[
                                                        `${b.id}:${row.branchLocationId}`
                                                      ] ?? ''
                                                    }
                                                    onChange={(e) =>
                                                      setParDraftByLocationKey((prev) => ({
                                                        ...prev,
                                                        [`${b.id}:${row.branchLocationId}`]:
                                                          e.target.value,
                                                      }))
                                                    }
                                                    placeholder="—"
                                                    aria-label={
                                                      isDefault ? `${row.name} max` : `${row.name} par`
                                                    }
                                                  />
                                                </td>
                                              </tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      </div>
                                    ) : (
                                      <p className="settings-muted" style={{ marginBottom: 12 }}>
                                        No location balances yet.
                                      </p>
                                    )}
                                    <div
                                      style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 10,
                                        maxWidth: 360,
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <button
                                        type="button"
                                        className="btn primary"
                                        disabled={stockSaving}
                                        onClick={() => void saveReorderPoint(b.id)}
                                      >
                                        {stockSaving
                                          ? 'Saving…'
                                          : 'Save counts, re-order point, max & par'}
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* ── Online Store tab ─────────────────────────────── */}
              {detailTab === 'online-store' && detail.itemType === 'inventory' && (
                <div
                  style={{
                    marginBottom: 20,
                  }}
                >
                  <h4 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>
                    Online store
                  </h4>
                  <p className="settings-muted" style={{ marginBottom: 12, fontSize: 13 }}>
                    {onlineStoreImplemented
                      ? 'Description, shipping, picture, listing, online store category, and web price for this SKU. Labs and procedures are not listed here — they can still appear as a tagalong on a listed product.'
                      : 'Online store listing is off for this practice — enable it under Settings → Inventory.'}
                  </p>
                  {catalogError && (
                    <div className="settings-message settings-error-message" style={{ marginBottom: 8 }}>
                      {catalogError}
                    </div>
                  )}
                  {onlineStoreImplemented ? (
                    <>
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          marginBottom: 16,
                          cursor: 'pointer',
                          fontSize: 14,
                          fontWeight: 500,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={catalogDraft.showOnOnlineStore}
                          onChange={(e) =>
                            setCatalogDraft((d) => ({ ...d, showOnOnlineStore: e.target.checked }))
                          }
                        />
                        Listed on online store{sharedStoreListing ? ' (this size)' : ''}
                      </label>
                      {!sharedStoreListing ? (
                        <label
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            marginTop: -8,
                            marginBottom: 16,
                            cursor: 'pointer',
                            fontSize: 14,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={catalogDraft.featuredOnHome}
                            onChange={(e) =>
                              setCatalogDraft((d) => ({ ...d, featuredOnHome: e.target.checked }))
                            }
                          />
                          Feature on the store home page
                        </label>
                      ) : null}
                      {sharedStoreListing ? (
                        <div
                          className="settings-muted"
                          style={{
                            fontSize: 13,
                            marginBottom: 14,
                            padding: '10px 12px',
                            border: '1px solid #e2e8f0',
                            borderRadius: 8,
                          }}
                        >
                          Part of the store product <strong>{sharedStoreListing.name}</strong> (
                          {sharedStoreListing.variants.length} sizes)
                          {sharedStoreListing.storeCategory
                            ? ` in ${sharedStoreListing.storeCategory}`
                            : ''}
                          . Its description and category are shared by every size, so edit them
                          on Store items.{' '}
                          <button
                            type="button"
                            className="btn secondary"
                            style={{ padding: '2px 10px', fontSize: 13, marginLeft: 4 }}
                            onClick={() =>
                              navigate(
                                `/schedule/inventory/online-store?tab=items&product=${encodeURIComponent(
                                  sharedStoreListing.listingId
                                )}`
                              )
                            }
                          >
                            Open in Store items
                          </button>
                        </div>
                      ) : (
                      <>
                      <label className="settings-label" style={{ display: 'block', marginBottom: 12 }}>
                        Store listing description
                        <small style={{ display: 'block', color: '#6b7280', fontWeight: 400 }}>Shows below the product name on the online store. Leave blank to use no description.</small>
                        <textarea
                          className="settings-input"
                          rows={3}
                          value={catalogDraft.description}
                          onChange={(e) =>
                            setCatalogDraft((d) => ({ ...d, description: e.target.value }))
                          }
                          placeholder="e.g. Annual vaccination against Lyme disease."
                        />
                      </label>
                      <label className="settings-label" style={{ display: 'block', marginBottom: 12 }}>
                        Online store category
                        <select
                          className="settings-input"
                          value={catalogDraft.storeCategory}
                          onChange={(e) => {
                            const next = e.target.value;
                            if (next === '__new__') {
                              void appPrompt({
                                title: 'New store category',
                                message:
                                  'This is a shop category (Memorial, Urns, and so on) — not a Scout catalog category.',
                                placeholder: 'e.g. Memorial / Urns',
                              }).then((typed) => {
                                const name = typed?.trim() || '';
                                if (!name) return;
                                setCatalogDraft((d) => ({ ...d, storeCategory: name }));
                                void rememberStoreCategory(name);
                              });
                              return;
                            }
                            setCatalogDraft((d) => ({ ...d, storeCategory: next }));
                          }}
                        >
                          <option value="">No store category</option>
                          {[
                            ...new Set(
                              [
                                catalogDraft.storeCategory,
                                ...storeCategories.map((row) => row.name),
                              ].filter(Boolean)
                            ),
                          ]
                            .sort((a, b) => a.localeCompare(b))
                            .map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          <option value="__new__">Add new category…</option>
                        </select>
                      </label>
                      </>
                      )}
                      {detail.itemType === 'inventory' && (
                      <fieldset style={{ border: 'none', padding: 0, margin: '0 0 12px' }}>
                        <legend className="settings-label" style={{ marginBottom: 6 }}>
                          Shippable?
                        </legend>
                        <label style={{ marginRight: 16, fontSize: 14, cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name="inv-shippable"
                            checked={catalogDraft.shippable}
                            onChange={() => setCatalogDraft((d) => ({ ...d, shippable: true }))}
                          />{' '}
                          Yes
                        </label>
                        <label style={{ fontSize: 14, cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name="inv-shippable"
                            checked={!catalogDraft.shippable}
                            onChange={() => setCatalogDraft((d) => ({ ...d, shippable: false }))}
                          />{' '}
                          No
                        </label>
                      </fieldset>
                      )}
                      <div className="inv-item-picture" style={{ marginBottom: 14 }}>
                        <div className="settings-label" style={{ marginBottom: 6 }}>
                          Store listing picture
                        </div>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                          <div className="inv-item-picture__preview">
                            {itemHasImage ? (
                              <img
                                src={inventoryItemImageUrl(
                                  practiceId,
                                  selected.itemId,
                                  itemImageVersion
                                )}
                                alt=""
                              />
                            ) : (
                              <span className="settings-muted">No picture</span>
                            )}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <input
                              ref={itemImageInputRef}
                              type="file"
                              accept="image/jpeg,image/png,image/gif,image/webp"
                              style={{ display: 'none' }}
                              onChange={(e) =>
                                void onInventoryImageSelected(e.target.files?.[0] ?? null)
                              }
                            />
                            <button
                              type="button"
                              className="btn secondary"
                              disabled={imageUploading}
                              onClick={() => itemImageInputRef.current?.click()}
                            >
                              {imageUploading
                                ? 'Uploading…'
                                : itemHasImage
                                  ? 'Replace picture'
                                  : 'Upload picture'}
                            </button>
                            {itemHasImage && detail.itemType === 'inventory' && (
                              <button
                                type="button"
                                className="btn secondary"
                                disabled={imageUploading}
                                onClick={() => void removeInventoryImage()}
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                      {detail.itemType === 'inventory' ? (
                        <p style={{ margin: '0 0 12px', fontSize: 14 }}>
                          Prescription required:{' '}
                          <strong>{catalogDraft.requiresDoctorApproval ? 'Yes' : 'No'}</strong>{' '}
                          <span className="settings-muted">(set on Clinical)</span>{' '}
                          <button
                            type="button"
                            className="inv-catalog-results__text-btn"
                            onClick={() => setDetailTab('clinical')}
                          >
                            Change
                          </button>
                        </p>
                      ) : (
                        <label
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            marginBottom: 12,
                            cursor: 'pointer',
                            fontSize: 14,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={catalogDraft.requiresDoctorApproval}
                            onChange={(e) =>
                              setCatalogDraft((d) => ({
                                ...d,
                                requiresDoctorApproval: e.target.checked,
                              }))
                            }
                          />
                          Prescription required (refills on file skip the doctor)
                        </label>
                      )}
                      {detail.itemType === 'inventory' && (
                        <>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              marginBottom: 12,
                              fontSize: 14,
                              flexWrap: 'wrap',
                            }}
                          >
                            <label
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                cursor: 'pointer',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={catalogDraft.autoshipOffered}
                                onChange={(e) =>
                                  setCatalogDraft((d) => ({
                                    ...d,
                                    autoshipOffered: e.target.checked,
                                    autoshipFrequency: d.autoshipFrequency || 'monthly',
                                  }))
                                }
                              />
                              Autoship
                            </label>
                            {catalogDraft.autoshipOffered ? (
                              <select
                                className="settings-input"
                                style={{ width: 'auto' }}
                                aria-label="Recommended autoship frequency"
                                value={catalogDraft.autoshipFrequency}
                                onChange={(e) =>
                                  setCatalogDraft((d) => ({
                                    ...d,
                                    autoshipFrequency: e.target.value,
                                  }))
                                }
                              >
                                <option value="monthly">Monthly</option>
                                <option value="quarterly">Quarterly</option>
                                <option value="every_6_months">Every 6 months</option>
                                <option value="yearly">Yearly</option>
                              </select>
                            ) : null}
                          </div>
                                <label
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    marginBottom: 12,
                                    cursor: 'pointer',
                                    fontSize: 14,
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={catalogDraft.passThroughByDefault}
                                    onChange={(e) =>
                                      setCatalogDraft((d) => ({
                                        ...d,
                                        passThroughByDefault: e.target.checked,
                                      }))
                                    }
                                  />
                                  Usually drop-shipped from another site (mail orders start as
                                  “Ordered on another site”)
                                </label>
                                <label className="settings-label" style={{ marginBottom: 12 }}>
                                  Store availability
                                  <select
                                    className="settings-input"
                                    value={catalogDraft.storeAvailability}
                                    onChange={(e) =>
                                      setCatalogDraft((d) => ({
                                        ...d,
                                        storeAvailability: e.target.value as StoreAvailabilityMode,
                                      }))
                                    }
                                  >
                                    <option value="always">Always available</option>
                                    <option value="out_of_stock">Out of stock</option>
                                    <option value="stock">Tied to mail order stock</option>
                                  </select>
                                </label>
                                {catalogDraft.storeAvailability === 'stock' ? (
                                  <>
                                    <p
                                      className="settings-muted"
                                      style={{ margin: '0 0 8px', fontSize: 13 }}
                                    >
                                      Uses on-hand at the online-store fulfillment location only,
                                      less anything on open mail orders that haven’t been filled
                                      yet.
                                    </p>
                                    {storeStock?.mode === 'stock' && storeStock.notYetCounted ? (
                                      <p style={{ margin: '0 0 8px', fontSize: 13 }}>
                                        <strong>
                                          {storeStock.locationName || 'Fulfillment location'}:
                                        </strong>{' '}
                                        not counted yet, so the store sells it as always available
                                        until its first count.
                                      </p>
                                    ) : storeStock?.mode === 'stock' ? (
                                      <p style={{ margin: '0 0 8px', fontSize: 13 }}>
                                        <strong>
                                          {storeStock.locationName || 'Fulfillment location'}:
                                        </strong>{' '}
                                        {storeStock.onHand ?? 0} on hand ·{' '}
                                        {storeStock.reserved ?? 0} on open orders
                                        {storeStock.buffer
                                          ? ` · ${storeStock.buffer} held back`
                                          : ''}{' '}
                                        ·{' '}
                                        <strong>
                                          {storeStock.status === 'available'
                                            ? `${storeStock.available} available online`
                                            : storeStock.status === 'backorder'
                                              ? 'showing as backordered'
                                              : 'showing as out of stock'}
                                        </strong>
                                      </p>
                                    ) : null}
                                    <label className="settings-label" style={{ marginBottom: 12 }}>
                                      Hold back (show out of stock at or below)
                                      <input
                                        type="number"
                                        min={0}
                                        step={1}
                                        className="settings-input"
                                        value={catalogDraft.storeStockBuffer}
                                        onChange={(e) =>
                                          setCatalogDraft((d) => ({
                                            ...d,
                                            storeStockBuffer: e.target.value,
                                          }))
                                        }
                                      />
                                    </label>
                                  </>
                                ) : null}
                                {catalogDraft.storeAvailability !== 'always' ? (
                                  <>
                                    <label className="settings-label" style={{ marginBottom: 12 }}>
                                      Expected back (optional, shown to clients)
                                      <input
                                        type="date"
                                        className="settings-input"
                                        value={catalogDraft.storeBackInStockDate}
                                        onChange={(e) =>
                                          setCatalogDraft((d) => ({
                                            ...d,
                                            storeBackInStockDate: e.target.value,
                                          }))
                                        }
                                      />
                                    </label>
                                    <label
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 8,
                                        marginBottom: 12,
                                        cursor: 'pointer',
                                        fontSize: 14,
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={catalogDraft.storeAllowBackorder}
                                        onChange={(e) =>
                                          setCatalogDraft((d) => ({
                                            ...d,
                                            storeAllowBackorder: e.target.checked,
                                          }))
                                        }
                                      />
                                      Allow backorders while out of stock
                                    </label>
                                  </>
                                ) : null}
                        </>
                      )}
                      {detail.itemType === 'inventory' && catalogDraft.showOnOnlineStore ? (
                        <label className="settings-label" style={{ marginBottom: 12 }}>
                          Online store price
                          <small style={{ display: 'block', color: '#6b7280', fontWeight: 400 }}>Leave blank to use the catalog price.</small>
                          <input
                            type="number"
                            step="0.01"
                            className="settings-input"
                            value={catalogDraft.onlineStorePrice}
                            onChange={(e) =>
                              setCatalogDraft((d) => ({ ...d, onlineStorePrice: e.target.value }))
                            }
                            placeholder={coreDraft.price.trim() || '0.00'}
                          />
                        </label>
                      ) : detail.itemType !== 'inventory' && catalogDraft.showOnOnlineStore ? (
                        <p className="settings-muted" style={{ fontSize: 13, marginBottom: 12 }}>
                          Shop price uses the catalog price ({coreDraft.price.trim() || 'not set'}).
                        </p>
                      ) : null}
                      <button
                        type="button"
                        className="btn primary"
                        style={{ marginTop: 14 }}
                        disabled={catalogSaving}
                        onClick={() => void saveOnlineStoreFields()}
                      >
                        {catalogSaving ? 'Saving…' : 'Save online store details'}
                      </button>
                    </>
                  ) : (
                    <p className="settings-muted" style={{ marginBottom: 0, fontSize: 13 }}>
                      Online store not implemented for this company.
                    </p>
                  )}
                </div>
              )}

              {detailTab === 'stock' && detail.itemType === 'inventory' && (
                <div style={{ marginBottom: 20 }}>
                  <h4 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>
                    Stock movements
                  </h4>
                  <p className="settings-muted" style={{ marginBottom: 12, fontSize: 13 }}>
                    Stock is received, moved and wasted from the Inventory pages.
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => navigate('/schedule/inventory/receive')}
                    >
                      Receive
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        navigate(
                          `/schedule/inventory/move?${new URLSearchParams({
                            item: String(selected.itemId),
                            name: detail.item.name ?? '',
                          })}`
                        )
                      }
                    >
                      Move this item
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => navigate('/schedule/inventory/waste')}
                    >
                      Waste / adjust
                    </button>
                  </div>

                  <p className="settings-muted" style={{ margin: 0 }}>
                    Past movements for every branch are on the{' '}
                    <button
                      type="button"
                      onClick={() => setDetailTab('history')}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        color: 'inherit',
                        textDecoration: 'underline',
                        cursor: 'pointer',
                        font: 'inherit',
                      }}
                    >
                      History
                    </button>{' '}
                    tab.
                  </p>
                </div>
              )}

              {detailTab === 'pricing' && (
                <>
                  {detail.itemType !== 'inventory' && (
                    <p className="settings-muted" style={{ marginBottom: 16 }}>
                      On-hand quantity applies to inventory items only. You can still override prices for
                      this {detail.itemType} by branch.
                    </p>
                  )}
                  <QuantityPriceBreaksEditor
                    itemType={detail.itemType}
                    itemId={selected.itemId}
                    practiceId={practiceId}
                    item={detail.item}
                    priceBreaks={detail.priceBreaks}
                    onChanged={async () => {
                      await refreshDetailBundle(selected);
                    }}
                  />
                </>
              )}
            </>
          )}
              </div>
            </div>
            {canEditItem && setupForId != null && setupForId === selected.itemId && detail && (() => {
              const steps = setupSteps();
              const index = Math.max(0, steps.indexOf(detailTab));
              const last = index === steps.length - 1;
              const storeIsNext = steps[index + 1] === 'online-store';
              return (
                <div className="inv-item-detail-modal__setup">
                  <div style={{ minWidth: 200, flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>
                      New {detail.itemType === 'inventory' ? 'product' : detail.itemType} setup ·
                      Step {index + 1} of {steps.length}: {SETUP_TAB_LABELS[steps[index]]}
                    </div>
                    <div className="settings-muted" style={{ fontSize: 13 }}>
                      {SETUP_TAB_HINTS[steps[index]]}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={setupBusy || index === 0}
                      onClick={() => void setupMove(-1)}
                    >
                      Back
                    </button>
                    {storeIsNext && (
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={setupBusy}
                        onClick={() => void setupMove(1, { finish: true })}
                      >
                        Save & finish without store
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn primary"
                      disabled={setupBusy}
                      onClick={() => void setupMove(1)}
                    >
                      {setupBusy
                        ? 'Saving…'
                        : last
                          ? 'Save & finish'
                          : storeIsNext
                            ? 'Save & set up online store'
                            : 'Next'}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {createOpen && (
        <div
          className="settings-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={addItemLabel(createType)}
          onClick={() => !createSaving && closeCreateModal()}
        >
          <div
            className="settings-modal settings-modal-wide"
            style={{ maxWidth: 720 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="settings-modal-header">
              <h3>{addItemLabel(createType)}</h3>
              <button
                type="button"
                className="settings-modal-close"
                disabled={createSaving}
                onClick={() => closeCreateModal()}
              >
                ×
              </button>
            </div>
            <div className="settings-modal-body">
              {createError && (
                <div className="settings-message settings-error-message" style={{ marginBottom: 12 }}>
                  {createError}
                </div>
              )}
              <div className="inv-type-filters" role="radiogroup" aria-label="New item type" style={{ marginBottom: 14 }}>
                {(['inventory', 'procedure', 'lab'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={createType === t}
                    className={`inv-type-filters__btn${createType === t ? ' inv-type-filters__btn--active' : ''}`}
                    onClick={() => setCreateType(t)}
                  >
                    {catalogTypeLabel(t)}
                  </button>
                ))}
              </div>

              <div className="inv-detail-tabs" style={{ marginBottom: 8 }}>
                {setupStepsFor(createType).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={`inv-detail-tab${tab === 'details' ? ' inv-detail-tab--active' : ''}`}
                    disabled={createSaving}
                    onClick={() => {
                      if (tab !== 'details') void submitCreateItem({ startTab: tab });
                    }}
                  >
                    {SETUP_TAB_LABELS[tab]}
                  </button>
                ))}
              </div>
              <p className="settings-muted" style={{ marginTop: 0, marginBottom: 14, fontSize: 13 }}>
                Step 1 of {setupStepsFor(createType).length}: Details. Next saves the item and
                continues to {SETUP_TAB_LABELS[setupStepsFor(createType)[1]]}; you can also jump to any tab.
              </p>

              <h4 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 10px' }}>Basics</h4>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                  gap: 10,
                  marginBottom: 14,
                }}
              >
                <label className="settings-label" style={{ gridColumn: '1 / -1' }}>
                  Name
                  <input
                    className="settings-input"
                    value={createForm.name}
                    onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                    autoFocus
                  />
                </label>
                <label className="settings-label">
                  Code
                  <input
                    className="settings-input"
                    value={createForm.code}
                    onChange={(e) => setCreateForm((f) => ({ ...f, code: e.target.value }))}
                  />
                </label>
                <label className="settings-label">
                  Price
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="settings-input"
                    value={createForm.price}
                    onChange={(e) => {
                      const price = e.target.value;
                      setCreateForm((f) => ({
                        ...f,
                        price,
                        markup: markupPctFromCostPrice(f.cost, price) || f.markup,
                      }));
                    }}
                  />
                </label>
                <label className="settings-label">
                  Cost
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="settings-input"
                    value={createForm.cost}
                    onChange={(e) => {
                      const cost = e.target.value;
                      setCreateForm((f) => ({
                        ...f,
                        cost,
                        markup: markupPctFromCostPrice(cost, f.price) || f.markup,
                      }));
                    }}
                  />
                </label>
                <label className="settings-label">
                  Markup % of cost
                  <input
                    type="number"
                    step="0.01"
                    className="settings-input"
                    value={createForm.markup}
                    onChange={(e) => {
                      const markup = e.target.value;
                      setCreateForm((f) => {
                        const price = priceFromCostMarkup(f.cost, markup);
                        return { ...f, markup, price: price !== '' ? price : f.price };
                      });
                    }}
                  />
                </label>
                <label className="settings-label">
                  Service fee
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="settings-input"
                    value={createForm.serviceFee}
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, serviceFee: e.target.value }))
                    }
                  />
                </label>
                <label className="settings-label">
                  Minimum price
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="settings-input"
                    value={createForm.minimumPrice}
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, minimumPrice: e.target.value }))
                    }
                  />
                </label>
                <CategorySelect
                  categories={categories}
                  label="Scout catalog category"
                  value={createForm.category}
                  onChange={(category) => setCreateForm((f) => ({ ...f, category }))}
                />
                <TaxLevelSelect
                  settings={taxSettings}
                  value={createForm.taxLevelValue}
                  onChange={(taxLevelValue) =>
                    setCreateForm((f) => ({ ...f, taxLevelValue }))
                  }
                />
              </div>
              <CatalogDiscountRulesFields
                value={createForm}
                onChange={(patch) => setCreateForm((f) => ({ ...f, ...patch }))}
              />

              {createType === 'inventory' && (
              <>
              <h4 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 6px' }}>
                Medication
              </h4>
              <div
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  padding: 12,
                  background: '#f8fafc',
                  marginBottom: 12,
                }}
              >
                <label className="settings-checkbox-item">
                  <input
                    type="checkbox"
                    checked={createForm.isMedication}
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, isMedication: e.target.checked }))
                    }
                  />
                  <span>Medication</span>
                </label>
                <p className="settings-muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
                  Opens Dose &amp; Rx on the SOAP and adds it to the patient’s prescription
                  history.
                </p>
              </div>
              {createForm.isMedication && (
                <label className="settings-label" style={{ marginBottom: 16 }}>
                  Default directions
                  <textarea
                    className="settings-input"
                    rows={2}
                    value={createForm.dispenseNote}
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, dispenseNote: e.target.value }))
                    }
                    placeholder="e.g. Give 1 tablet by mouth every 12 hours with food"
                    style={{
                      display: 'block',
                      width: '100%',
                      maxWidth: 'none',
                      marginTop: 6,
                      resize: 'vertical',
                    }}
                  />
                </label>
              )}

              <h4 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 10px' }}>
                Supply &amp; clinical flags
              </h4>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                {(
                  [
                    ['manufacturer', 'Manufacturer'],
                    ['vendorName', 'Vendor'],
                    ['vendorDrugNumber', 'Vendor drug #'],
                    ['barcode', 'Barcode'],
                    ['defaultQuantity', 'Default qty'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="settings-label">
                    {label}
                    <input
                      className="settings-input"
                      value={createForm[key]}
                      onChange={(e) =>
                        setCreateForm((f) => ({ ...f, [key]: e.target.value }))
                      }
                    />
                  </label>
                ))}
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: 6,
                  marginBottom: 12,
                }}
              >
                {(
                  [
                    ['isVaccine', 'Is vaccine'],
                    ['isControlled', 'Controlled'],
                    ['isMicrochip', 'Microchip'],
                    ['trackLots', 'Lots enabled'],
                    ['requireLotNumber', 'Require lot #'],
                    ['hasClientNotes', 'Has client notes'],
                    ['hideOnInvoice', 'Hide on invoice'],
                    ['hideOnMedicalRecordView', 'Hide on medical record view'],
                    ['hideOnMedicalRecordPrint', 'Hide on medical record print'],
                    ['excludeFromProduction', 'Exclude from production'],
                    ['changePatientSex', 'Change patient sex'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="settings-checkbox-item">
                    <input
                      type="checkbox"
                      checked={createForm[key]}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setCreateForm((f) => ({
                          ...f,
                          [key]: checked,
                              ...(key === 'isControlled' && checked
                                ? { trackLots: true, requireLotNumber: true }
                                : {}),
                          ...(key === 'isVaccine' && checked
                            ? {
                                trackLots: true,
                                requireLotNumber: true,
                                vaccineName: f.vaccineName || f.name,
                                vaccineManufacturer:
                                  f.vaccineManufacturer || f.manufacturer,
                              }
                            : {}),
                        }));
                      }}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              {createForm.hasClientNotes && (
                <label className="settings-label" style={{ marginBottom: 12 }}>
                  Default client note
                  <textarea
                    className="settings-input"
                    rows={2}
                    value={createForm.clientNote}
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, clientNote: e.target.value }))
                    }
                    placeholder="e.g. Care instructions for home"
                    style={{
                      display: 'block',
                      width: '100%',
                      maxWidth: 'none',
                      marginTop: 6,
                      resize: 'vertical',
                    }}
                  />
                </label>
              )}
              <label className="settings-label" style={{ maxWidth: 280, marginBottom: 16 }}>
                Change patient status to
                <select
                  className="settings-input"
                  value={createForm.changePatientStatusTo}
                  onChange={(e) =>
                    setCreateForm((f) => ({
                      ...f,
                      changePatientStatusTo: e.target.value,
                    }))
                  }
                >
                  <option value="">No change</option>
                  {createPatientStatuses.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                      {s.marksInactive ? ' (marks inactive)' : ''}
                    </option>
                  ))}
                </select>
              </label>

              {createForm.isVaccine && (
                <>
                  <h4 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 10px' }}>
                    Vaccine details
                  </h4>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                      gap: 10,
                      marginBottom: 12,
                    }}
                  >
                    <label className="settings-label" style={{ gridColumn: '1 / -1' }}>
                      Vaccine name
                      <input
                        className="settings-input"
                        value={createForm.vaccineName}
                        onChange={(e) =>
                          setCreateForm((f) => ({ ...f, vaccineName: e.target.value }))
                        }
                      />
                    </label>
                    <label className="settings-label">
                      Manufacturer
                      <input
                        className="settings-input"
                        value={createForm.vaccineManufacturer}
                        onChange={(e) =>
                          setCreateForm((f) => ({
                            ...f,
                            vaccineManufacturer: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="settings-label">
                      Vaccine type
                      <select
                        className="settings-input"
                        value={createForm.vaccineType}
                        onChange={(e) =>
                          setCreateForm((f) => ({ ...f, vaccineType: e.target.value }))
                        }
                      >
                        <option value="">—</option>
                        {VACCINE_TYPE_OPTIONS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="settings-label">
                      Dosage type
                      <select
                        className="settings-input"
                        value={createForm.dosageType}
                        onChange={(e) =>
                          setCreateForm((f) => ({ ...f, dosageType: e.target.value }))
                        }
                      >
                        <option value="">—</option>
                        <option value="initial">Initial</option>
                        <option value="booster">Booster</option>
                      </select>
                    </label>
                    <label className="settings-label">
                      USDA licensing (months)
                      <input
                        className="settings-input"
                        type="number"
                        min={0}
                        value={createForm.usdaLicensingMonths}
                        onChange={(e) =>
                          setCreateForm((f) => ({
                            ...f,
                            usdaLicensingMonths: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="settings-label">
                      Animal control licensing (months)
                      <input
                        className="settings-input"
                        type="number"
                        min={0}
                        value={createForm.animalControlLicensingMonths}
                        onChange={(e) =>
                          setCreateForm((f) => ({
                            ...f,
                            animalControlLicensingMonths: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="settings-label">
                      Tag issue period (months)
                      <input
                        className="settings-input"
                        type="number"
                        min={0}
                        value={createForm.tagIssuePeriodMonths}
                        onChange={(e) =>
                          setCreateForm((f) => ({
                            ...f,
                            tagIssuePeriodMonths: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <p className="settings-muted" style={{ gridColumn: '1 / -1', margin: 0, fontSize: 13 }}>
                      Serial number comes from the lot chosen when the vaccine is given.
                    </p>
                  </div>
                  <label className="settings-checkbox-item" style={{ marginBottom: 6 }}>
                    <input
                      type="checkbox"
                      checked={createForm.createRabiesCertificate}
                      onChange={(e) =>
                        setCreateForm((f) => ({
                          ...f,
                          createRabiesCertificate: e.target.checked,
                        }))
                      }
                    />
                    <span>Create rabies certificate</span>
                  </label>
                </>
              )}
              </>
              )}
            </div>
            <div
              className="settings-modal-actions"
              style={{ marginTop: 0, padding: '14px 20px 18px', justifyContent: 'flex-end' }}
            >
              <button
                type="button"
                className="btn secondary"
                disabled={createSaving}
                onClick={() => closeCreateModal()}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={createSaving}
                onClick={() => void submitCreateItem()}
              >
                {createSaving ? 'Saving…' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      )}

      {priceModalOpen && detail && selected && (
        <div
          role="dialog"
          aria-modal="true"
          className="settings-modal-overlay"
          onClick={() => !priceSaving && setPriceModalOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10100,
            padding: 16,
          }}
        >
          <div
            className="settings-card"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(520px, 100%)', padding: 24, maxHeight: '90vh', overflow: 'auto' }}
          >
            <h3 className="settings-card-title">Branch price override</h3>
            <p className="settings-muted" style={{ marginBottom: 16 }}>
              Set the values below, then choose which branches get them. Clear overrides puts the
              checked branches back on the practice prices from Details.
            </p>
            {priceError && (
              <div className="settings-message settings-error-message" style={{ marginBottom: 12 }}>
                {priceError}
              </div>
            )}
            {branches.length > 0 && (
              <label className="settings-label" style={{ display: 'block', marginBottom: 14 }}>
                Copy from branch
                <select
                  className="settings-input"
                  disabled={priceSaving}
                  value=""
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    if (!Number.isFinite(id)) return;
                    const m = branchEffectiveById[id];
                    if (!m) return;
                    setPriceForm(effectiveToResolved(m));
                    setPriceMarkup(seedMarkupFor(branchOverrideById[id]));
                  }}
                >
                  <option value="" disabled>
                    Choose a branch to fill the fields…
                  </option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <span className="settings-muted" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
                  Fills Price, Cost, Markup, Service fee, and Minimum from that branch. Nothing is
                  saved until you click Save. For Online store, only Price is written as the web
                  base.
                </span>
              </label>
            )}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
              <label className="settings-label" style={{ flex: '1 1 100px', marginBottom: 4 }}>
                Cost
                <input
                  type="number"
                  className="settings-input"
                  step="0.01"
                  value={priceForm.cost ?? ''}
                  onChange={(e) => {
                    const v = e.target.value === '' ? 0 : Number(e.target.value);
                    const cost = Number.isFinite(v) ? v : 0;
                    const fromMarkup = priceFromCostMarkup(String(cost), priceMarkup);
                    setPriceForm((f) => ({
                      ...f,
                      cost,
                      ...(fromMarkup !== '' && cost > 0 ? { price: Number(fromMarkup) } : {}),
                    }));
                  }}
                />
              </label>
              <span style={{ paddingBottom: 14 }}>×</span>
              <label className="settings-label" style={{ flex: '1 1 120px', marginBottom: 4 }}>
                Markup % of cost
                <input
                  type="number"
                  className="settings-input"
                  step="1"
                  placeholder="Fixed price"
                  value={priceMarkup}
                  onChange={(e) => {
                    const next = e.target.value;
                    setPriceMarkup(next);
                    const fromMarkup = priceFromCostMarkup(String(priceForm.cost), next);
                    if (fromMarkup !== '' && priceForm.cost > 0) {
                      setPriceForm((f) => ({ ...f, price: Number(fromMarkup) }));
                    }
                  }}
                />
              </label>
              <span style={{ paddingBottom: 14 }}>=</span>
              <label className="settings-label" style={{ flex: '1 1 100px', marginBottom: 4 }}>
                Price
                <input
                  type="number"
                  className="settings-input"
                  step="0.01"
                  value={priceForm.price ?? ''}
                  onChange={(e) => {
                    const v = e.target.value === '' ? 0 : Number(e.target.value);
                    setPriceForm((f) => ({ ...f, price: Number.isFinite(v) ? v : 0 }));
                    setPriceMarkup('');
                  }}
                />
              </label>
            </div>
            <p className="settings-muted" style={{ fontSize: 12, margin: '0 0 12px' }}>
              {optionalNumber(priceMarkup) != null && priceForm.cost > 0
                ? `Price follows cost: $${priceForm.cost.toFixed(2)} × ${Number(priceMarkup)}% = $${priceForm.price.toFixed(2)}. When cost changes, this branch's price changes with it.`
                : 'Fixed price for this branch. Typing a price clears the markup; enter a markup to have the price follow cost.'}
              {practiceMarkup != null && ` Practice markup is ${practiceMarkup}%.`}
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(['serviceFee', 'minimumPrice'] as const).map((key) => (
                <label key={key} className="settings-label" style={{ flex: '1 1 140px', marginBottom: 12 }}>
                  {key === 'serviceFee' ? 'Service fee' : 'Minimum price'}
                  <input
                    type="number"
                    className="settings-input"
                    step="0.01"
                    value={priceForm[key] ?? ''}
                    onChange={(e) => {
                      const v = e.target.value === '' ? 0 : Number(e.target.value);
                      setPriceForm((f) => ({ ...f, [key]: Number.isFinite(v) ? v : 0 }));
                    }}
                  />
                </label>
              ))}
            </div>
            <p className="settings-muted" style={{ fontSize: 12, margin: '0 0 12px' }}>
              Anything left the same as Details keeps following Details.
            </p>

            <div style={{ marginTop: 8, marginBottom: 12 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <strong style={{ fontSize: 14 }}>Apply to</strong>
                <span style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn secondary"
                    style={{ padding: '2px 8px', fontSize: 12 }}
                    disabled={priceSaving}
                    onClick={() => {
                      const ids = branches.map((b) => b.id);
                      if (onlineStoreImplemented && detail.itemType === 'inventory') {
                        ids.push(ONLINE_STORE_TARGET_ID);
                      }
                      setPriceTargetBranchIds(ids);
                    }}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    style={{ padding: '2px 8px', fontSize: 12 }}
                    disabled={priceSaving || branchId == null}
                    onClick={() => setPriceTargetBranchIds(branchId != null ? [branchId] : [])}
                  >
                    Only this branch
                  </button>
                </span>
              </div>
              <div
                style={{
                  border: '1px solid rgba(0,0,0,0.1)',
                  borderRadius: 8,
                  padding: '8px 12px',
                  maxHeight: 180,
                  overflow: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                {branches.map((b) => {
                  const checked = priceTargetBranchIds.includes(b.id);
                  return (
                    <label
                      key={b.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 14,
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={priceSaving}
                        onChange={() => {
                          setPriceTargetBranchIds((prev) =>
                            checked ? prev.filter((id) => id !== b.id) : [...prev, b.id]
                          );
                        }}
                      />
                      {b.name}
                    </label>
                  );
                })}
                {onlineStoreImplemented && detail.itemType === 'inventory' && (
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      fontSize: 14,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={priceTargetBranchIds.includes(ONLINE_STORE_TARGET_ID)}
                      disabled={priceSaving}
                      onChange={() => {
                        setPriceTargetBranchIds((prev) =>
                          prev.includes(ONLINE_STORE_TARGET_ID)
                            ? prev.filter((id) => id !== ONLINE_STORE_TARGET_ID)
                            : [...prev, ONLINE_STORE_TARGET_ID]
                        );
                      }}
                      style={{ marginTop: 3 }}
                    />
                    <span>
                      Online store
                      <span className="settings-muted" style={{ display: 'block', fontSize: 12 }}>
                        Saves Price as the web base; listed total uses the same formula as SOAP and
                        checkout, with the practice catalog fee/min.
                        {` → $${unitSellTotal(detail.itemType, {
                          price: priceForm.price,
                          serviceFee: practiceMoney?.serviceFee ?? priceForm.serviceFee,
                          minimumPrice: practiceMoney?.minimumPrice ?? priceForm.minimumPrice,
                        }).toFixed(2)}`}
                      </span>
                    </span>
                  </label>
                )}
                {!branches.length && (
                  <span className="settings-muted" style={{ fontSize: 13 }}>
                    No branches loaded.
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
              <button
                type="button"
                className="btn primary"
                disabled={priceSaving}
                onClick={() => void saveBranchPrices()}
              >
                {priceSaving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={
                  priceSaving ||
                  priceTargetBranchIds.filter((id) => id !== ONLINE_STORE_TARGET_ID).length === 0
                }
                onClick={() => void resetBranchPrices()}
              >
                Clear overrides
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={priceSaving}
                onClick={() => setPriceModalOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="settings-modal-overlay"
          onClick={() => !bulkSaving && setBulkModalOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10100,
            padding: 16,
          }}
        >
          <div
            className="settings-card"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(480px, 100%)', padding: 24 }}
          >
            <h3 className="settings-card-title">Bulk price adjustment</h3>
            <p className="settings-muted" style={{ marginBottom: 12 }}>
              Applies to {Object.keys(bulkSelected).length} inventory catalog item(s). Positive
              numbers raise prices and negative numbers lower them (<code>-10</code> = 10% off).
              Flat amounts are added to the current price, not used in place of it. Practice price
              changes also apply to any branch-specific prices. Items with no online store price are
              skipped for online changes. Leave a field blank to skip it.
            </p>
            {bulkError && (
              <div className="settings-message settings-error-message" style={{ marginBottom: 12 }}>
                {bulkError}
              </div>
            )}
            <label className="settings-label" style={{ display: 'block', marginBottom: 10 }}>
              % change — practice list / in-clinic price
              <input
                type="number"
                step="0.1"
                className="settings-input"
                value={bulkPctPractice}
                onChange={(e) => setBulkPctPractice(e.target.value)}
                placeholder="e.g. 5"
              />
            </label>
            <label className="settings-label" style={{ display: 'block', marginBottom: 10 }}>
              % change — online store price
              <input
                type="number"
                step="0.1"
                className="settings-input"
                value={bulkPctOnline}
                onChange={(e) => setBulkPctOnline(e.target.value)}
                placeholder="e.g. 3"
              />
            </label>
            <label className="settings-label" style={{ display: 'block', marginBottom: 10 }}>
              Flat add ($) — practice list price
              <input
                type="number"
                step="0.01"
                className="settings-input"
                value={bulkFlatPractice}
                onChange={(e) => setBulkFlatPractice(e.target.value)}
                placeholder="e.g. 2.50"
              />
            </label>
            <label className="settings-label" style={{ display: 'block', marginBottom: 10 }}>
              Flat add ($) — online store price
              <input
                type="number"
                step="0.01"
                className="settings-input"
                value={bulkFlatOnline}
                onChange={(e) => setBulkFlatOnline(e.target.value)}
              />
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
              <button
                type="button"
                className="btn primary"
                disabled={bulkSaving}
                onClick={() => void submitBulkPriceAdjust()}
              >
                {bulkSaving ? 'Applying…' : 'Apply to selected'}
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={bulkSaving}
                onClick={() => setBulkModalOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
