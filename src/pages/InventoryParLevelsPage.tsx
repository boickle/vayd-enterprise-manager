import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAuth } from '../auth/useAuth';
import {
  getInventoryBranchStock,
  listBranchParLevels,
  listPracticeBranches,
  upsertInventoryBranchStock,
  type BranchParItem,
  type BranchParItemLocation,
  type BranchParLocation,
  type InventoryBranchStock,
  type PracticeBranch,
} from '../api/branchInventory';
import { searchItems, type SearchResultItem } from '../api/quantityPriceBreaks';
import { listCatalogCategories, type CatalogCategory } from '../api/catalogCategories';
import { syncStockListsFromPars } from '../utils/syncFillList';
import { useStockItemGroups, type StockItemGroup } from '../hooks/useStockItemGroups';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import {
  hitsDefaultMin,
  locationNeedsAttention,
  resolveDefaultLocationId,
  shortBy,
  surplusBy,
} from '../utils/inventoryLocationTargets';
import './Settings.css';

const BRANCH_STORAGE_PREFIX = 'vayd_inventory_branch:';
const UNCATEGORIZED = 'Uncategorized';

function categoryLookupKey(raw: unknown): string | null {
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? String(Math.trunc(n)) : String(raw);
}

function categoryLabel(
  item: Pick<BranchParItem, 'category' | 'categoryName'>,
  names: Map<string, string>
): string {
  const fromApi = item.categoryName?.trim();
  if (fromApi) return fromApi;
  const key = categoryLookupKey(item.category);
  if (key && names.has(key)) return names.get(key)!;
  return UNCATEGORIZED;
}

function officeFillShortTotal(item: BranchParItem, defaultLocationId: number | null): number {
  return item.locations.reduce((sum, loc) => {
    if (loc.branchLocationId === defaultLocationId) return sum;
    return sum + (shortBy(loc.quantityOnHand, loc.parLevel) ?? 0);
  }, 0);
}

function itemNeedsAttention(item: BranchParItem, defaultLocationId: number | null): boolean {
  return item.locations.some((loc) =>
    locationNeedsAttention({
      isDefault: loc.branchLocationId === defaultLocationId,
      onHand: loc.quantityOnHand,
      parOrMax: loc.parLevel,
      min: item.reorderPoint,
    })
  );
}

function locNeedsAttention(
  item: BranchParItem,
  loc: BranchParItemLocation,
  defaultLocationId: number | null
): boolean {
  return locationNeedsAttention({
    isDefault: loc.branchLocationId === defaultLocationId,
    onHand: loc.quantityOnHand,
    parOrMax: loc.parLevel,
    min: item.reorderPoint,
  });
}

function ParVariance({ onHand, par }: { onHand: number; par: number | null }) {
  const short = shortBy(onHand, par);
  const extra = surplusBy(onHand, par);
  if (short != null) return <span className="par-short">short {short}</span>;
  if (extra != null) return <span className="par-surplus">Over {extra}</span>;
  return <span className="settings-muted">—</span>;
}

function DefaultVariance({
  onHand,
  min,
  max,
}: {
  onHand: number;
  min: number | null;
  max: number | null;
}) {
  if (hitsDefaultMin(onHand, min)) {
    return <span className="par-short">at re-order point — order</span>;
  }
  const extra = surplusBy(onHand, max);
  if (extra != null) return <span className="par-surplus">Over {extra}</span>;
  if (shortBy(onHand, max) != null) {
    return <span className="settings-muted">below max</span>;
  }
  return <span className="settings-muted">—</span>;
}

function LocationStatus({
  loc,
  isDefault,
  min,
}: {
  loc: Pick<BranchParItemLocation, 'quantityOnHand' | 'parLevel' | 'name'>;
  isDefault: boolean;
  min: number | null;
}) {
  if (isDefault) {
    return <DefaultVariance onHand={loc.quantityOnHand} min={min} max={loc.parLevel} />;
  }
  return <ParVariance onHand={loc.quantityOnHand} par={loc.parLevel} />;
}

type OtherOfficeLoc = {
  branchId: number;
  branchName: string;
  branchLocationId: number;
  locationName: string;
  quantityOnHand: number;
  parLevel: number | null;
};

