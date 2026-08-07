import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/useAuth';
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
  getInventoryCostSummary,
  patchPracticeInventoryItem,
  postBulkInventoryPriceAdjust,
  uploadInventoryItemImage,
  deleteInventoryItemImage,
  inventoryItemImageUrl,
  type InventoryCostSummary,
} from '../api/inventoryTools';
import {
  listPracticeBranches,
  listInventoryBranchLocations,
  getInventoryBranchStock,
  upsertInventoryBranchStock,
  postInventoryMovement,
  listInventoryMovements,
  upsertBranchPriceOverride,
  postEffectiveBranchPrice,
  type PracticeBranch,
  type BranchPriceOverrideEntityType,
  type MoneyFields,
  type InventoryBranchStock,
  type InventoryBranchLocation,
  type InventoryMovementType,
  type InventoryStockMovement,
  type PostInventoryMovementBody,
} from '../api/branchInventory';
import {
  getPracticeSettings,
  isOnlineStoreImplemented,
} from '../api/practiceSettings';
import { getPreDiscountForOneUnit } from '../utils/catalogItemPricing';
import { Pencil, Copy, X, ChevronDown, ChevronRight } from 'lucide-react';
import './Settings.css';
import './InventoryManagement.css';

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
  return Number(import.meta.env.VITE_PRACTICE_ID) || 1;
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

function catalogDescription(row: SearchResultItem): string {
  return pickStr((catalogEntity(row) as Record<string, unknown> | null)?.description) ?? '—';
}

function catalogSellUnit(row: SearchResultItem): string {
  if (row.itemType !== 'inventory' || !row.inventoryItem) return 'each';
  const u = pickStr(row.inventoryItem.sellUnitType);
  return u ?? 'each';
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
  const pct = ((price - cost) / cost) * 100;
  return `${pct.toFixed(1)}%`;
}

const MOVEMENT_TYPES: { value: InventoryMovementType; label: string }[] = [
  { value: 'receive', label: 'Receive (into location)' },
  { value: 'transfer', label: 'Transfer (between locations)' },
  { value: 'sold', label: 'Sold (out)' },
  { value: 'visit_use', label: 'Visit use (out)' },
  { value: 'adjustment_increase', label: 'Adjustment increase' },
  { value: 'adjustment_decrease', label: 'Adjustment decrease / expired / disposal' },
];

const SELL_UNIT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '(not set)' },
  { value: 'capsule', label: 'Capsule' },
  { value: 'tablet', label: 'Tablet' },
  { value: 'bottle', label: 'Bottle' },
  { value: 'package', label: 'Package' },
  { value: 'ml', label: 'mL' },
  { value: 'gram', label: 'Gram' },
  { value: 'each', label: 'Each' },
  { value: 'other', label: 'Other (describe below)' },
];

function movementNeedsFrom(t: InventoryMovementType): boolean {
  return ['transfer', 'sold', 'visit_use', 'adjustment_decrease'].includes(t);
}

function movementNeedsTo(t: InventoryMovementType): boolean {
  return ['transfer', 'receive', 'adjustment_increase'].includes(t);
}

function locationLabel(loc: InventoryBranchLocation): string {
  return `${loc.name} (${loc.code})`;
}

