import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import {
  searchItems,
  getItemWithPriceBreaks,
  type SearchResultItem,
  type ItemWithPriceBreaks,
  type ItemType,
  type InventoryItem,
} from '../api/quantityPriceBreaks';
import {
  getInventoryCostSummary,
  patchPracticeInventoryItem,
  postBulkInventoryPriceAdjust,
  type InventoryCostSummary,
} from '../api/inventoryTools';
import {
  listPracticeBranches,
  listInventoryBranchLocations,
  createInventoryBranchLocation,
  patchInventoryBranchLocation,
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
import './Settings.css';

const BRANCH_STORAGE_PREFIX = 'vayd_inventory_branch:';

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

  const [stockSnapshot, setStockSnapshot] = useState<InventoryBranchStock | null>(null);
  const [reorderDraft, setReorderDraft] = useState('');
  const [stockLoading, setStockLoading] = useState(false);
  const [stockSaving, setStockSaving] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);

  const [branchLocations, setBranchLocations] = useState<InventoryBranchLocation[]>([]);
  const [locLoading, setLocLoading] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [newLocCode, setNewLocCode] = useState('');
  const [newLocName, setNewLocName] = useState('');
  const [newLocSort, setNewLocSort] = useState('');
  const [newLocSaving, setNewLocSaving] = useState(false);

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
  const [movementOffset, setMovementOffset] = useState(0);
  const [movementsLoading, setMovementsLoading] = useState(false);

  const [effective, setEffective] = useState<MoneyFields | null>(null);
  const [priceModalOpen, setPriceModalOpen] = useState(false);
  const [priceForm, setPriceForm] = useState<ResolvedMoney>({
    price: 0,
    cost: 0,
    serviceFee: 0,
    minimumPrice: 0,
  });
  const [priceSaving, setPriceSaving] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);

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
  const [catalogDraft, setCatalogDraft] = useState({
    showOnOnlineStore: false,
    onlineStorePrice: '',
    sellUnitType: '',
    sellUnitTypeDetail: '',
    unitsPerPackage: '',
    alternateSellUnitType: '',
    alternateUnitsPerPackage: '',
  });

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
    if (!selected || selected.itemType !== 'inventory' || branchId == null) {
      setMovements([]);
      setMovementTotal(0);
      return;
    }
    setMovementsLoading(true);
    try {
      const r = await listInventoryMovements(practiceId, branchId, {
        inventoryItemId: selected.itemId,
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
  }, [selected, branchId, practiceId]);

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
        const list = await listPracticeBranches(practiceId);
        if (cancelled) return;
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
      setLocLoading(true);
      setLocError(null);
      try {
        const list = await listInventoryBranchLocations(practiceId, branchId);
        if (!cancelled) setBranchLocations(Array.isArray(list) ? list : []);
      } catch (e: unknown) {
        if (!cancelled) setLocError(e instanceof Error ? e.message : 'Failed to load locations');
      } finally {
        if (!cancelled) setLocLoading(false);
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
    setCatalogDraft({
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
  }, [detail]);

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
    if (!branchLocations.length) {
      setMovementFromId('');
      setMovementToId('');
      setUnboxToLocId('');
      return;
    }
    const def = branchLocations.find((l) => l.code === 'main') ?? branchLocations[0];
    setMovementFromId(String(def.id));
    setMovementToId(String(def.id));
    setUnboxToLocId((prev) => (prev && branchLocations.some((l) => String(l.id) === prev) ? prev : String(def.id)));
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
      if (branchId == null) return;
      setDetailLoading(true);
      setDetailError(null);
      setStockError(null);
      try {
        const item = await getItemWithPriceBreaks(sel.itemType, sel.itemId, practiceId);
        setDetail(item);

        const entityType = itemTypeToEntityType(item.itemType);
        const base = moneyBaseFromCatalogRow(item.item as Record<string, unknown>);
        const eff = await postEffectiveBranchPrice(practiceId, branchId, {
          entityType,
          entityId: sel.itemId,
          base,
        });
        setEffective(eff.effective);

        if (item.itemType === 'inventory') {
          setStockLoading(true);
          try {
            const s = await getInventoryBranchStock(practiceId, branchId, sel.itemId);
            setStockSnapshot(s);
            setReorderDraft(
              s.reorderPoint == null || Number.isNaN(Number(s.reorderPoint))
                ? ''
                : String(s.reorderPoint)
            );
          } catch {
            setStockSnapshot(null);
            setReorderDraft('');
          } finally {
            setStockLoading(false);
          }
        } else {
          setStockSnapshot(null);
          setReorderDraft('');
        }
      } catch (e: unknown) {
        setDetail(null);
        setEffective(null);
        setDetailError(e instanceof Error ? e.message : 'Failed to load item');
      } finally {
        setDetailLoading(false);
      }
    },
    [branchId, practiceId]
  );

  useEffect(() => {
    if (!selected || branchId == null) {
      setDetail(null);
      setEffective(null);
      return;
    }
    void refreshDetailBundle(selected);
  }, [selected, branchId, refreshDetailBundle]);

  function openPriceModal() {
    if (effective) {
      setPriceForm(effectiveToResolved(effective));
    } else if (detail) {
      setPriceForm(moneyBaseFromCatalogRow(detail.item as Record<string, unknown>));
    }
    setPriceError(null);
    setPriceModalOpen(true);
  }

  async function saveBranchPrices() {
    if (!selected || branchId == null || !detail) return;
    setPriceSaving(true);
    setPriceError(null);
    try {
      const entityType = itemTypeToEntityType(detail.itemType);
      await upsertBranchPriceOverride(practiceId, branchId, {
        entityType,
        entityId: selected.itemId,
        price: priceForm.price,
        cost: priceForm.cost,
        serviceFee: priceForm.serviceFee,
        minimumPrice: priceForm.minimumPrice,
      });
      setToast('Branch prices saved');
      window.setTimeout(() => setToast(null), 3500);
      setPriceModalOpen(false);
      await refreshDetailBundle(selected);
    } catch (e: unknown) {
      setPriceError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setPriceSaving(false);
    }
  }

  async function resetBranchPrices() {
    if (!selected || branchId == null || !detail) return;
    setPriceSaving(true);
    setPriceError(null);
    try {
      const entityType = itemTypeToEntityType(detail.itemType);
      await upsertBranchPriceOverride(practiceId, branchId, {
        entityType,
        entityId: selected.itemId,
        price: null,
        cost: null,
        serviceFee: null,
        minimumPrice: null,
      });
      setToast('Branch price overrides cleared');
      window.setTimeout(() => setToast(null), 3500);
      setPriceModalOpen(false);
      await refreshDetailBundle(selected);
    } catch (e: unknown) {
      setPriceError(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      setPriceSaving(false);
    }
  }

  async function saveReorderPoint() {
    if (!selected || branchId == null || selected.itemType !== 'inventory') return;
    setStockSaving(true);
    setStockError(null);
    try {
      const reorderPoint =
        reorderDraft.trim() === '' ? null : Number(reorderDraft.trim());
      if (reorderDraft.trim() !== '' && !Number.isFinite(reorderPoint as number)) {
        setStockError('Reorder point must be a number');
        return;
      }
      const updated = await upsertInventoryBranchStock(practiceId, branchId, selected.itemId, {
        reorderPoint,
      });
      setStockSnapshot(updated);
      setToast('Reorder point saved');
      window.setTimeout(() => setToast(null), 3500);
    } catch (e: unknown) {
      setStockError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setStockSaving(false);
    }
  }

  async function submitMovement() {
    if (!selected || branchId == null || selected.itemType !== 'inventory') return;
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
        inventoryItemId: selected.itemId,
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
      await postInventoryMovement(practiceId, branchId, body);
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

  async function addBranchLocation() {
    if (branchId == null) return;
    const code = newLocCode.trim();
    const name = newLocName.trim();
    if (!code || !name) {
      setLocError('Location code and name are required');
      return;
    }
    setNewLocSaving(true);
    setLocError(null);
    try {
      const sortOrderRaw = newLocSort.trim();
      const sortOrder = sortOrderRaw === '' ? undefined : Number(sortOrderRaw);
      await createInventoryBranchLocation(practiceId, branchId, {
        code,
        name,
        ...(Number.isFinite(sortOrder as number) ? { sortOrder: sortOrder as number } : {}),
      });
      setNewLocCode('');
      setNewLocName('');
      setNewLocSort('');
      setToast('Location created');
      window.setTimeout(() => setToast(null), 3500);
      const list = await listInventoryBranchLocations(practiceId, branchId);
      setBranchLocations(Array.isArray(list) ? list : []);
    } catch (e: unknown) {
      setLocError(e instanceof Error ? e.message : 'Failed to create location');
    } finally {
      setNewLocSaving(false);
    }
  }

  async function deactivateLocation(loc: InventoryBranchLocation) {
    if (branchId == null || loc.isDefault) return;
    if (!window.confirm(`Deactivate location “${loc.name}”?`)) return;
    setLocError(null);
    try {
      await patchInventoryBranchLocation(practiceId, branchId, loc.id, { isActive: false });
      const list = await listInventoryBranchLocations(practiceId, branchId);
      setBranchLocations(Array.isArray(list) ? list : []);
      setToast('Location deactivated');
      window.setTimeout(() => setToast(null), 3500);
    } catch (e: unknown) {
      setLocError(e instanceof Error ? e.message : 'Update failed');
    }
  }

  async function loadMoreMovements() {
    if (!selected || selected.itemType !== 'inventory' || branchId == null) return;
    if (movements.length >= movementTotal) return;
    setMovementsLoading(true);
    try {
      const r = await listInventoryMovements(practiceId, branchId, {
        inventoryItemId: selected.itemId,
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

  async function saveCatalogExtensions() {
    if (!selected || selected.itemType !== 'inventory' || branchId == null) return;
    setCatalogSaving(true);
    setCatalogError(null);
    try {
      await patchPracticeInventoryItem(practiceId, selected.itemId, {
        showOnOnlineStore: catalogDraft.showOnOnlineStore,
        onlineStorePrice:
          catalogDraft.onlineStorePrice.trim() === '' ? null : Number(catalogDraft.onlineStorePrice),
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
      setToast('Online store & unit fields saved');
      window.setTimeout(() => setToast(null), 3500);
      await refreshDetailBundle(selected);
    } catch (e: unknown) {
      setCatalogError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setCatalogSaving(false);
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
    const loc = branchLocations.find((l) => l.id === id);
    return loc ? locationLabel(loc) : `#${id}`;
  }

  const practiceMoney: ResolvedMoney | null = detail
    ? moneyBaseFromCatalogRow(detail.item as Record<string, unknown>)
    : null;

  const unitCostForSelected =
    effective != null ? toMoneyNumber(effective.cost) : practiceMoney ? practiceMoney.cost : 0;
  const selectedInventoryExtendedCost =
    selected?.itemType === 'inventory' &&
    detail?.itemType === 'inventory' &&
    stockSnapshot != null &&
    stockSnapshot.quantityOnHandTotal != null &&
    !Number.isNaN(Number(stockSnapshot.quantityOnHandTotal))
      ? unitCostForSelected * Number(stockSnapshot.quantityOnHandTotal)
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

      <div className="settings-form-group" style={{ marginBottom: 20 }}>
        <label className="settings-label">Practice</label>
        <p className="settings-muted" style={{ marginTop: 0 }}>
          Using practice ID <strong>{practiceId}</strong>
          {decodeJwtPayload(token ?? '')?.practiceId != null ? ' (from your session)' : ''}
          {decodeJwtPayload(token ?? '')?.practiceId == null && import.meta.env.VITE_PRACTICE_ID
            ? ' (from VITE_PRACTICE_ID)'
            : ''}
          {decodeJwtPayload(token ?? '')?.practiceId == null && !import.meta.env.VITE_PRACTICE_ID
            ? ' (default 1 — set VITE_PRACTICE_ID or JWT practiceId if needed)'
            : ''}
        </p>
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
          <h3 className="settings-card-title">Location buckets (this branch)</h3>
          <p className="settings-muted" style={{ marginBottom: 12 }}>
            Each branch has a default <code>main</code> bucket. Add more (office, vehicle, etc.) for
            transfers and reporting.
          </p>
          {locError && <p className="settings-error-message">{locError}</p>}
          {locLoading ? (
            <p className="settings-muted">Loading locations…</p>
          ) : (
            <>
              <div className="settings-table-container" style={{ marginBottom: 16 }}>
                <table className="settings-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Name</th>
                      <th>Default</th>
                      <th>Active</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {branchLocations.map((loc) => (
                      <tr key={loc.id}>
                        <td>
                          <code>{loc.code}</code>
                        </td>
                        <td>{loc.name}</td>
                        <td>{loc.isDefault ? 'Yes' : '—'}</td>
                        <td>{loc.isActive === false ? 'No' : 'Yes'}</td>
                        <td>
                          {!loc.isDefault && loc.isActive !== false && (
                            <button
                              type="button"
                              className="btn secondary"
                              style={{ fontSize: 12, padding: '4px 10px' }}
                              onClick={() => void deactivateLocation(loc)}
                            >
                              Deactivate
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 10,
                  alignItems: 'flex-end',
                  maxWidth: 720,
                }}
              >
                <label className="settings-label" style={{ flex: '1 1 140px', marginBottom: 0 }}>
                  New code
                  <input
                    className="settings-input"
                    value={newLocCode}
                    onChange={(e) => setNewLocCode(e.target.value)}
                    placeholder="e.g. vehicle_1"
                  />
                </label>
                <label className="settings-label" style={{ flex: '1 1 160px', marginBottom: 0 }}>
                  New name
                  <input
                    className="settings-input"
                    value={newLocName}
                    onChange={(e) => setNewLocName(e.target.value)}
                    placeholder="Display name"
                  />
                </label>
                <label className="settings-label" style={{ flex: '0 1 100px', marginBottom: 0 }}>
                  Sort
                  <input
                    className="settings-input"
                    value={newLocSort}
                    onChange={(e) => setNewLocSort(e.target.value)}
                    placeholder="Optional"
                  />
                </label>
                <button
                  type="button"
                  className="btn primary"
                  disabled={newLocSaving}
                  onClick={() => void addBranchLocation()}
                >
                  {newLocSaving ? 'Adding…' : 'Add location'}
                </button>
              </div>
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

      <div className="settings-form-group">
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
        <div style={{ position: 'relative', maxWidth: 560 }}>
          <input
            type="text"
            className="settings-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search inventory, labs, procedures…"
            style={{ width: '100%', paddingRight: searching ? 40 : 12 }}
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

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.2fr)',
          gap: 24,
          marginTop: 20,
          alignItems: 'start',
        }}
        className="inventory-mgmt-grid"
      >
        <div className="settings-card">
          <h3 className="settings-card-title">Results</h3>
          {!searchQuery.trim() && <p className="settings-muted">Type to search.</p>}
          {searchQuery.trim() && !searching && searchResults.length === 0 && (
            <p className="settings-muted">No matches.</p>
          )}
          {searchResults.length > 0 && (
            <div className="settings-table-container">
              <table className="settings-table">
                <thead>
                  <tr>
                    {bulkSelectMode && <th style={{ width: 40 }} />}
                    <th>Type</th>
                    <th>Name</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((row, i) => {
                    const itemType = row.itemType;
                    const itemId = entityIdFromSelection(itemType, row);
                    const active =
                      selected && selected.itemType === itemType && selected.itemId === itemId;
                    return (
                      <tr key={`${itemType}-${itemId}-${i}`}>
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
                        <td style={{ textTransform: 'capitalize' }}>{itemType}</td>
                        <td>{row.name}</td>
                        <td>
                          <button
                            type="button"
                            className="btn secondary"
                            disabled={itemId == null}
                            onClick={() => {
                              if (itemId == null) return;
                              setSelected({
                                itemType,
                                itemId,
                                label: row.name,
                              });
                            }}
                          >
                            {active ? 'Selected' : 'Select'}
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

        <div className="settings-card">
          <h3 className="settings-card-title">Branch details</h3>
          {!selected && <p className="settings-muted">Select an item from the list.</p>}
          {selected && branchId == null && (
            <p className="settings-muted">Choose a branch to load stock and prices.</p>
          )}
          {selected && branchId != null && detailLoading && (
            <div className="settings-loading">
              <div className="settings-spinner" />
              <span>Loading…</span>
            </div>
          )}
          {detailError && (
            <div className="settings-message settings-error-message">{detailError}</div>
          )}
          {selected && branchId != null && !detailLoading && detail && (
            <>
              <p className="settings-card-subtitle" style={{ marginBottom: 16 }}>
                <strong>{detail.item.name}</strong> ·{' '}
                <span style={{ textTransform: 'capitalize' }}>{detail.itemType}</span>
                {detail.item.code != null && detail.item.code !== '' && (
                  <> · Code {String(detail.item.code)}</>
                )}
              </p>

              {practiceMoney && (
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>Practice catalog</h4>
                  <table className="settings-table">
                    <tbody>
                      <tr>
                        <td>Price</td>
                        <td>${practiceMoney.price.toFixed(2)}</td>
                      </tr>
                      <tr>
                        <td>Cost</td>
                        <td>${practiceMoney.cost.toFixed(2)}</td>
                      </tr>
                      <tr>
                        <td>Service fee</td>
                        <td>${practiceMoney.serviceFee.toFixed(2)}</td>
                      </tr>
                      <tr>
                        <td>Minimum price</td>
                        <td>${practiceMoney.minimumPrice.toFixed(2)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {effective && (
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>
                    Effective at this branch
                  </h4>
                  <table className="settings-table">
                    <tbody>
                      <tr>
                        <td>Price</td>
                        <td>${effective.price?.toFixed(2) ?? '—'}</td>
                      </tr>
                      <tr>
                        <td>Cost</td>
                        <td>${effective.cost?.toFixed(2) ?? '—'}</td>
                      </tr>
                      <tr>
                        <td>Service fee</td>
                        <td>${effective.serviceFee?.toFixed(2) ?? '—'}</td>
                      </tr>
                      <tr>
                        <td>Minimum price</td>
                        <td>${effective.minimumPrice?.toFixed(2) ?? '—'}</td>
                      </tr>
                    </tbody>
                  </table>
                  <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="btn primary" onClick={openPriceModal}>
                      Edit branch prices
                    </button>
                    <button type="button" className="btn secondary" onClick={() => refreshDetailBundle(selected)}>
                      Refresh
                    </button>
                  </div>
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
                    Online store & sell / dispense units
                  </h4>
                  <p className="settings-muted" style={{ marginBottom: 12, fontSize: 13 }}>
                    Show this SKU on the online store and set its web price. Primary and alternate units
                    describe how you sell or use the item (for example bottle of 100 vs single capsule).
                  </p>
                  {catalogError && (
                    <div className="settings-message settings-error-message" style={{ marginBottom: 8 }}>
                      {catalogError}
                    </div>
                  )}
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
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                      gap: 10,
                      marginTop: 10,
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
                          setCatalogDraft((d) => ({ ...d, alternateUnitsPerPackage: e.target.value }))
                        }
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="btn primary"
                    style={{ marginTop: 14 }}
                    disabled={catalogSaving}
                    onClick={() => void saveCatalogExtensions()}
                  >
                    {catalogSaving ? 'Saving…' : 'Save online store & units'}
                  </button>
                </div>
              )}

              {detail.itemType === 'inventory' && (
                <div style={{ marginBottom: 20 }}>
                  <h4 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>Stock at this branch</h4>
                  {stockLoading ? (
                    <p className="settings-muted">Loading stock…</p>
                  ) : (
                    <>
                      {stockError && (
                        <div className="settings-message settings-error-message" style={{ marginBottom: 8 }}>
                          {stockError}
                        </div>
                      )}
                      <p style={{ margin: '0 0 12px', fontSize: 16 }}>
                        <strong>Total on hand:</strong>{' '}
                        {stockSnapshot?.quantityOnHandTotal == null ||
                        Number.isNaN(Number(stockSnapshot.quantityOnHandTotal))
                          ? '—'
                          : String(stockSnapshot.quantityOnHandTotal)}
                      </p>
                      {selectedInventoryExtendedCost != null && (
                        <p style={{ margin: '0 0 12px', fontSize: 15 }}>
                          <strong>Extended cost (this branch, this item):</strong> $
                          {selectedInventoryExtendedCost.toFixed(2)}
                          <span className="settings-muted" style={{ marginLeft: 8, fontSize: 13 }}>
                            (effective unit cost × total on hand)
                          </span>
                        </p>
                      )}
                      {stockSnapshot && stockSnapshot.locations && stockSnapshot.locations.length > 0 && (
                        <div className="settings-table-container" style={{ marginBottom: 16 }}>
                          <table className="settings-table">
                            <thead>
                              <tr>
                                <th>Location</th>
                                <th>Code</th>
                                <th>Qty</th>
                              </tr>
                            </thead>
                            <tbody>
                              {stockSnapshot.locations.map((row) => (
                                <tr key={row.branchLocationId}>
                                  <td>{row.name}</td>
                                  <td>
                                    <code>{row.code}</code>
                                  </td>
                                  <td>
                                    {row.quantityOnHand == null ? '—' : String(row.quantityOnHand)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 360 }}>
                        <label className="settings-label">
                          Reorder point (branch + item)
                          <input
                            type="text"
                            inputMode="decimal"
                            className="settings-input"
                            value={reorderDraft}
                            onChange={(e) => setReorderDraft(e.target.value)}
                            placeholder="Not set"
                          />
                        </label>
                        <button
                          type="button"
                          className="btn primary"
                          disabled={stockSaving}
                          onClick={() => void saveReorderPoint()}
                        >
                          {stockSaving ? 'Saving…' : 'Save reorder point'}
                        </button>
                      </div>

                      <div
                        style={{
                          marginTop: 24,
                          paddingTop: 20,
                          borderTop: '1px solid rgba(0,0,0,0.08)',
                        }}
                      >
                        <h4 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>
                          Record movement
                        </h4>
                        <p className="settings-muted" style={{ marginBottom: 12, fontSize: 13 }}>
                          Use audited movements for all quantity changes. Attribution uses your
                          session by default; set employee ID only to override (e.g.{' '}
                          <code>doctorId</code> from profile is {doctorId ?? 'not set'}).
                        </p>
                        {movementError && (
                          <div className="settings-message settings-error-message" style={{ marginBottom: 8 }}>
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
                                {branchLocations.map((loc) => (
                                  <option key={loc.id} value={loc.id} disabled={loc.isActive === false}>
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
                                {branchLocations.map((loc) => (
                                  <option key={loc.id} value={loc.id} disabled={loc.isActive === false}>
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
                            disabled={movementSubmitting || !branchLocations.length}
                            onClick={() => void submitMovement()}
                          >
                            {movementSubmitting ? 'Recording…' : 'Record movement'}
                          </button>
                        </div>
                      </div>

                      <div
                        style={{
                          marginTop: 24,
                          paddingTop: 20,
                          borderTop: '1px solid rgba(0,0,0,0.08)',
                        }}
                      >
                        <h4 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>
                          Movement history
                        </h4>
                        {movementsLoading && movements.length === 0 ? (
                          <p className="settings-muted">Loading history…</p>
                        ) : movements.length === 0 ? (
                          <p className="settings-muted">No movements yet for this item.</p>
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
                                      <td style={{ fontSize: 12, maxWidth: 160 }} title={String(m.note ?? '')}>
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
                                {movementsLoading ? 'Loading…' : `Load more (${movements.length} of ${movementTotal})`}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {detail.itemType !== 'inventory' && (
                <p className="settings-muted" style={{ marginBottom: 16 }}>
                  On-hand quantity applies to inventory items only. You can still override prices for
                  this {detail.itemType} at the selected branch.
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
            zIndex: 10000,
            padding: 16,
          }}
        >
          <div
            className="settings-card"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(440px, 100%)', padding: 24 }}
          >
            <h3 className="settings-card-title">Branch price override</h3>
            <p className="settings-muted" style={{ marginBottom: 16 }}>
              Values saved here apply only to <strong>{branches.find((b) => b.id === branchId)?.name}</strong>.
              Use &quot;Clear overrides&quot; to fall back to the practice catalog for all four fields.
            </p>
            {priceError && (
              <div className="settings-message settings-error-message" style={{ marginBottom: 12 }}>
                {priceError}
              </div>
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
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
              <button type="button" className="btn primary" disabled={priceSaving} onClick={() => void saveBranchPrices()}>
                {priceSaving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={priceSaving}
                onClick={() => void resetBranchPrices()}
              >
                Clear overrides
              </button>
              <button type="button" className="btn secondary" disabled={priceSaving} onClick={() => setPriceModalOpen(false)}>
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
            zIndex: 10000,
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

      <style>{`
        @media (max-width: 900px) {
          .inventory-mgmt-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