function parItemFromStock(
  stock: InventoryBranchStock,
  name: string,
  code: string | null,
  extras?: Pick<BranchParItem, 'category' | 'categoryName'>
): BranchParItem {
  const defaultLocationId = resolveDefaultLocationId(stock.locations ?? []);
  const locations = (stock.locations ?? []).map((loc) => {
    const quantityOnHand = Number(loc.quantityOnHand ?? 0);
    const parLevel = loc.parLevel ?? null;
    const isDefault = loc.branchLocationId === defaultLocationId;
    return {
      branchLocationId: loc.branchLocationId,
      code: loc.code,
      name: loc.name,
      isDefault,
      quantityOnHand,
      parLevel,
      belowPar: locationNeedsAttention({
        isDefault,
        onHand: quantityOnHand,
        parOrMax: parLevel,
        min: stock.reorderPoint ?? null,
      }),
    };
  });
  const parLevel = stock.parLevel ?? null;
  const quantityOnHandTotal = Number(stock.quantityOnHandTotal ?? 0);
  return {
    inventoryItemId: stock.inventoryItemId,
    name,
    code,
    category: extras?.category ?? null,
    categoryName: extras?.categoryName ?? null,
    reorderPoint: stock.reorderPoint ?? null,
    parLevel,
    quantityOnHandTotal,
    belowPar: locations.some((l) => l.belowPar),
    locations,
  };
}

function draftsForItem(item: BranchParItem): Record<string, string> {
  const next: Record<string, string> = {};
  next[`m:${item.inventoryItemId}`] =
    item.reorderPoint == null ? '' : String(item.reorderPoint);
  for (const loc of item.locations) {
    next[`l:${item.inventoryItemId}:${loc.branchLocationId}`] =
      loc.parLevel == null ? '' : String(loc.parLevel);
  }
  return next;
}

function minDraftKey(itemId: number): string {
  return `m:${itemId}`;
}

function locDraftKey(itemId: number, locId: number): string {
  return `l:${itemId}:${locId}`;
}