export default function InventoryManagement() {
  const { token, doctorId } = useAuth() as { token: string | null; doctorId: string | null };
  const practiceId = useMemo(() => resolvePracticeId(token), [token]);

  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [branchId, setBranchId] = useState<number | null>(null);
  const [branchesError, setBranchesError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);

  const [selected, setSelected] = useState<{
    itemType: ItemType;
    itemId: number;
    label: string;
  } | null>(null);

  const [detail, setDetail] = useState<ItemWithPriceBreaks | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [stockByBranchId, setStockByBranchId] = useState<Record<number, InventoryBranchStock>>({});
  /** Item the counts / reorder / movements apply to: the linked stock item, else this item. */
  const [stockItemId, setStockItemId] = useState<number | null>(null);
  const [countsExpandedBranchId, setCountsExpandedBranchId] = useState<number | null>(null);
  const [reorderDraftByBranchId, setReorderDraftByBranchId] = useState<Record<number, string>>({});
  const [stockLoading, setStockLoading] = useState(false);
  const [stockSaving, setStockSaving] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);

  /** Page-level locations (unbox / cost summary branch). */
  const [branchLocations, setBranchLocations] = useState<InventoryBranchLocation[]>([]);

  /** Branch used inside the item modal for record movement + history. */
  const [movementBranchId, setMovementBranchId] = useState<number | null>(null);
  const [movementLocations, setMovementLocations] = useState<InventoryBranchLocation[]>([]);

  const [movementType, setMovementType] = useState<InventoryMovementType>('receive');
  const [movementQty, setMovementQty] = useState('1');
  const [movementFromId, setMovementFromId] = useState('');
  const [movementToId, setMovementToId] = useState('');
  const [movementNote, setMovementNote] = useState('');
  const [movementEmployeeId, setMovementEmployeeId] = useState('');
  const [movementSubmitting, setMovementSubmitting] = useState(false);
  const [movementError, setMovementError] = useState<string | null>(null);

  const [movements, setMovements] = useState<InventoryStockMovement[]>([]);
  const [movementTotal, setMovementTotal] = useState(0);
  const [movementsLoading, setMovementsLoading] = useState(false);

  const [effective, setEffective] = useState<MoneyFields | null>(null);
  /** Effective money for every active practice branch (item pricing table). */
  const [branchEffectiveById, setBranchEffectiveById] = useState<Record<number, MoneyFields>>({});
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

  const [costSummary, setCostSummary] = useState<InventoryCostSummary | null>(null);
  const [costSummaryLoading, setCostSummaryLoading] = useState(false);
  const [costSummaryError, setCostSummaryError] = useState<string | null>(null);

  const [bulkSelectMode, setBulkSelectMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Record<number, string>>({});
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkPctPractice, setBulkPctPractice] = useState('');
  const [bulkPctOnline, setBulkPctOnline] = useState('');
  const [bulkFlatPractice, setBulkFlatPractice] = useState('');
  const [bulkFlatOnline, setBulkFlatOnline] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const [catalogSaving, setCatalogSaving] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [unitsSaving, setUnitsSaving] = useState(false);
  const [unitsError, setUnitsError] = useState<string | null>(null);
  const [catalogDraft, setCatalogDraft] = useState({
    description: '',
    shippable: false,
    showOnOnlineStore: false,
    onlineStorePrice: '',
    sellUnitType: '',
    sellUnitTypeDetail: '',
    unitsPerPackage: '',
    alternateSellUnitType: '',
    alternateUnitsPerPackage: '',
  });
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

  const [unboxVendor, setUnboxVendor] = useState('');
  const [unboxInvoice, setUnboxInvoice] = useState('');
  const [unboxLot, setUnboxLot] = useState('');
  const [unboxExp, setUnboxExp] = useState('');
  const [unboxUnpackedAt, setUnboxUnpackedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [unboxUnpackedBy, setUnboxUnpackedBy] = useState('');
  const [unboxQty, setUnboxQty] = useState('1');
  const [unboxItemQuery, setUnboxItemQuery] = useState('');
  const [unboxItemResults, setUnboxItemResults] = useState<SearchResultItem[]>([]);
  const [unboxSearching, setUnboxSearching] = useState(false);
  const [unboxSelectedItem, setUnboxSelectedItem] = useState<{ id: number; name: string } | null>(null);
  const [unboxToLocId, setUnboxToLocId] = useState('');
  const [unboxSubmitting, setUnboxSubmitting] = useState(false);
  const [unboxError, setUnboxError] = useState<string | null>(null);
  const unboxSearchSeq = useRef(0);

  const reloadMovements = useCallback(async () => {
    if (
      !selected ||
      selected.itemType !== 'inventory' ||
      movementBranchId == null ||
      stockItemId == null
    ) {
      setMovements([]);
      setMovementTotal(0);
      return;
    }
    setMovementsLoading(true);
    try {
      const r = await listInventoryMovements(practiceId, movementBranchId, {
        inventoryItemId: stockItemId,
        limit: 50,
        offset: 0,
      });
      setMovements(r.rows);
      setMovementTotal(r.total);
    } catch {
      setMovements([]);
      setMovementTotal(0);
    } finally {
      setMovementsLoading(false);
    }
  }, [selected, movementBranchId, practiceId, stockItemId]);

  const persistBranch = useCallback(
    (id: number) => {
      try {
        localStorage.setItem(`${BRANCH_STORAGE_PREFIX}${practiceId}`, String(id));
      } catch {
        /* ignore */
      }
    },
    [practiceId]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBranchesError(null);
      try {
        const [list, settings] = await Promise.all([
          listPracticeBranches(practiceId),
          getPracticeSettings(practiceId).catch(() => ({})),
        ]);
        if (cancelled) return;
        setOnlineStoreImplemented(isOnlineStoreImplemented(settings));
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
      } catch (e: unknown) {
        if (!cancelled) {
          setBranchesError(e instanceof Error ? e.message : 'Failed to load branches');
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
    if (branchId == null) {
      setBranchLocations([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await listInventoryBranchLocations(practiceId, branchId);
        if (!cancelled) setBranchLocations(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setBranchLocations([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [practiceId, branchId]);

  useEffect(() => {
    if (branchId == null) {
      setCostSummary(null);
      setCostSummaryError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setCostSummaryLoading(true);
      setCostSummaryError(null);
      try {
        const s = await getInventoryCostSummary(practiceId, branchId);
        if (!cancelled) setCostSummary(s);
      } catch (e: unknown) {
        if (!cancelled) {
          setCostSummary(null);
          setCostSummaryError(
            e instanceof Error
              ? e.message
              : 'Could not load branch cost summary (backend may not expose this endpoint yet).'
          );
        }
      } finally {
        if (!cancelled) setCostSummaryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [practiceId, branchId]);

  useEffect(() => {
    if (!detail || detail.itemType !== 'inventory') return;
    const item = detail.item as InventoryItem;
    const raw = item.showOnOnlineStore as unknown;
    const shipRaw = item.shippable as unknown;
    setCatalogDraft({
      description: item.description != null ? String(item.description) : '',
      shippable: shipRaw === true || shipRaw === 'true' || shipRaw === 1 || shipRaw === '1',
      showOnOnlineStore: raw === true || raw === 'true' || raw === 1 || raw === '1',
      onlineStorePrice:
        item.onlineStorePrice != null && String(item.onlineStorePrice).trim() !== ''
          ? String(item.onlineStorePrice)
          : '',
      sellUnitType: (item.sellUnitType as string) || '',
      sellUnitTypeDetail: (item.sellUnitTypeDetail as string) || '',
      unitsPerPackage:
        item.unitsPerPackage != null && String(item.unitsPerPackage).trim() !== ''
          ? String(item.unitsPerPackage)
          : '',
      alternateSellUnitType: (item.alternateSellUnitType as string) || '',
      alternateUnitsPerPackage:
        item.alternateUnitsPerPackage != null && String(item.alternateUnitsPerPackage).trim() !== ''
          ? String(item.alternateUnitsPerPackage)
          : '',
    });
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
        const rows = await searchItems(q, practiceId, 25);
        if (stockLinkSearchSeq.current !== seq) return;
        setStockLinkResults(
          rows.filter(
            (r) => r.itemType === 'inventory' && r.inventoryItem?.id !== selected?.itemId
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

  useEffect(() => {
    if (movementBranchId == null) {
      setMovementLocations([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await listInventoryBranchLocations(practiceId, movementBranchId);
        if (!cancelled) setMovementLocations(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setMovementLocations([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [practiceId, movementBranchId]);

  useEffect(() => {
    const q = unboxItemQuery.trim();
    if (!q) {
      setUnboxItemResults([]);
      return;
    }
    const seq = ++unboxSearchSeq.current;
    const t = window.setTimeout(async () => {
      setUnboxSearching(true);
      try {
        const rows = await searchItems(q, practiceId, 40);
        if (unboxSearchSeq.current !== seq) return;
        setUnboxItemResults(rows.filter((r) => r.itemType === 'inventory'));
      } catch {
        if (unboxSearchSeq.current === seq) setUnboxItemResults([]);
      } finally {
        if (unboxSearchSeq.current === seq) setUnboxSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [unboxItemQuery, practiceId]);

  useEffect(() => {
    if (!movementLocations.length) {
      setMovementFromId('');
      setMovementToId('');
      return;
    }
    const def = movementLocations.find((l) => l.code === 'main') ?? movementLocations[0];
    setMovementFromId(String(def.id));
    setMovementToId(String(def.id));
  }, [movementBranchId, movementLocations]);

  useEffect(() => {
    if (!branchLocations.length) {
      setUnboxToLocId('');
      return;
    }
    const def = branchLocations.find((l) => l.code === 'main') ?? branchLocations[0];
    setUnboxToLocId((prev) =>
      prev && branchLocations.some((l) => String(l.id) === prev) ? prev : String(def.id)
    );
  }, [branchId, branchLocations]);

  useEffect(() => {
    void reloadMovements();
  }, [reloadMovements]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    const seq = ++searchSeq.current;
    const t = window.setTimeout(async () => {
      setSearching(true);
      try {
        const rows = await searchItems(q, practiceId, 50);
        if (searchSeq.current !== seq) return;
        setSearchResults(rows);
      } catch {
        if (searchSeq.current === seq) setSearchResults([]);
      } finally {
        if (searchSeq.current === seq) setSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchQuery, practiceId]);

  const refreshDetailBundle = useCallback(
    async (sel: { itemType: ItemType; itemId: number }) => {
      setDetailLoading(true);
      setDetailError(null);
      setStockError(null);
      setBranchPricesError(null);
      try {
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
              return { id: b.id, effective: eff.effective as MoneyFields, ok: true as const };
            } catch {
              return { id: b.id, effective: null, ok: false as const };
            }
          })
        );
        const map: Record<number, MoneyFields> = {};
        let failCount = 0;
        for (const row of settled) {
          if (row.ok && row.effective) map[row.id] = row.effective;
          else failCount += 1;
        }
        setBranchEffectiveById(map);
        if (failCount > 0 && Object.keys(map).length === 0) {
          setBranchPricesError('Could not load branch prices.');
        } else if (failCount > 0) {
          setBranchPricesError(`Could not load prices for ${failCount} branch${failCount === 1 ? '' : 'es'}.`);
        }
        setBranchPricesLoading(false);

        if (item.itemType === 'inventory') {
          setStockLoading(true);
          // Counts belong to the stock item, so a code that draws from a master shows the
          // master's on-hand rather than a confusing zero of its own.
          const rawLink = (item.item as InventoryItem).linkedInventoryItemId;
          const countedItemId =
            rawLink != null && Number.isFinite(Number(rawLink)) ? Number(rawLink) : sel.itemId;
          setStockItemId(countedItemId);
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
            for (const row of stockSettled) {
              if (row.ok && row.stock) {
                stockMap[row.id] = row.stock;
                reorderMap[row.id] =
                  row.stock.reorderPoint == null || Number.isNaN(Number(row.stock.reorderPoint))
                    ? ''
                    : String(row.stock.reorderPoint);
              }
            }
            setStockByBranchId(stockMap);
            setReorderDraftByBranchId(reorderMap);
          } catch {
            setStockByBranchId({});
            setReorderDraftByBranchId({});
          } finally {
            setStockLoading(false);
          }
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
    [practiceId, branches]
  );

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setEffective(null);
      setBranchEffectiveById({});
      setStockByBranchId({});
      setCountsExpandedBranchId(null);
      setMovementBranchId(null);
      return;
    }
    setCountsExpandedBranchId(null);
    void refreshDetailBundle(selected);
  }, [selected, refreshDetailBundle]);

  useEffect(() => {
    if (!selected) return;
    setMovementBranchId((prev) => {
      if (prev != null && branches.some((b) => b.id === prev)) return prev;
      if (branchId != null && branches.some((b) => b.id === branchId)) return branchId;
      return branches[0]?.id ?? null;
    });
  }, [selected, branches, branchId]);

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
      setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, priceModalOpen, bulkModalOpen]);

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
    if (opts?.onlineStoreOnly) {
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
        price: priceForm.price,
        cost: priceForm.cost,
        serviceFee: priceForm.serviceFee,
        minimumPrice: priceForm.minimumPrice,
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

  async function saveReorderPoint(forBranchId: number) {
    if (!selected || selected.itemType !== 'inventory' || stockItemId == null) return;
    setStockSaving(true);
    setStockError(null);
    try {
      const draft = reorderDraftByBranchId[forBranchId] ?? '';
      const reorderPoint = draft.trim() === '' ? null : Number(draft.trim());
      if (draft.trim() !== '' && !Number.isFinite(reorderPoint as number)) {
        setStockError('Reorder point must be a number');
        return;
      }
      const updated = await upsertInventoryBranchStock(
        practiceId,
        forBranchId,
        stockItemId,
        { reorderPoint }
      );
      setStockByBranchId((prev) => ({ ...prev, [forBranchId]: updated }));
      setReorderDraftByBranchId((prev) => ({
        ...prev,
        [forBranchId]:
          updated.reorderPoint == null || Number.isNaN(Number(updated.reorderPoint))
            ? ''
            : String(updated.reorderPoint),
      }));
      setToast('Reorder point saved');
      window.setTimeout(() => setToast(null), 3500);
    } catch (e: unknown) {
      setStockError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setStockSaving(false);
    }
  }

  async function submitMovement() {
    if (
      !selected ||
      movementBranchId == null ||
      selected.itemType !== 'inventory' ||
      stockItemId == null
    ) {
      return;
    }
    setMovementSubmitting(true);
    setMovementError(null);
    try {
      const qty = Number(movementQty);
      if (!Number.isFinite(qty) || qty <= 0) {
        setMovementError('Quantity must be a positive number');
        return;
      }
      const fromId = movementFromId ? Number(movementFromId) : NaN;
      const toId = movementToId ? Number(movementToId) : NaN;
      if (movementNeedsFrom(movementType) && !Number.isFinite(fromId)) {
        setMovementError('Choose a source location');
        return;
      }
      if (movementNeedsTo(movementType) && !Number.isFinite(toId)) {
        setMovementError('Choose a destination location');
        return;
      }
      if (movementType === 'transfer' && fromId === toId) {
        setMovementError('Transfer requires two different locations');
        return;
      }
      const body: PostInventoryMovementBody = {
        movementType,
        inventoryItemId: stockItemId,
        quantity: qty,
      };
      if (movementNeedsFrom(movementType)) body.fromBranchLocationId = fromId;
      if (movementNeedsTo(movementType)) body.toBranchLocationId = toId;
      const n = movementNote.trim();
      if (n) body.note = n;
      const emp = movementEmployeeId.trim();
      if (emp) {
        const eid = Number(emp);
        if (!Number.isFinite(eid)) {
          setMovementError('Employee ID must be a number');
          return;
        }
        body.movedByEmployeeId = eid;
      }
      await postInventoryMovement(practiceId, movementBranchId, body);
      setToast('Movement recorded');
      window.setTimeout(() => setToast(null), 3500);
      setMovementNote('');
      await refreshDetailBundle(selected);
      await reloadMovements();
    } catch (e: unknown) {
      setMovementError(e instanceof Error ? e.message : 'Movement failed');
    } finally {
      setMovementSubmitting(false);
    }
  }

  async function loadMoreMovements() {
    if (
      !selected ||
      selected.itemType !== 'inventory' ||
      movementBranchId == null ||
      stockItemId == null
    ) {
      return;
    }
    if (movements.length >= movementTotal) return;
    setMovementsLoading(true);
    try {
      const r = await listInventoryMovements(practiceId, movementBranchId, {
        inventoryItemId: stockItemId,
        limit: 50,
        offset: movements.length,
      });
      setMovements((prev) => [...prev, ...r.rows]);
      setMovementTotal(r.total);
    } catch {
      /* keep existing */
    } finally {
      setMovementsLoading(false);
    }
  }

  async function saveUnitFields() {
    if (!selected || selected.itemType !== 'inventory') return;
    setUnitsSaving(true);
    setUnitsError(null);
    try {
      await patchPracticeInventoryItem(practiceId, selected.itemId, {
        sellUnitType: catalogDraft.sellUnitType || null,
        sellUnitTypeDetail: catalogDraft.sellUnitTypeDetail.trim() || null,
        unitsPerPackage:
          catalogDraft.unitsPerPackage.trim() === '' ? null : Number(catalogDraft.unitsPerPackage),
        alternateSellUnitType: catalogDraft.alternateSellUnitType || null,
        alternateUnitsPerPackage:
          catalogDraft.alternateUnitsPerPackage.trim() === ''
            ? null
            : Number(catalogDraft.alternateUnitsPerPackage),
      });
      setToast('Sell / dispense units saved');
      window.setTimeout(() => setToast(null), 3500);
      await refreshDetailBundle(selected);
    } catch (e: unknown) {
      setUnitsError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setUnitsSaving(false);
    }
  }

  async function saveStockLink() {
    if (!selected || selected.itemType !== 'inventory') return;
    setStockLinkSaving(true);
    setStockLinkError(null);
    try {
      const qty = stockLinkQty.trim() === '' ? null : Number(stockLinkQty);
      if (stockLinkItemId != null && (qty == null || !Number.isFinite(qty) || qty <= 0)) {
        setStockLinkError('Enter how many stock units one sale consumes (e.g. 100).');
        return;
      }
      await patchPracticeInventoryItem(practiceId, selected.itemId, {
        linkedInventoryItemId: stockLinkItemId,
        linkedInventoryItemDefaultQuantity: stockLinkItemId == null ? null : qty,
      });
      setToast(stockLinkItemId == null ? 'Stock link cleared' : 'Stock item saved');
      window.setTimeout(() => setToast(null), 3500);
      await refreshDetailBundle(selected);
    } catch (e: unknown) {
      setStockLinkError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setStockLinkSaving(false);
    }
  }

  async function saveOnlineStoreFields() {
    if (!selected || selected.itemType !== 'inventory') return;
    setCatalogSaving(true);
    setCatalogError(null);
    try {
      await patchPracticeInventoryItem(practiceId, selected.itemId, {
        description: catalogDraft.description.trim() || null,
        shippable: catalogDraft.shippable,
        showOnOnlineStore: catalogDraft.showOnOnlineStore,
        onlineStorePrice:
          catalogDraft.onlineStorePrice.trim() === ''
            ? null
            : Number(catalogDraft.onlineStorePrice),
      });
      setToast('Online store details saved');
      window.setTimeout(() => setToast(null), 3500);
      await refreshDetailBundle(selected);
    } catch (e: unknown) {
      setCatalogError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setCatalogSaving(false);
    }
  }

  async function onInventoryImageSelected(file: File | null) {
    if (!file || !selected || selected.itemType !== 'inventory') return;
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
      await postBulkInventoryPriceAdjust(practiceId, {
        inventoryItemIds: ids,
        percentChangePracticePrice: hasPctP ? pctP : undefined,
        percentChangeOnlineStorePrice: hasPctO ? pctO : undefined,
        flatAddPracticePrice: hasFP ? fP : undefined,
        flatAddOnlineStorePrice: hasFO ? fO : undefined,
      });
      setToast('Bulk price adjustment applied');
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

  async function submitUnboxReceive() {
    if (branchId == null || !unboxSelectedItem) {
      setUnboxError('Choose a branch, inventory item, and receiving location.');
      return;
    }
    const toId = Number(unboxToLocId);
    if (!Number.isFinite(toId)) {
      setUnboxError('Choose destination location');
      return;
    }
    const qty = Number(unboxQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      setUnboxError('Quantity must be a positive number');
      return;
    }
    setUnboxSubmitting(true);
    setUnboxError(null);
    const refreshedItemId = unboxSelectedItem.id;
    try {
      const metaBits: string[] = [];
      if (unboxVendor.trim()) metaBits.push(`Vendor: ${unboxVendor.trim()}`);
      if (unboxInvoice.trim()) metaBits.push(`Invoice: ${unboxInvoice.trim()}`);
      if (unboxLot.trim()) metaBits.push(`Lot: ${unboxLot.trim()}`);
      if (unboxExp.trim()) metaBits.push(`Exp: ${unboxExp.trim()}`);
      if (unboxUnpackedAt.trim()) metaBits.push(`Unpacked date: ${unboxUnpackedAt.trim()}`);
      const unpackedRaw = unboxUnpackedBy.trim();
      if (unpackedRaw) {
        const eid = Number(unpackedRaw);
        if (Number.isFinite(eid)) metaBits.push(`Unpacked by employee: ${eid}`);
        else metaBits.push(`Unpacked by: ${unpackedRaw}`);
      }
      const note = metaBits.length ? `Unbox — ${metaBits.join('; ')}` : 'Unbox — receive';

      const body: PostInventoryMovementBody = {
        movementType: 'receive',
        inventoryItemId: refreshedItemId,
        quantity: qty,
        toBranchLocationId: toId,
        note,
        vendorName: unboxVendor.trim() || null,
        invoiceNumber: unboxInvoice.trim() || null,
        lotNumber: unboxLot.trim() || null,
        expirationDate: unboxExp.trim() || null,
        unpackedAt: unboxUnpackedAt.trim()
          ? `${unboxUnpackedAt.trim().replace(/T.*/, '')}T12:00:00.000Z`
          : null,
      };
      if (unpackedRaw) {
        const eid = Number(unpackedRaw);
        if (Number.isFinite(eid)) body.unpackedByEmployeeId = eid;
      }
      await postInventoryMovement(practiceId, branchId, body);
      setToast('Unbox receive recorded');
      window.setTimeout(() => setToast(null), 3500);
      setUnboxVendor('');
      setUnboxInvoice('');
      setUnboxLot('');
      setUnboxExp('');
      setUnboxUnpackedAt(new Date().toISOString().slice(0, 10));
      setUnboxUnpackedBy('');
      setUnboxQty('1');
      setUnboxItemQuery('');
      setUnboxItemResults([]);
      setUnboxSelectedItem(null);
      if (selected?.itemType === 'inventory' && selected.itemId === refreshedItemId) {
        await refreshDetailBundle(selected);
        await reloadMovements();
      }
    } catch (e: unknown) {
      setUnboxError(e instanceof Error ? e.message : 'Record failed');
    } finally {
      setUnboxSubmitting(false);
    }
  }

  function resolveLocationName(id: number | null | undefined): string {
    if (id == null) return '—';
    const loc =
      movementLocations.find((l) => l.id === id) ?? branchLocations.find((l) => l.id === id);
    return loc ? locationLabel(loc) : `#${id}`;
  }

  const practiceMoney: ResolvedMoney | null = detail
    ? moneyBaseFromCatalogRow(detail.item as Record<string, unknown>)
    : null;

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Inventory and branch catalog</h2>
      <p className="settings-section-description">
        Search the catalog, choose a branch, then manage online-store flags and sell units, unbox
        receipts, bulk catalog price changes, cost rollups by location, reorder points, location buckets
        (e.g. Brunswick office, vehicle AM), audited movements (including transfers and expired /
        disposal decreases), and optional branch price overrides. Quantity price tiers stay
        practice-wide — edit them under Settings → Inventory management.
      </p>

      {toast && (
        <div className="settings-message settings-success-message" style={{ marginBottom: 16 }}>
          {toast}
        </div>
      )}

      <div className="settings-form-group" style={{ marginBottom: 24 }}>
        <label className="settings-label">Search catalog</label>
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
              checked={bulkSelectMode}
              onChange={(e) => {
                setBulkSelectMode(e.target.checked);
                if (!e.target.checked) setBulkSelected({});
              }}
            />
            Select inventory rows for bulk price change
          </label>
          {Object.keys(bulkSelected).length > 0 && (
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
            placeholder="Search inventory, labs, procedures…"
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
            <button type="button" className="inv-catalog-results__text-btn">
              Add inventory item
            </button>
            <span className="inv-catalog-results__count">
              Total count:{' '}
              {searchQuery.trim() ? (searching ? '…' : searchResults.length) : 0}
            </span>
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

        {!searchQuery.trim() && (
          <p className="settings-muted" style={{ marginTop: 0 }}>
            Type to search the catalog. Results appear here.
          </p>
        )}
        {searchQuery.trim() && !searching && searchResults.length === 0 && (
          <p className="settings-muted" style={{ marginTop: 0 }}>
            No matches.
          </p>
        )}
        {searchResults.length > 0 && (
          <div className="inv-catalog-results__table-scroll">
            <table className="inv-catalog-results__table">
              <thead>
                <tr>
                  {bulkSelectMode && <th className="inv-catalog-results__th-narrow" />}
                  <th className="inv-catalog-results__th-icon">Edit</th>
                  <th className="inv-catalog-results__th-icon">Copy</th>
                  <th>Dosages / notes</th>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Location</th>
                  <th>Vendor</th>
                  <th className="inv-catalog-results__th-num">Cost</th>
                  <th className="inv-catalog-results__th-num">Markup</th>
                  <th className="inv-catalog-results__th-num">Price</th>
                  <th className="inv-catalog-results__th-num">Service fee</th>
                  <th>Measurement</th>
                  <th className="inv-catalog-results__th-num">On hand</th>
                  <th className="inv-catalog-results__th-center">Status</th>
                  <th className="inv-catalog-results__th-icon">Delete</th>
                </tr>
              </thead>
              <tbody>
                {searchResults.map((row, i) => {
                  const itemType = row.itemType;
                  const itemId = entityIdFromSelection(itemType, row);
                  const cost = catalogCost(row);
                  return (
                    <tr
                      key={`${itemType}-${itemId}-${i}`}
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
                            <span className="settings-muted">—</span>
                          )}
                        </td>
                      )}
                      <td>
                        <button
                          type="button"
                          className="inv-catalog-results__icon-btn"
                          title="Select for branch details"
                          aria-label={`Edit / select ${row.name}`}
                          disabled={itemId == null}
                          onClick={() => {
                            if (itemId == null) return;
                            setSelected({ itemType, itemId, label: row.name });
                          }}
                        >
                          <Pencil size={16} />
                        </button>
                      </td>
                      <td>
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
                          <Copy size={16} />
                        </button>
                      </td>
                      <td className="inv-catalog-results__cell-muted">{catalogDescription(row)}</td>
                      <td>
                        <code className="inv-catalog-results__code">{row.code ?? '—'}</code>
                      </td>
                      <td>
                        <span className="inv-catalog-results__type-tag">{itemType}</span> {row.name}
                      </td>
                      <td className="inv-catalog-results__cell-muted" title="Per-branch when available from API">
                        —
                      </td>
                      <td className="inv-catalog-results__cell-muted" title="When vendor data is on the item">
                        —
                      </td>
                      <td className="inv-catalog-results__td-num">{formatUsd(cost)}</td>
                      <td className="inv-catalog-results__td-num">{catalogMarkupPct(row.price, cost)}</td>
                      <td className="inv-catalog-results__td-num">{formatUsd(row.price)}</td>
                      <td className="inv-catalog-results__td-num">{formatUsd(catalogServiceFee(row))}</td>
                      <td>{catalogSellUnit(row)}</td>
                      <td
                        className="inv-catalog-results__td-num inv-catalog-results__cell-muted"
                        title="Select a branch to load branch-level on-hand in details"
                      >
                        —
                      </td>
                      <td className="inv-catalog-results__td-center">
                        <span
                          className={
                            catalogIsActive(row)
                              ? 'inv-catalog-results__status inv-catalog-results__status--ok'
                              : 'inv-catalog-results__status inv-catalog-results__status--off'
                          }
                          title={catalogIsActive(row) ? 'Active' : 'Inactive'}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="inv-catalog-results__icon-btn inv-catalog-results__icon-btn--danger"
                          disabled
                          title="Delete is not wired here"
                          aria-label="Delete (unavailable)"
                        >
                          <X size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="settings-form-group" style={{ marginBottom: 20 }}>
        <label className="settings-label" htmlFor="inv-branch">
          Branch
        </label>
        {branchesError && (
          <p className="settings-error-message" style={{ marginTop: 4 }}>
            {branchesError}
          </p>
        )}
        <select
          id="inv-branch"
          className="settings-input"
          style={{ maxWidth: 420 }}
          value={branchId ?? ''}
          disabled={!branches.length}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) {
              setBranchId(v);
              persistBranch(v);
            }
          }}
        >
          {!branches.length && <option value="">No branches</option>}
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
              {b.isDefault ? ' (default)' : ''}
            </option>
          ))}
        </select>
        <p className="settings-muted" style={{ marginTop: 8, fontSize: 13 }}>
          Add or edit branches and location buckets under{' '}
          <a href="/schedule/settings?tab=branches-locations">Settings → Branches &amp; Locations</a>.
        </p>
      </div>

      {branchId != null && (
        <div className="settings-card" style={{ marginBottom: 24 }}>
          <h3 className="settings-card-title">Inventory cost (this branch)</h3>
          <p className="settings-muted" style={{ marginBottom: 12 }}>
            Total and per-location extended cost (unit cost × quantity on hand) across the whole branch
            catalog. Requires the cost-summary API; the line below shows the selected item only as a
            quick check.
          </p>
          {costSummaryLoading && <p className="settings-muted">Loading cost summary…</p>}
          {costSummaryError && !costSummaryLoading && (
            <div className="settings-message settings-error-message" style={{ marginBottom: 8 }}>
              {costSummaryError}
            </div>
          )}
          {costSummary && !costSummaryLoading && (
            <>
              <p style={{ margin: '0 0 12px', fontSize: 18 }}>
                <strong>Total extended cost:</strong> ${Number(costSummary.totalExtendedCost).toFixed(2)}
              </p>
              {costSummary.byLocation && costSummary.byLocation.length > 0 && (
                <div className="settings-table-container">
                  <table className="settings-table">
                    <thead>
                      <tr>
                        <th>Location</th>
                        <th>Code</th>
                        <th>Extended cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {costSummary.byLocation.map((row, i) => (
                        <tr key={`${row.branchLocationId ?? 'x'}-${row.code}-${i}`}>
                          <td>{row.name}</td>
                          <td>
                            <code>{row.code}</code>
                          </td>
                          <td>${Number(row.extendedCost).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {branchId != null && (
        <div className="settings-card" style={{ marginBottom: 24 }}>
          <h3 className="settings-card-title">Unbox / receive shipment</h3>
          <p className="settings-muted" style={{ marginBottom: 12 }}>
            Record vendor, invoice, lot, expiry, and who unpacked—then receive quantity into a bucket
            (e.g. staging, Brunswick office, VAYD vehicle AM). Use <strong>Transfer</strong> in branch
            details to move stock between buckets; use <strong>Adjustment decrease</strong> for expired
            or disposed units.
          </p>
          {unboxError && (
            <div className="settings-message settings-error-message" style={{ marginBottom: 8 }}>
              {unboxError}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 520 }}>
            <label className="settings-label">
              Search inventory to receive
              <input
                className="settings-input"
                value={unboxItemQuery}
                onChange={(e) => setUnboxItemQuery(e.target.value)}
                placeholder="e.g. Gabapentin"
                style={{ paddingRight: unboxSearching ? 36 : 12 }}
              />
            </label>
            {unboxSelectedItem && (
              <p style={{ margin: 0, fontSize: 14 }}>
                Selected: <strong>{unboxSelectedItem.name}</strong>{' '}
                <button
                  type="button"
                  className="btn secondary"
                  style={{ fontSize: 12, padding: '2px 8px' }}
                  onClick={() => setUnboxSelectedItem(null)}
                >
                  Clear
                </button>
              </p>
            )}
            {!unboxSelectedItem && unboxItemResults.length > 0 && (
              <div className="settings-table-container" style={{ maxHeight: 200, overflow: 'auto' }}>
                <table className="settings-table">
                  <tbody>
                    {unboxItemResults.map((row, i) => {
                      const id = row.inventoryItem?.id;
                      return (
                        <tr key={`ub-${id}-${i}`}>
                          <td>{row.name}</td>
                          <td>
                            <button
                              type="button"
                              className="btn secondary"
                              style={{ fontSize: 12, padding: '4px 10px' }}
                              disabled={id == null}
                              onClick={() => {
                                if (id == null) return;
                                setUnboxSelectedItem({ id, name: row.name });
                              }}
                            >
                              Use
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: 10,
              }}
            >
              <label className="settings-label">
                Vendor / company (invoice from)
                <input
                  className="settings-input"
                  value={unboxVendor}
                  onChange={(e) => setUnboxVendor(e.target.value)}
                />
              </label>
              <label className="settings-label">
                Invoice number
                <input
                  className="settings-input"
                  value={unboxInvoice}
                  onChange={(e) => setUnboxInvoice(e.target.value)}
                />
              </label>
              <label className="settings-label">
                Lot number
                <input
                  className="settings-input"
                  value={unboxLot}
                  onChange={(e) => setUnboxLot(e.target.value)}
                />
              </label>
              <label className="settings-label">
                Expiration date
                <input
                  type="date"
                  className="settings-input"
                  value={unboxExp}
                  onChange={(e) => setUnboxExp(e.target.value)}
                />
              </label>
              <label className="settings-label">
                Date unpacked
                <input
                  type="date"
                  className="settings-input"
                  value={unboxUnpackedAt}
                  onChange={(e) => setUnboxUnpackedAt(e.target.value)}
                />
              </label>
              <label className="settings-label">
                Unpacked by (employee ID or name)
                <input
                  className="settings-input"
                  value={unboxUnpackedBy}
                  onChange={(e) => setUnboxUnpackedBy(e.target.value)}
                  placeholder="ID from PIMS or free-text name"
                />
              </label>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
              <label className="settings-label" style={{ flex: '0 1 120px', marginBottom: 0 }}>
                Quantity
                <input
                  type="number"
                  min={1}
                  className="settings-input"
                  value={unboxQty}
                  onChange={(e) => setUnboxQty(e.target.value)}
                />
              </label>
              <label className="settings-label" style={{ flex: '1 1 220px', marginBottom: 0 }}>
                Receive into location
                <select
                  className="settings-input"
                  value={unboxToLocId}
                  onChange={(e) => setUnboxToLocId(e.target.value)}
                >
                  {branchLocations.map((loc) => (
                    <option key={loc.id} value={loc.id} disabled={loc.isActive === false}>
                      {locationLabel(loc)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn primary"
                disabled={unboxSubmitting || !unboxSelectedItem || !branchLocations.length}
                onClick={() => void submitUnboxReceive()}
              >
                {unboxSubmitting ? 'Recording…' : 'Record unbox (receive)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div
          className="inv-item-detail-modal__backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="inv-item-detail-modal-title"
          onClick={() => setSelected(null)}
        >
          <div className="inv-item-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="inv-item-detail-modal__header">
              <div>
                <h2 id="inv-item-detail-modal-title">
                  {selected.itemType === 'inventory'
                    ? 'View / edit inventory item'
                    : 'Inventory item'}
                </h2>
                <p className="inv-item-detail-modal__subtitle">{selected.label}</p>
              </div>
              <div className="inv-item-detail-modal__header-actions">
                <button
                  type="button"
                  className="inv-item-detail-modal__close"
                  aria-label="Close"
                  onClick={() => setSelected(null)}
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
                <span style={{ textTransform: 'capitalize' }}>{detail.itemType}</span>
                {detail.item.code != null && detail.item.code !== '' && (
                  <> · Code {String(detail.item.code)}</>
                )}
              </p>

              {detail.itemType === 'inventory' && (
                <div style={{ marginBottom: 20 }}>
                  <h4 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>
                    Sell / dispense units
                  </h4>
                  <p className="settings-muted" style={{ marginBottom: 12, fontSize: 13 }}>
                    How this item is counted when sold or dispensed (for example a bottle of 100 vs a
                    single capsule).
                  </p>
                  {unitsError && (
                    <div className="settings-message settings-error-message" style={{ marginBottom: 8 }}>
                      {unitsError}
                    </div>
                  )}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                      gap: 10,
                    }}
                  >
                    <label className="settings-label">
                      Primary unit
                      <select
                        className="settings-input"
                        value={catalogDraft.sellUnitType}
                        onChange={(e) =>
                          setCatalogDraft((d) => ({ ...d, sellUnitType: e.target.value }))
                        }
                      >
                        {SELL_UNIT_OPTIONS.map((o) => (
                          <option key={o.value || 'empty'} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="settings-label">
                      Units per package (e.g. 100 caps in bottle)
                      <input
                        className="settings-input"
                        value={catalogDraft.unitsPerPackage}
                        onChange={(e) =>
                          setCatalogDraft((d) => ({ ...d, unitsPerPackage: e.target.value }))
                        }
                      />
                    </label>
                    <label className="settings-label" style={{ gridColumn: '1 / -1' }}>
                      Detail when unit is “other”
                      <input
                        className="settings-input"
                        value={catalogDraft.sellUnitTypeDetail}
                        onChange={(e) =>
                          setCatalogDraft((d) => ({ ...d, sellUnitTypeDetail: e.target.value }))
                        }
                        placeholder="e.g. vial"
                      />
                    </label>
                    <label className="settings-label">
                      Alternate sell unit (optional)
                      <select
                        className="settings-input"
                        value={catalogDraft.alternateSellUnitType}
                        onChange={(e) =>
                          setCatalogDraft((d) => ({ ...d, alternateSellUnitType: e.target.value }))
                        }
                      >
                        {SELL_UNIT_OPTIONS.map((o) => (
                          <option key={`alt-${o.value || 'empty'}`} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="settings-label">
                      Units per alt package (optional)
                      <input
                        className="settings-input"
                        value={catalogDraft.alternateUnitsPerPackage}
                        onChange={(e) =>
                          setCatalogDraft((d) => ({
                            ...d,
                            alternateUnitsPerPackage: e.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="btn primary"
                    style={{ marginTop: 14 }}
                    disabled={unitsSaving}
                    onClick={() => void saveUnitFields()}
                  >
                    {unitsSaving ? 'Saving…' : 'Save units'}
                  </button>
                </div>
              )}

              {detail.itemType === 'inventory' && (
                <div style={{ marginBottom: 20 }}>
                  <h4 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>Stock item</h4>
                  <p className="settings-muted" style={{ marginBottom: 12, fontSize: 13 }}>
                    Which item is counted when this one is sold. Leave empty when this item is its
                    own stock. Point several sellable codes at one stock item — a single capsule and
                    a bottle of 100 both draw from the same capsule pool — and counts stay in one
                    place no matter how you sell.
                  </p>
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
                            placeholder="Search inventory items (blank = draws on itself)"
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
                        Stock units consumed per unit sold
                        <input
                          type="text"
                          inputMode="decimal"
                          className="settings-input"
                          value={stockLinkQty}
                          onChange={(e) => setStockLinkQty(e.target.value)}
                          placeholder="e.g. 100 for a bottle of 100"
                        />
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

              <div style={{ marginBottom: 16 }}>
                  <h4 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>
                    Prices by branch
                  </h4>
                  <p className="settings-muted" style={{ marginBottom: 10, fontSize: 13 }}>
                    Effective sell prices at each branch (practice catalog with any branch overrides).
                    Sell total uses the same formula as SOAP and checkout. Edit one branch, or apply
                    the same values to all.
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
                          return (
                            <tr key={b.id}>
                              <td>{b.name}</td>
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
                </div>

              {detail.itemType === 'inventory' && (
                <div style={{ marginBottom: 20 }}>
                  <h4 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>
                    Counts by branch
                  </h4>
                  <p className="settings-muted" style={{ marginBottom: 10, fontSize: 13 }}>
                    Click a branch to see location breakdown and set the reorder point.
                    {stockLinkItemId != null && (
                      <>
                        {' '}
                        Counts, reorder points and movements below belong to{' '}
                        <strong>{stockLinkItemLabel || `item #${stockLinkItemId}`}</strong>, the
                        stock item this one draws from.
                      </>
                    )}
                  </p>
                  {stockError && (
                    <div className="settings-message settings-error-message" style={{ marginBottom: 8 }}>
                      {stockError}
                    </div>
                  )}
                  {stockLoading && Object.keys(stockByBranchId).length === 0 ? (
                    <p className="settings-muted">Loading stock…</p>
                  ) : (
                    <table className="settings-table inv-counts-by-branch">
                      <thead>
                        <tr>
                          <th style={{ width: 28 }} />
                          <th>Branch</th>
                          <th>On hand</th>
                          <th>Reorder</th>
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
                                <td>{reorder}</td>
                              </tr>
                              {expanded && (
                                <tr className="inv-counts-by-branch__detail">
                                  <td colSpan={4}>
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
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {stock.locations.map((row) => (
                                              <tr key={row.branchLocationId}>
                                                <td>{row.name}</td>
                                                <td>
                                                  <code>{row.code}</code>
                                                </td>
                                                <td>
                                                  {row.quantityOnHand == null
                                                    ? '—'
                                                    : String(row.quantityOnHand)}
                                                </td>
                                              </tr>
                                            ))}
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
                                      <label className="settings-label">
                                        Reorder point
                                        <input
                                          type="text"
                                          inputMode="decimal"
                                          className="settings-input"
                                          value={reorderDraftByBranchId[b.id] ?? ''}
                                          onChange={(e) =>
                                            setReorderDraftByBranchId((prev) => ({
                                              ...prev,
                                              [b.id]: e.target.value,
                                            }))
                                          }
                                          placeholder="Not set"
                                        />
                                      </label>
                                      <button
                                        type="button"
                                        className="btn primary"
                                        disabled={stockSaving}
                                        onClick={() => void saveReorderPoint(b.id)}
                                      >
                                        {stockSaving ? 'Saving…' : 'Save reorder point'}
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

              {detail.itemType === 'inventory' && (
                <div
                  style={{
                    marginBottom: 20,
                    padding: 16,
                    border: '1px solid rgba(0,0,0,0.08)',
                    borderRadius: 8,
                  }}
                >
                  <h4 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>
                    Online store details
                  </h4>
                  <p className="settings-muted" style={{ marginBottom: 12, fontSize: 13 }}>
                    {onlineStoreImplemented
                      ? 'Description, shipping, picture, listing, and web price for this SKU.'
                      : 'Online store listing is off for this practice — enable it under Settings → Inventory.'}
                  </p>
                  {catalogError && (
                    <div className="settings-message settings-error-message" style={{ marginBottom: 8 }}>
                      {catalogError}
                    </div>
                  )}
                  {onlineStoreImplemented ? (
                    <>
                      <label className="settings-label" style={{ display: 'block', marginBottom: 12 }}>
                        Description
                        <textarea
                          className="settings-input"
                          rows={3}
                          value={catalogDraft.description}
                          onChange={(e) =>
                            setCatalogDraft((d) => ({ ...d, description: e.target.value }))
                          }
                          placeholder="Storefront / catalog description"
                        />
                      </label>
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
                      <div className="inv-item-picture" style={{ marginBottom: 14 }}>
                        <div className="settings-label" style={{ marginBottom: 6 }}>
                          Picture
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
                            {itemHasImage && (
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
                          checked={catalogDraft.showOnOnlineStore}
                          onChange={(e) =>
                            setCatalogDraft((d) => ({ ...d, showOnOnlineStore: e.target.checked }))
                          }
                        />
                        Show on online store
                      </label>
                      <label className="settings-label">
                        Online store price
                        <input
                          type="number"
                          step="0.01"
                          className="settings-input"
                          disabled={!catalogDraft.showOnOnlineStore}
                          value={catalogDraft.onlineStorePrice}
                          onChange={(e) =>
                            setCatalogDraft((d) => ({ ...d, onlineStorePrice: e.target.value }))
                          }
                          placeholder="0.00"
                        />
                      </label>
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

              {detail.itemType === 'inventory' && (
                <div style={{ marginBottom: 20 }}>
                  <h4 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>
                    Stock movements
                  </h4>
                  <p className="settings-muted" style={{ marginBottom: 12, fontSize: 13 }}>
                    Transfers move stock between locations <strong>within</strong> a branch. Choose
                    the branch for recording and history below. Branch-to-branch moves use receive /
                    adjust.
                  </p>
                  <label className="settings-label" style={{ maxWidth: 320, marginBottom: 16 }}>
                    Branch
                    <select
                      className="settings-input"
                      value={movementBranchId ?? ''}
                      disabled={!branches.length}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v)) setMovementBranchId(v);
                      }}
                    >
                      {!branches.length && <option value="">No branches</option>}
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                          {b.isDefault ? ' (default)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div style={{ marginBottom: 24 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>
                      Record movement
                    </h4>
                    <p className="settings-muted" style={{ marginBottom: 12, fontSize: 13 }}>
                      Attribution uses your session by default; set employee ID only to override
                      (e.g. <code>doctorId</code> from profile is {doctorId ?? 'not set'}).
                    </p>
                    {movementError && (
                      <div
                        className="settings-message settings-error-message"
                        style={{ marginBottom: 8 }}
                      >
                        {movementError}
                      </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 440 }}>
                      <label className="settings-label">
                        Movement type
                        <select
                          className="settings-input"
                          value={movementType}
                          onChange={(e) => {
                            setMovementType(e.target.value as InventoryMovementType);
                            setMovementError(null);
                          }}
                        >
                          {MOVEMENT_TYPES.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="settings-label">
                        Quantity
                        <input
                          type="number"
                          min={1}
                          step={1}
                          className="settings-input"
                          value={movementQty}
                          onChange={(e) => setMovementQty(e.target.value)}
                        />
                      </label>
                      {movementNeedsFrom(movementType) && (
                        <label className="settings-label">
                          From location
                          <select
                            className="settings-input"
                            value={movementFromId}
                            onChange={(e) => setMovementFromId(e.target.value)}
                          >
                            {movementLocations.map((loc) => (
                              <option
                                key={loc.id}
                                value={loc.id}
                                disabled={loc.isActive === false}
                              >
                                {locationLabel(loc)}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      {movementNeedsTo(movementType) && (
                        <label className="settings-label">
                          To location
                          <select
                            className="settings-input"
                            value={movementToId}
                            onChange={(e) => setMovementToId(e.target.value)}
                          >
                            {movementLocations.map((loc) => (
                              <option
                                key={loc.id}
                                value={loc.id}
                                disabled={loc.isActive === false}
                              >
                                {locationLabel(loc)}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <label className="settings-label">
                        Note (optional)
                        <input
                          className="settings-input"
                          value={movementNote}
                          onChange={(e) => setMovementNote(e.target.value)}
                          placeholder="Invoice #, reason, etc."
                        />
                      </label>
                      <label className="settings-label">
                        Moved by employee ID (optional override)
                        <input
                          className="settings-input"
                          value={movementEmployeeId}
                          onChange={(e) => setMovementEmployeeId(e.target.value)}
                          placeholder="Leave blank for JWT default"
                        />
                      </label>
                      <button
                        type="button"
                        className="btn primary"
                        disabled={
                          movementSubmitting || !movementLocations.length || movementBranchId == null
                        }
                        onClick={() => void submitMovement()}
                      >
                        {movementSubmitting ? 'Recording…' : 'Record movement'}
                      </button>
                    </div>
                  </div>

                  <div>
                    <h4 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>
                      Movement history
                    </h4>
                    {movementsLoading && movements.length === 0 ? (
                      <p className="settings-muted">Loading history…</p>
                    ) : movements.length === 0 ? (
                      <p className="settings-muted">No movements yet for this item at this branch.</p>
                    ) : (
                      <>
                        <div className="settings-table-container">
                          <table className="settings-table">
                            <thead>
                              <tr>
                                <th>When</th>
                                <th>Type</th>
                                <th>Qty</th>
                                <th>From</th>
                                <th>To</th>
                                <th>Note</th>
                              </tr>
                            </thead>
                            <tbody>
                              {movements.map((m, idx) => (
                                <tr key={String(m.id ?? idx)}>
                                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                                    {m.created
                                      ? new Date(String(m.created)).toLocaleString()
                                      : '—'}
                                  </td>
                                  <td style={{ fontSize: 12 }}>{String(m.movementType ?? '—')}</td>
                                  <td>{m.quantity != null ? String(m.quantity) : '—'}</td>
                                  <td style={{ fontSize: 12 }}>
                                    {resolveLocationName(m.fromBranchLocationId as number)}
                                  </td>
                                  <td style={{ fontSize: 12 }}>
                                    {resolveLocationName(m.toBranchLocationId as number)}
                                  </td>
                                  <td
                                    style={{ fontSize: 12, maxWidth: 160 }}
                                    title={String(m.note ?? '')}
                                  >
                                    {m.note ? String(m.note) : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {movements.length < movementTotal && (
                          <button
                            type="button"
                            className="btn secondary"
                            style={{ marginTop: 10 }}
                            disabled={movementsLoading}
                            onClick={() => void loadMoreMovements()}
                          >
                            {movementsLoading
                              ? 'Loading…'
                              : `Load more (${movements.length} of ${movementTotal})`}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              {detail.itemType !== 'inventory' && (
                <p className="settings-muted" style={{ marginBottom: 16 }}>
                  On-hand quantity applies to inventory items only. You can still override prices for
                  this {detail.itemType} by branch.
                </p>
              )}

              <div>
                <h4 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>
                  Quantity price breaks (practice)
                </h4>
                {detail.priceBreaks.length === 0 ? (
                  <p className="settings-muted">No tiers configured.</p>
                ) : (
                  <div className="settings-table-container">
                    <table className="settings-table">
                      <thead>
                        <tr>
                          <th>Low</th>
                          <th>High</th>
                          <th>Price</th>
                          <th>Active</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...detail.priceBreaks]
                          .sort((a, b) => a.lowQuantity - b.lowQuantity)
                          .map((pb) => (
                            <tr key={pb.id}>
                              <td>{pb.lowQuantity}</td>
                              <td>{pb.highQuantity}</td>
                              <td>${Number(pb.price).toFixed(2)}</td>
                              <td>{pb.isActive ? 'Yes' : 'No'}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
              </div>
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
              Set the values below, then choose which branches receive them as overrides. Clear
              overrides falls back to the practice catalog on the checked branches only.
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
                  Fills Price, Cost, Service fee, and Minimum from that branch’s effective prices.
                  Nothing is saved until you click Save. For Online store, only Price is written as
                  the web base.
                </span>
              </label>
            )}
            {(['price', 'cost', 'serviceFee', 'minimumPrice'] as const).map((key) => (
              <label key={key} className="settings-label" style={{ display: 'block', marginBottom: 12 }}>
                {key === 'serviceFee'
                  ? 'Service fee'
                  : key === 'minimumPrice'
                    ? 'Minimum price'
                    : key.charAt(0).toUpperCase() + key.slice(1)}
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
              Applies to {Object.keys(bulkSelected).length} inventory catalog item(s). Use positive
              percents to raise prices (e.g. <code>5</code> = +5%). Leave a field blank to skip that
              adjustment.
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

    </div>
  );
}