export default function InventoryParLevelsPage() {
  const { token } = useAuth() as { token: string | null };
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [branchId, setBranchId] = useState<number | null>(null);
  const [officeLocations, setOfficeLocations] = useState<BranchParLocation[]>([]);
  const [locationFilter, setLocationFilter] = useState<number | 'all'>('all');
  const [items, setItems] = useState<BranchParItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [onlyBelow, setOnlyBelow] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [focusItemId, setFocusItemId] = useState<number | null>(null);
  const [openOtherId, setOpenOtherId] = useState<number | null>(null);
  const [otherOffices, setOtherOffices] = useState<Record<number, OtherOfficeLoc[]>>({});
  const [otherOfficesBusy, setOtherOfficesBusy] = useState<number | null>(null);
  const [orderQtyByItem, setOrderQtyByItem] = useState<Record<number, number>>({});
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const itemRefs = useRef<Record<number, HTMLTableRowElement | null>>({});
  const otherFetched = useRef<Record<string, true>>({});

  useEffect(() => {
    let cancelled = false;
    void listCatalogCategories(practiceId, 'inventory')
      .then((rows) => {
        if (!cancelled) setCategories(rows);
      })
      .catch(() => {
        if (!cancelled) setCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [practiceId]);

  useEffect(() => {
    let cancelled = false;
    void listPracticeBranches(practiceId)
      .then((list) => {
        if (cancelled) return;
        const active = list.filter((b) => b.isActive !== false);
        setBranches(active);
        const fromUrl = Number(searchParams.get('office'));
        let initial: number | null = null;
        if (Number.isFinite(fromUrl) && active.some((b) => b.id === fromUrl)) {
          initial = fromUrl;
        } else {
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
            initial = active.find((b) => b.isDefault)?.id ?? active[0]?.id ?? null;
          }
        }
        setBranchId(initial);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load offices');
      });
    return () => {
      cancelled = true;
    };
  }, [practiceId]);

  useEffect(() => {
    if (branchId == null) {
      setItems([]);
      setOfficeLocations([]);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError(null);
    void listBranchParLevels(practiceId, branchId)
      .then((data) => {
        if (cancelled) return;
        const locs = data.locations ?? [];
        setOfficeLocations(locs);
        setItems(data.items ?? []);
        const next: Record<string, string> = {};
        for (const item of data.items ?? []) {
          Object.assign(next, draftsForItem(item));
        }
        setDrafts(next);
        void syncStockListsFromPars(practiceId, branchId, data.items ?? [], {
          defaultLocationId: locs.find((l) => l.isDefault)?.id ?? locs[0]?.id ?? null,
          officeName: branches.find((b) => b.id === branchId)?.name ?? 'Office',
          otherOffices: branches
            .filter((b) => b.id !== branchId && b.isActive !== false)
            .map((b) => ({ branchId: b.id, name: b.name })),
        })
          .then((plan) => {
            if (cancelled) return;
            const counts: Record<number, number> = {};
            for (const row of plan.requests) {
              if (row.kind === 'order' && row.branchId === branchId) {
                counts[row.inventoryItemId] = (counts[row.inventoryItemId] ?? 0) + row.quantity;
              }
            }
            setOrderQtyByItem(counts);
          })
          .catch(() => {
            if (!cancelled) setOrderQtyByItem({});
          });
        const locParam = Number(searchParams.get('loc'));
        if (Number.isFinite(locParam) && locs.some((l) => l.id === locParam)) {
          setLocationFilter(locParam);
        }
        const itemParam = Number(searchParams.get('item'));
        if (Number.isFinite(itemParam)) {
          setFocusItemId(itemParam);
          setOpenOtherId(itemParam);
          window.requestAnimationFrame(() => {
            itemRefs.current[itemParam]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load par levels');
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [practiceId, branchId]);

  useEffect(() => {
    const q = searchQ.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    const t = window.setTimeout(() => {
      void searchItems(q, practiceId, 40)
        .then((rows) => setSearchResults(rows.filter((r) => r.itemType === 'inventory')))
        .catch(() => setSearchResults([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [practiceId, searchQ]);

  useEffect(() => {
    setOtherOffices({});
    otherFetched.current = {};
  }, [branchId]);

  useEffect(() => {
    if (openOtherId == null || branchId == null) return;
    if (branches.length === 0) return;
    const cacheKey = `${branchId}:${openOtherId}`;
    if (otherFetched.current[cacheKey]) return;
    const others = branches.filter((b) => b.id !== branchId && b.isActive !== false);
    if (others.length === 0) {
      otherFetched.current[cacheKey] = true;
      setOtherOffices((prev) => ({ ...prev, [openOtherId]: [] }));
      return;
    }
    let cancelled = false;
    setOtherOfficesBusy(openOtherId);
    void Promise.all(
      others.map(async (b) => {
        try {
          const stock = await getInventoryBranchStock(practiceId, b.id, openOtherId);
          return (stock.locations ?? []).map((loc) => ({
            branchId: b.id,
            branchName: b.name,
            branchLocationId: loc.branchLocationId,
            locationName: loc.name,
            quantityOnHand: Number(loc.quantityOnHand ?? 0),
            parLevel: loc.parLevel ?? null,
          }));
        } catch {
          return [];
        }
      })
    )
      .then((rows) => {
        if (cancelled) return;
        otherFetched.current[cacheKey] = true;
        setOtherOffices((prev) => ({ ...prev, [openOtherId]: rows.flat() }));
      })
      .finally(() => {
        if (!cancelled) setOtherOfficesBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [openOtherId, branchId, branches, practiceId]);

  const searchGroups = useStockItemGroups(searchResults, practiceId);
  const categoryNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const cat of categories) {
      map.set(String(cat.id), cat.name);
      if (cat.pimsId) {
        map.set(String(cat.pimsId), cat.name);
        const n = Number(cat.pimsId);
        if (Number.isFinite(n)) map.set(String(Math.trunc(n)), cat.name);
      }
    }
    return map;
  }, [categories]);

  const defaultLocationId = resolveDefaultLocationId(officeLocations);
  const selectedLoc =
    locationFilter === 'all'
      ? null
      : officeLocations.find((l) => l.id === locationFilter) ?? null;
  const viewingDefault =
    selectedLoc != null && selectedLoc.id === defaultLocationId;

  const visible = items.filter((item) => {
    if (locationFilter === 'all') {
      return onlyBelow ? itemNeedsAttention(item, defaultLocationId) : true;
    }
    const loc = item.locations.find((l) => l.branchLocationId === locationFilter);
    if (!loc) return !onlyBelow;
    return onlyBelow ? locNeedsAttention(item, loc, defaultLocationId) : true;
  });

  const grouped = useMemo(() => {
    const byCat = new Map<string, BranchParItem[]>();
    for (const item of visible) {
      const label = categoryLabel(item, categoryNames);
      const list = byCat.get(label) ?? [];
      list.push(item);
      byCat.set(label, list);
    }
    const keys = [...byCat.keys()].sort((a, b) => {
      if (a === UNCATEGORIZED) return 1;
      if (b === UNCATEGORIZED) return -1;
      return a.localeCompare(b);
    });
    return keys.map((category) => ({
      category,
      items: (byCat.get(category) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [visible, categoryNames]);

  const colCount = locationFilter === 'all' ? 5 : viewingDefault ? 6 : 5;

  function locOf(item: BranchParItem, locId: number): BranchParItemLocation | undefined {
    return item.locations.find((l) => l.branchLocationId === locId);
  }

  function isRowDirty(item: BranchParItem): boolean {
    const minRaw = (drafts[minDraftKey(item.inventoryItemId)] ?? '').trim();
    const minSaved = item.reorderPoint == null ? '' : String(item.reorderPoint);
    const minDirty =
      locationFilter === 'all' || viewingDefault ? minRaw !== minSaved : false;
    const locs =
      locationFilter === 'all'
        ? item.locations
        : item.locations.filter((l) => l.branchLocationId === locationFilter);
    const locDirty = locs.some((loc) => {
      const raw = (drafts[locDraftKey(item.inventoryItemId, loc.branchLocationId)] ?? '').trim();
      const saved = loc.parLevel == null ? '' : String(loc.parLevel);
      return raw !== saved;
    });
    return minDirty || locDirty;
  }

  function scrollToItem(id: number) {
    window.requestAnimationFrame(() => {
      itemRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function applySavedItem(item: BranchParItem, updated: InventoryBranchStock) {
    const next = parItemFromStock(updated, item.name, item.code, {
      category: item.category,
      categoryName: item.categoryName,
    });
    setItems((prev) =>
      prev.map((row) => (row.inventoryItemId === item.inventoryItemId ? next : row))
    );
    setDrafts((prev) => ({ ...prev, ...draftsForItem(next) }));
  }

  async function addItem(group: StockItemGroup) {
    if (branchId == null) return;
    const existing = items.find((i) => i.inventoryItemId === group.stockItemId);
    if (existing) {
      setOnlyBelow(false);
      setSearchQ('');
      setSearchResults([]);
      setFocusItemId(existing.inventoryItemId);
      scrollToItem(existing.inventoryItemId);
      setToast(`${existing.name} is already on this office — update targets below.`);
      window.setTimeout(() => setToast(null), 3000);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await upsertInventoryBranchStock(
        practiceId,
        branchId,
        group.stockItemId,
        {
          locations: officeLocations.map((loc) => ({
            branchLocationId: loc.id,
            parLevel: null,
          })),
        }
      );
      const category = categoryLookupKey(group.item?.category);
      const row = parItemFromStock(updated, group.label, group.item?.code ?? null, {
        category: category != null ? Number(category) : null,
        categoryName: category ? categoryNames.get(category) ?? null : null,
      });
      setItems((prev) => [...prev, row]);
      setDrafts((prev) => ({ ...prev, ...draftsForItem(row) }));
      setOnlyBelow(false);
      setSearchQ('');
      setSearchResults([]);
      setFocusItemId(row.inventoryItemId);
      setToast(`Added ${row.name}. Set re-order point/max on the default location and par on the others.`);
      window.setTimeout(() => setToast(null), 4000);
      scrollToItem(row.inventoryItemId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not add item');
    } finally {
      setBusy(false);
    }
  }

  async function saveItem(item: BranchParItem) {
    if (branchId == null) return;
    setSavingKey(`b:${item.inventoryItemId}`);
    setError(null);
    try {
      const locations = item.locations.map((loc) => {
        const isDefault = loc.branchLocationId === defaultLocationId;
        const raw = (drafts[locDraftKey(item.inventoryItemId, loc.branchLocationId)] ?? '').trim();
        const par = raw === '' ? null : Number(raw);
        const label = isDefault ? 'max' : 'par';
        if (raw !== '' && (par == null || !Number.isFinite(par) || par < 0)) {
          throw new Error(`${loc.name} ${label} must be a number 0 or greater`);
        }
        return { branchLocationId: loc.branchLocationId, parLevel: par, isDefault };
      });
      const minRaw = (drafts[minDraftKey(item.inventoryItemId)] ?? '').trim();
      const min = minRaw === '' ? null : Number(minRaw);
      if (minRaw !== '' && (!Number.isFinite(min) || Number(min) < 0)) {
        throw new Error('Re-order point must be a number 0 or greater');
      }
      const defaultMax = locations.find((l) => l.isDefault)?.parLevel ?? null;
      if (min != null && defaultMax != null && min > defaultMax) {
        throw new Error('Re-order point cannot be greater than max');
      }
      const updated = await upsertInventoryBranchStock(
        practiceId,
        branchId,
        item.inventoryItemId,
        {
          reorderPoint: min,
          locations: locations.map(({ branchLocationId, parLevel }) => ({
            branchLocationId,
            parLevel,
          })),
        }
      );
      applySavedItem(item, updated);
      if (branchId != null) {
        const nextItems = items.map((row) =>
          row.inventoryItemId === item.inventoryItemId
            ? parItemFromStock(updated, item.name, item.code, item)
            : row
        );
        void syncStockListsFromPars(practiceId, branchId, nextItems, {
          defaultLocationId:
            officeLocations.find((l) => l.isDefault)?.id ?? officeLocations[0]?.id ?? null,
          officeName: branches.find((b) => b.id === branchId)?.name ?? 'Office',
          otherOffices: branches
            .filter((b) => b.id !== branchId && b.isActive !== false)
            .map((b) => ({ branchId: b.id, name: b.name })),
        })
          .then((plan) => {
            const counts: Record<number, number> = {};
            for (const row of plan.requests) {
              if (row.kind === 'order' && row.branchId === branchId) {
                counts[row.inventoryItemId] = (counts[row.inventoryItemId] ?? 0) + row.quantity;
              }
            }
            setOrderQtyByItem(counts);
          })
          .catch(() => {
            /* ignore */
          });
      }
      setToast(`Saved targets for ${item.name}`);
      window.setTimeout(() => setToast(null), 2500);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save targets');
    } finally {
      setSavingKey(null);
    }
  }

  function setOffice(id: number) {
    setBranchId(id);
    setLocationFilter('all');
    setFocusItemId(null);
    setSearchParams({}, { replace: true });
    try {
      localStorage.setItem(`${BRANCH_STORAGE_PREFIX}${practiceId}`, String(id));
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="settings-section">
      <p className="settings-section-description">
        Other locations have a <strong>par</strong> (ideal on-hand). The default location has
        a <strong>re-order point</strong> (when to buy) and a <strong>max</strong> (order up to). Shorts
        at other locations go to the fill list. Surplus above par or max feeds the transfer
        list first; leftover need comes from the default location. That item goes on the
        order list only when default on-hand is then at or below the re-order point. Short of
        par or at the re-order point is red; over target is green.
      </p>
      {toast && (
        <div className="settings-message settings-success-message" style={{ marginBottom: 12 }}>
          {toast}
        </div>
      )}
      {error && (
        <div className="settings-message settings-error-message" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12, alignItems: 'end' }}>
        <label className="settings-label">
          Office
          <select
            className="settings-input"
            style={{ minWidth: 260 }}
            value={branchId ?? ''}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) setOffice(v);
            }}
          >
            {!branches.length && <option value="">No offices</option>}
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-checkbox-item" style={{ marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={onlyBelow}
            onChange={(e) => setOnlyBelow(e.target.checked)}
          />
          <span>Only needs fill or order</span>
        </label>
        <Link className="btn secondary" to="/schedule/inventory/fill-list">
          Fill list
        </Link>
        <Link className="btn secondary" to="/schedule/inventory/order-list">
          Order list
        </Link>
        <Link className="btn secondary" to="/schedule/inventory/transfer-list">
          Transfer list
        </Link>
      </div>

      <div className="par-loc-chips" role="tablist" aria-label="Locations">
        <button
          type="button"
          className={`par-loc-chip${locationFilter === 'all' ? ' par-loc-chip--active' : ''}`}
          onClick={() => setLocationFilter('all')}
        >
          All
        </button>
        {officeLocations.map((loc) => (
          <button
            key={loc.id}
            type="button"
            className={`par-loc-chip${locationFilter === loc.id ? ' par-loc-chip--active' : ''}`}
            onClick={() => setLocationFilter(loc.id)}
          >
            {loc.name}
            {loc.isDefault ? ' (default)' : ''}
          </button>
        ))}
      </div>

      <div className="settings-card" style={{ marginBottom: 16, padding: 12 }}>
        <label className="settings-label">
          Add item to this office
          <input
            className="settings-input"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search stock item name"
            disabled={branchId == null || busy}
          />
        </label>
        {searchGroups.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
            {searchGroups.slice(0, 8).map((g) => {
              const already = items.some((i) => i.inventoryItemId === g.stockItemId);
              return (
                <li key={`stock-${g.stockItemId}`}>
                  <button
                    type="button"
                    className="btn secondary"
                    style={{ width: '100%', textAlign: 'left', marginBottom: 4 }}
                    disabled={busy}
                    onClick={() => void addItem(g)}
                  >
                    <span style={{ display: 'block' }}>{g.label}</span>
                    <span style={{ display: 'block', fontSize: 12, opacity: 0.75 }}>
                      {already
                        ? 'Already on this office — open to edit'
                        : 'Add and set re-order point, max, and location pars'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {busy && items.length === 0 && <p className="settings-muted">Loading…</p>}
      {!busy && visible.length === 0 && (
        <p className="settings-muted">
          {onlyBelow
            ? 'Nothing needs a fill or order here. Uncheck the filter, or add an item above.'
            : items.length === 0
              ? 'No items on this office yet. Search above to add one.'
              : 'No matching items.'}
        </p>
      )}
      {grouped.length > 0 && (
        <div className="settings-table-container">
          <table className="settings-table par-levels-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>{locationFilter === 'all' ? 'Office on hand' : 'On hand'}</th>
                {locationFilter === 'all' ? (
                  <th>Locations</th>
                ) : viewingDefault ? (
                  <>
                    <th>Re-order point</th>
                    <th>Max</th>
                    <th>Status</th>
                  </>
                ) : (
                  <>
                    <th>Par</th>
                    <th>Short</th>
                  </>
                )}
                {locationFilter === 'all' && <th>On order list</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {grouped.map((group) => (
                <Fragment key={group.category}>
                  <tr className="par-levels-cat">
                    <td colSpan={colCount}>{group.category}</td>
                  </tr>
                  {group.items.map((item) => {
                    const locRow = selectedLoc ? locOf(item, selectedLoc.id) : null;
                    const onHand =
                      locationFilter === 'all'
                        ? item.quantityOnHandTotal
                        : (locRow?.quantityOnHand ?? 0);
                    const below =
                      locationFilter === 'all'
                        ? itemNeedsAttention(item, defaultLocationId)
                        : locRow
                          ? locNeedsAttention(item, locRow, defaultLocationId)
                          : false;
                    const dirty = isRowDirty(item);
                    const saving = savingKey === `b:${item.inventoryItemId}`;
                    const otherOpen = openOtherId === item.inventoryItemId;
                    const otherRows = otherOffices[item.inventoryItemId] ?? [];
                    const otherLoading = otherOfficesBusy === item.inventoryItemId;
                    const need =
                      locRow != null && locRow.branchLocationId !== defaultLocationId
                        ? (shortBy(locRow.quantityOnHand, locRow.parLevel) ?? 0)
                        : officeFillShortTotal(item, defaultLocationId);
                    const cover = otherRows.find((r) => {
                      const extra = surplusBy(r.quantityOnHand, r.parLevel);
                      return need > 0 && extra != null && extra >= need;
                    });
                    const anyExtra = otherRows.some(
                      (r) => surplusBy(r.quantityOnHand, r.parLevel) != null
                    );
                    return (
                      <Fragment key={item.inventoryItemId}>
                        <tr
                          ref={(el) => {
                            itemRefs.current[item.inventoryItemId] = el;
                          }}
                          className={[
                            focusItemId === item.inventoryItemId ? 'par-levels-row--focus' : '',
                            below ? 'par-levels-row--below' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          <td>
                            <strong>{item.name}</strong>
                            {item.code ? (
                              <div className="settings-muted" style={{ fontSize: 12 }}>
                                {item.code}
                              </div>
                            ) : null}
                          </td>
                          <td>{onHand}</td>
                          {locationFilter === 'all' ? (
                            <td className="par-loc-cell">
                              <div className="par-loc-grid" role="table">
                                <div className="par-loc-grid__head" role="row">
                                  <div className="par-loc-grid__h" role="columnheader">
                                    Location
                                  </div>
                                  <div className="par-loc-grid__h" role="columnheader">
                                    On hand
                                  </div>
                                  <div className="par-loc-grid__h" role="columnheader">
                                    Re-order
                                  </div>
                                  <div className="par-loc-grid__h" role="columnheader">
                                    Max / Par
                                  </div>
                                  <div className="par-loc-grid__h" role="columnheader">
                                    Status
                                  </div>
                                </div>
                                {item.locations.map((loc) => {
                                  const isDefault = loc.branchLocationId === defaultLocationId;
                                  return (
                                    <div
                                      key={loc.branchLocationId}
                                      className="par-loc-grid__row"
                                      role="row"
                                    >
                                      <div role="cell">
                                        {loc.name}
                                        {isDefault ? (
                                          <span className="settings-muted"> (default)</span>
                                        ) : null}
                                      </div>
                                      <div role="cell">{loc.quantityOnHand}</div>
                                      <div role="cell">
                                        {isDefault ? (
                                          <input
                                            className="settings-input par-levels-input"
                                            inputMode="decimal"
                                            autoFocus={
                                              focusItemId === item.inventoryItemId
                                            }
                                            value={
                                              drafts[minDraftKey(item.inventoryItemId)] ?? ''
                                            }
                                            onChange={(e) =>
                                              setDrafts((prev) => ({
                                                ...prev,
                                                [minDraftKey(item.inventoryItemId)]:
                                                  e.target.value,
                                              }))
                                            }
                                            placeholder="—"
                                            aria-label={`${item.name} re-order point`}
                                          />
                                        ) : (
                                          <span className="settings-muted">—</span>
                                        )}
                                      </div>
                                      <div role="cell">
                                        <input
                                          className="settings-input par-levels-input"
                                          inputMode="decimal"
                                          value={
                                            drafts[
                                              locDraftKey(
                                                item.inventoryItemId,
                                                loc.branchLocationId
                                              )
                                            ] ?? ''
                                          }
                                          onChange={(e) =>
                                            setDrafts((prev) => ({
                                              ...prev,
                                              [locDraftKey(
                                                item.inventoryItemId,
                                                loc.branchLocationId
                                              )]: e.target.value,
                                            }))
                                          }
                                          placeholder="—"
                                          aria-label={
                                            isDefault
                                              ? `${item.name} max`
                                              : `${item.name} ${loc.name} par`
                                          }
                                        />
                                      </div>
                                      <div role="cell">
                                        <LocationStatus
                                          loc={loc}
                                          isDefault={isDefault}
                                          min={item.reorderPoint}
                                        />
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </td>
                          ) : viewingDefault && locRow ? (
                            <>
                              <td>
                                <input
                                  className="settings-input par-levels-input"
                                  inputMode="decimal"
                                  autoFocus={focusItemId === item.inventoryItemId}
                                  value={drafts[minDraftKey(item.inventoryItemId)] ?? ''}
                                  onChange={(e) =>
                                    setDrafts((prev) => ({
                                      ...prev,
                                      [minDraftKey(item.inventoryItemId)]: e.target.value,
                                    }))
                                  }
                                  placeholder="—"
                                  aria-label={`${item.name} re-order point`}
                                />
                              </td>
                              <td>
                                <input
                                  className="settings-input par-levels-input"
                                  inputMode="decimal"
                                  value={
                                    drafts[locDraftKey(item.inventoryItemId, locRow.branchLocationId)] ??
                                    ''
                                  }
                                  onChange={(e) =>
                                    setDrafts((prev) => ({
                                      ...prev,
                                      [locDraftKey(item.inventoryItemId, locRow.branchLocationId)]:
                                        e.target.value,
                                    }))
                                  }
                                  placeholder="—"
                                  aria-label={`${item.name} max`}
                                />
                              </td>
                              <td>
                                <LocationStatus
                                  loc={locRow}
                                  isDefault
                                  min={item.reorderPoint}
                                />
                              </td>
                            </>
                          ) : (
                            <>
                              <td>
                                <input
                                  className="settings-input par-levels-input"
                                  inputMode="decimal"
                                  autoFocus={focusItemId === item.inventoryItemId}
                                  value={
                                    selectedLoc
                                      ? (drafts[locDraftKey(item.inventoryItemId, selectedLoc.id)] ??
                                        '')
                                      : ''
                                  }
                                  onChange={(e) => {
                                    if (!selectedLoc) return;
                                    setDrafts((prev) => ({
                                      ...prev,
                                      [locDraftKey(item.inventoryItemId, selectedLoc.id)]:
                                        e.target.value,
                                    }));
                                  }}
                                  placeholder="—"
                                  aria-label={`${item.name} ${selectedLoc?.name ?? ''} par`}
                                />
                              </td>
                              <td>
                                {locRow ? (
                                  <LocationStatus
                                    loc={locRow}
                                    isDefault={false}
                                    min={item.reorderPoint}
                                  />
                                ) : (
                                  <span className="settings-muted">—</span>
                                )}
                              </td>
                            </>
                          )}
                          {locationFilter === 'all' && (
                            <td>
                              {orderQtyByItem[item.inventoryItemId] ? (
                                orderQtyByItem[item.inventoryItemId]
                              ) : (
                                <span className="settings-muted">—</span>
                              )}
                            </td>
                          )}
                          <td>
                            <div
                              className={
                                locationFilter === 'all'
                                  ? 'par-row-actions par-row-actions--stack'
                                  : 'par-row-actions'
                              }
                            >
                              <button
                                type="button"
                                className="btn primary"
                                disabled={saving || !dirty}
                                onClick={() => void saveItem(item)}
                              >
                                {saving ? 'Saving…' : 'Save'}
                              </button>
                              <button
                                type="button"
                                className="btn secondary"
                                onClick={() =>
                                  setOpenOtherId((prev) =>
                                    prev === item.inventoryItemId ? null : item.inventoryItemId
                                  )
                                }
                              >
                                {otherOpen ? 'Hide' : 'Other stock'}
                              </button>
                            </div>
                          </td>
                        </tr>
                        {otherOpen && (
                          <tr>
                            <td colSpan={colCount}>
                              {locationFilter !== 'all' ? (
                                <>
                                  <div className="settings-muted" style={{ marginBottom: 8, fontSize: 13 }}>
                                    Locations for this product at this office
                                  </div>
                                  <table className="settings-table par-loc-table">
                                    <thead>
                                      <tr>
                                        <th>Location</th>
                                        <th>On hand</th>
                                        <th>Re-order point</th>
                                        <th>Max / Par</th>
                                        <th>Status</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {item.locations.map((loc) => {
                                        const isDefault = loc.branchLocationId === defaultLocationId;
                                        return (
                                          <tr key={loc.branchLocationId}>
                                            <td>
                                              {loc.name}
                                              {isDefault ? ' (default)' : ''}
                                            </td>
                                            <td>{loc.quantityOnHand}</td>
                                            <td>
                                              {isDefault ? (
                                                <input
                                                  className="settings-input par-levels-input"
                                                  inputMode="decimal"
                                                  value={drafts[minDraftKey(item.inventoryItemId)] ?? ''}
                                                  onChange={(e) =>
                                                    setDrafts((prev) => ({
                                                      ...prev,
                                                      [minDraftKey(item.inventoryItemId)]: e.target.value,
                                                    }))
                                                  }
                                                  placeholder="—"
                                                  aria-label={`${item.name} re-order point`}
                                                />
                                              ) : (
                                                <span className="settings-muted">—</span>
                                              )}
                                            </td>
                                            <td>
                                              <input
                                                className="settings-input par-levels-input"
                                                inputMode="decimal"
                                                value={
                                                  drafts[
                                                    locDraftKey(item.inventoryItemId, loc.branchLocationId)
                                                  ] ?? ''
                                                }
                                                onChange={(e) =>
                                                  setDrafts((prev) => ({
                                                    ...prev,
                                                    [locDraftKey(item.inventoryItemId, loc.branchLocationId)]:
                                                      e.target.value,
                                                  }))
                                                }
                                                placeholder="—"
                                                aria-label={`${item.name} ${isDefault ? 'max' : loc.name + ' par'}`}
                                              />
                                            </td>
                                            <td>
                                              <LocationStatus
                                                loc={loc}
                                                isDefault={isDefault}
                                                min={item.reorderPoint}
                                              />
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </>
                              ) : null}
                              <div style={{ marginTop: locationFilter === 'all' ? 0 : 16 }}>
                                <div className="settings-muted" style={{ marginBottom: 8, fontSize: 13 }}>
                                  Other offices — check whether a transfer could cover a short
                                </div>
                                {cover ? (
                                  <p className="par-transfer-hint">
                                    Transfer could work: {cover.branchName} ({cover.locationName}) has{' '}
                                    {surplusBy(cover.quantityOnHand, cover.parLevel)} above par — enough
                                    to cover the short of {need}.
                                  </p>
                                ) : need > 0 && anyExtra ? (
                                  <p className="par-transfer-hint par-transfer-hint--partial">
                                    Other offices have stock above par. A transfer may cover part of
                                    the short of {need}.
                                  </p>
                                ) : null}
                                {otherLoading && !otherOffices[item.inventoryItemId] ? (
                                  <div className="settings-muted">Checking other offices…</div>
                                ) : otherRows.length === 0 ? (
                                  <div className="settings-muted">
                                    No other offices to compare, or their locations could not be
                                    loaded.
                                  </div>
                                ) : (
                                  <table className="settings-table">
                                    <thead>
                                      <tr>
                                        <th>Office</th>
                                        <th>Location</th>
                                        <th>On hand</th>
                                        <th>Par / Max</th>
                                        <th>Available</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {otherRows.map((row) => {
                                        const extra = surplusBy(row.quantityOnHand, row.parLevel);
                                        const otherShort = shortBy(row.quantityOnHand, row.parLevel);
                                        const covers = need > 0 && extra != null && extra >= need;
                                        return (
                                          <tr
                                            key={`${row.branchId}:${row.branchLocationId}`}
                                            className={covers ? 'par-other-row--cover' : undefined}
                                          >
                                            <td>{row.branchName}</td>
                                            <td>{row.locationName}</td>
                                            <td>{row.quantityOnHand}</td>
                                            <td>{row.parLevel != null ? row.parLevel : '—'}</td>
                                            <td>
                                              {extra != null ? (
                                                <span className="par-surplus">above par {extra}</span>
                                              ) : otherShort != null ? (
                                                <span className="par-short">short {otherShort}</span>
                                              ) : row.quantityOnHand > 0 && row.parLevel == null ? (
                                                <span className="settings-muted">
                                                  {row.quantityOnHand} on hand (no par)
                                                </span>
                                              ) : (
                                                '—'
                                              )}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
