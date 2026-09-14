import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../auth/useAuth';
import {
  bulkPatchOnlineStoreItems,
  confirmEcwidMaps,
  addOnlineStoreVariant,
  createOnlineStoreProduct,
  importEcwidCatalog,
  listEcwidMaps,
  listOnlineStoreItems,
  listOnlineStoreListings,
  listStoreCoupons,
  createStoreCategory,
  listStoreCategories,
  patchEcwidMap,
  patchOnlineStoreItem,
  patchOnlineStoreListing,
  removeOnlineStoreVariant,
  saveStoreCoupon,
  searchStoreInventory,
  storeMasterImageUrl,
  storeProductImageUrl,
  uploadOnlineStoreListingImage,
  type EcwidMapMatch,
  type EcwidMapRow,
  type StoreAdminListing,
  type StoreAdminVariant,
  type StoreCoupon,
  type StoreItemRow,
  type StoreSaleType,
} from '../api/onlineStore';
import { uploadInventoryItemImage } from '../api/inventoryTools';
import { appConfirm, appPrompt } from '../utils/appDialog';
import StoreDescriptionEditor from './store/StoreDescriptionEditor';
import './Settings.css';
import './Catalog.css';

type StoreAdminTab = 'items' | 'coupons' | 'import';

function matchType(match: Pick<EcwidMapMatch, 'catalogItemType'>): 'inventory' | 'procedure' {
  return match.catalogItemType === 'procedure' ? 'procedure' : 'inventory';
}

function matchKey(match: Pick<EcwidMapMatch, 'inventoryItemId' | 'catalogItemType'>): string {
  return `${matchType(match)}:${match.inventoryItemId}`;
}

const AUTOSHIP_FREQS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'every_6_months', label: 'Every 6 months' },
  { value: 'yearly', label: 'Yearly' },
];

function StoreCategorySelect({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string;
  options: string[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const names = [...new Set([value, ...options].filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
  return (
    <select
      className="settings-input"
      value={value}
      disabled={disabled}
      onChange={(e) => {
        const next = e.target.value;
        if (next === '__new__') {
          void appPrompt({
            title: 'New store category',
            message: 'Use a slash for a subcategory, like Heartworm / Chewables.',
            placeholder: 'Category name',
          }).then((typed) => {
            const name = typed?.trim() || '';
            if (name) onChange(name);
          });
          return;
        }
        onChange(next);
      }}
    >
      <option value="">No category</option>
      {names.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
      <option value="__new__">Add new category…</option>
    </select>
  );
}

function StoreProductDefaults({
  approvalTag,
  featuredOnHome,
  storeCategory,
  categoryOptions,
  disabled,
  onApproval,
  onHighlight,
  onCategory,
  onCategoryCommit,
}: {
  approvalTag: StoreItemRow['approvalTag'];
  featuredOnHome: boolean;
  storeCategory: string;
  categoryOptions: string[];
  disabled?: boolean;
  onApproval: (value: StoreItemRow['approvalTag']) => void;
  onHighlight: (value: boolean) => void;
  onCategory: (value: string) => void;
  onCategoryCommit?: (value: string) => void;
}) {
  return (
    <div className="store-add-workspace__defaults">
      <label className="store-add-workspace__field">
        <span>Store category</span>
        <StoreCategorySelect
          value={storeCategory}
          options={categoryOptions}
          disabled={disabled}
          onChange={(value) => {
            onCategory(value);
            onCategoryCommit?.(value);
          }}
        />
      </label>
      <label className="store-add-workspace__field">
        <span>Approval default</span>
        <select
          className="settings-input"
          value={approvalTag}
          disabled={disabled}
          onChange={(e) => onApproval(e.target.value as StoreItemRow['approvalTag'])}
        >
          <option value="approved">Approved</option>
          <option value="needs_doctor_approval">Needs doctor approval</option>
        </select>
      </label>
      <label className="store-add-workspace__check">
        <input
          type="checkbox"
          checked={featuredOnHome}
          disabled={disabled}
          onChange={(e) => onHighlight(e.target.checked)}
        />
        {featuredOnHome ? 'On the home page' : 'Not on the home page'}
      </label>
    </div>
  );
}

type StoreSaleFields = {
  saleType: StoreSaleType | null;
  saleValue: number | null;
  saleEndsAt: string | null;
};

function saleFieldsFromListing(listing: Pick<StoreAdminListing, 'saleType' | 'saleValue' | 'saleEndsAt'>): StoreSaleFields {
  return {
    saleType: listing.saleType === 'amount' || listing.saleType === 'percent' ? listing.saleType : null,
    saleValue: listing.saleValue != null ? Number(listing.saleValue) : null,
    saleEndsAt: listing.saleEndsAt || null,
  };
}

function StoreSaleEditor({
  saleType,
  saleValue,
  saleEndsAt,
  saleActive,
  disabled,
  onChange,
}: StoreSaleFields & {
  saleActive?: boolean;
  disabled?: boolean;
  onChange: (next: StoreSaleFields) => void;
}) {
  const [valueDraft, setValueDraft] = useState(saleValue);
  const [endsDraft, setEndsDraft] = useState(saleEndsAt);
  useEffect(() => {
    setValueDraft(saleValue);
    setEndsDraft(saleEndsAt);
  }, [saleType, saleValue, saleEndsAt]);

  return (
    <div className="store-sale-editor">
      <label className="store-add-workspace__field">
        <span>Sale</span>
        <select
          className="settings-input"
          value={saleType || ''}
          disabled={disabled}
          onChange={(e) => {
            const nextType = (e.target.value || null) as StoreSaleType | null;
            onChange({
              saleType: nextType,
              saleValue: nextType ? valueDraft : null,
              saleEndsAt: nextType ? endsDraft : null,
            });
          }}
        >
          <option value="">Off</option>
          <option value="amount">$ off</option>
          <option value="percent">% off</option>
        </select>
      </label>
      {saleType ? (
        <>
          <label className="store-add-workspace__field store-sale-editor__value">
            <span>{saleType === 'amount' ? 'Amount off' : 'Percent off'}</span>
            <input
              className="settings-input"
              type="number"
              min={0}
              step={saleType === 'percent' ? 1 : 0.01}
              value={valueDraft ?? ''}
              disabled={disabled}
              onChange={(e) =>
                setValueDraft(e.target.value === '' ? null : Number(e.target.value))
              }
              onBlur={() =>
                onChange({
                  saleType,
                  saleValue: valueDraft,
                  saleEndsAt: endsDraft,
                })
              }
            />
          </label>
          <label className="store-add-workspace__field">
            <span>Ends</span>
            <input
              className="settings-input"
              type="date"
              value={endsDraft || ''}
              disabled={disabled}
              onChange={(e) => {
                const nextEnds = e.target.value || null;
                setEndsDraft(nextEnds);
                onChange({
                  saleType,
                  saleValue: valueDraft,
                  saleEndsAt: nextEnds,
                });
              }}
            />
          </label>
          {saleActive ? <span className="store-sale-editor__badge">SALE</span> : null}
        </>
      ) : null}
    </div>
  );
}

function masterImageSrc(
  practiceId: number,
  listing: Pick<StoreAdminListing, 'imageProductId'>
): string | null {
  return listing.imageProductId
    ? storeMasterImageUrl(practiceId, listing.imageProductId)
    : null;
}

function variantImageSrc(
  practiceId: number,
  variant: Pick<StoreAdminVariant, 'inventoryItemId' | 'hasImage'>
): string | null {
  return variant.hasImage && variant.inventoryItemId
    ? storeProductImageUrl(practiceId, variant.inventoryItemId)
    : null;
}

function withImageBust(url: string | null, bust?: number): string | null {
  if (!url) return null;
  return bust ? `${url}${url.includes('?') ? '&' : '?'}t=${bust}` : url;
}

function StoreThumb({
  src,
  label,
  size = 'sm',
}: {
  src: string | null;
  label: string;
  size?: 'sm' | 'lg';
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [src]);
  const show = Boolean(src) && !broken;
  return show ? (
    <img
      className={`store-add-workspace__thumb store-add-workspace__thumb--${size}`}
      src={src ?? ''}
      alt=""
      onError={() => setBroken(true)}
    />
  ) : (
    <span
      className={`store-add-workspace__thumb store-add-workspace__thumb--${size} store-add-workspace__thumb--empty`}
      aria-label={`${label} has no photo`}
    >
      {size === 'lg' ? 'No photo' : ''}
    </span>
  );
}

function StorePhotoUpload({
  src,
  label,
  size = 'sm',
  disabled,
  title,
  onFile,
}: {
  src: string | null;
  label: string;
  size?: 'sm' | 'lg';
  disabled?: boolean;
  title?: string;
  onFile: (file: File) => void;
}) {
  return (
    <label className="store-photo-upload" title={title || `Upload photo for ${label}`}>
      <StoreThumb src={src} label={label} size={size} />
      <input
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        hidden
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file);
        }}
      />
    </label>
  );
}

function AutoshipControls({
  frequency,
  disabled,
  onChange,
}: {
  frequency: string | null | undefined;
  disabled?: boolean;
  onChange: (frequency: string | null) => void;
}) {
  const on = Boolean(frequency);
  return (
    <label className="store-add-workspace__autoship">
      <input
        type="checkbox"
        disabled={disabled}
        checked={on}
        onChange={(e) => onChange(e.target.checked ? frequency || 'monthly' : null)}
      />
      {on ? (
        <select
          className="settings-input"
          disabled={disabled}
          value={frequency || 'monthly'}
          onChange={(e) => onChange(e.target.value)}
        >
          {AUTOSHIP_FREQS.map((freq) => (
            <option key={freq.value} value={freq.value}>
              {freq.label}
            </option>
          ))}
        </select>
      ) : (
        <span className="settings-muted">Autoship</span>
      )}
    </label>
  );
}

function packRank(pack: string): number {
  const order = ['Individual tablet', 'Bottle of 30', 'Bottle of 60', 'Bottle of 90', 'Bottle of 100'];
  const idx = order.findIndex((label) => pack.startsWith(label));
  if (idx >= 0) return idx;
  const n = Number((pack.match(/\d+/) || [])[0]);
  return Number.isFinite(n) ? 50 + n : 99;
}

function strengthGroupKey(strength: string | null): string {
  const n = parseFloat(strength || '');
  if (Number.isFinite(n)) return String(n);
  return (strength || '').trim().toLowerCase() || 'each';
}

function groupVariantsByStrength(variants: StoreAdminVariant[]) {
  const sorted = [...variants].sort((a, b) => {
    const strengthA = parseFloat(a.strength || '') || 999;
    const strengthB = parseFloat(b.strength || '') || 999;
    if (strengthA !== strengthB) return strengthA - strengthB;
    return packRank(a.pack) - packRank(b.pack);
  });
  const groups = new Map<string, StoreAdminVariant[]>();
  for (const variant of sorted) {
    const key = strengthGroupKey(variant.strength);
    const list = groups.get(key) ?? [];
    list.push(variant);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([key, rows]) => ({
    key,
    strength: rows.find((row) => row.strength)?.strength ?? null,
    variants: rows,
  }));
}

const STORE_ITEMS_PAGE_SIZE = 50;

function listingMatchesSearch(listing: StoreAdminListing, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    listing.name,
    listing.description,
    listing.storeCategory,
    ...listing.variants.flatMap((variant) => [
      variant.name,
      variant.code,
      variant.pack,
      variant.strength,
    ]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

function variantDisplayName(variant: StoreAdminVariant): string {
  const name = String(variant.name || '').replace(/\s+/g, ' ').trim();
  if (name) return name;
  return [variant.strength, variant.pack].filter(Boolean).join(' · ') || 'Item';
}

function storeItemsPath(listingId?: string | null, adding = false) {
  const params = new URLSearchParams();
  params.set('tab', 'items');
  if (listingId) params.set('product', listingId);
  else if (adding) params.set('add', '1');
  return `/schedule/inventory/online-store?${params.toString()}`;
}

function withReturnTo(href: string, returnTo: string) {
  const url = new URL(href, 'https://local.invalid');
  url.searchParams.set('returnTo', returnTo);
  return `${url.pathname}${url.search}`;
}

function storeVariantHref(
  variant: StoreAdminVariant,
  returnTo?: string | null
): string | null {
  let href: string | null = null;
  if (variant.procedureId && variant.catalogItemType === 'procedure') {
    href = `/schedule/inventory/items?itemId=${variant.procedureId}&itemType=procedure&name=${encodeURIComponent(variant.name)}`;
  } else if (variant.inventoryItemId) {
    href = `/schedule/inventory/items?itemId=${variant.inventoryItemId}&name=${encodeURIComponent(variant.name)}`;
  }
  return href && returnTo ? withReturnTo(href, returnTo) : href;
}

function matchesOf(row: EcwidMapRow): EcwidMapMatch[] {
  if (row.matches?.length) return row.matches;
  if (row.inventoryItemId && row.matchName) {
    return [
      {
        inventoryItemId: row.inventoryItemId,
        catalogItemType: 'inventory',
        name: row.matchName,
        code: row.matchCode,
      },
    ];
  }
  return [];
}

function decodeJwtPayload(token: string | null): Record<string, unknown> | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

function apiErrorMessage(e: unknown): string {
  const res = (e as { response?: { data?: { message?: string | string[] } } })?.response;
  const message = res?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  if (message) return message;
  return e instanceof Error ? e.message : 'Request failed';
}

function practiceIdFromAuth(token: string | null): number {
  const p = decodeJwtPayload(token);
  const raw = p?.practiceId ?? p?.practice_id;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  return Number(import.meta.env.VITE_PRACTICE_ID) || 1;
}

export default function OnlineStoreImportPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const practiceId = practiceIdFromAuth(token);
  const [maps, setMaps] = useState<EcwidMapRow[]>([]);
  const [items, setItems] = useState<StoreItemRow[]>([]);
  const [listings, setListings] = useState<StoreAdminListing[]>([]);
  const [managedCategories, setManagedCategories] = useState<string[]>([]);
  const [coupons, setCoupons] = useState<StoreCoupon[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [tab, setTab] = useState<StoreAdminTab>('items');
  const [unmatchedOnly, setUnmatchedOnly] = useState(false);
  const [matchingId, setMatchingId] = useState<number | null>(null);
  const [addStoreOpen, setAddStoreOpen] = useState(false);
  const [workspaceListing, setWorkspaceListing] = useState<StoreAdminListing | null>(null);
  const [itemQuery, setItemQuery] = useState('');
  const [itemPage, setItemPage] = useState(1);
  const [imageTick, setImageTick] = useState(0);

  const load = async () => {
    const [m, i, listingsRows, c, cats] = await Promise.all([
      listEcwidMaps(practiceId),
      listOnlineStoreItems(practiceId),
      listOnlineStoreListings(practiceId),
      listStoreCoupons(practiceId),
      listStoreCategories(practiceId).catch(() => []),
    ]);
    setMaps(m);
    setItems(i);
    setListings(listingsRows);
    setCoupons(c);
    setManagedCategories(cats.map((row) => row.name));
    const next: Record<number, boolean> = {};
    for (const row of m) {
      if (matchesOf(row).length && row.status !== 'skipped') next[row.id] = true;
    }
    setSelected(next);
  };

  useEffect(() => {
    void load().catch((e) => setError(apiErrorMessage(e)));
  }, [practiceId]);

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'items' || tabParam === 'import' || tabParam === 'coupons') {
      setTab(tabParam);
    }
    if (!listings.length) return;
    const product = searchParams.get('product');
    if (product) {
      const listing = listings.find((row) => row.listingId === product);
      if (!listing) return;
      setAddStoreOpen(true);
      setWorkspaceListing(listing);
      return;
    }
    if (searchParams.get('add') === '1') {
      setAddStoreOpen(true);
    }
  }, [listings, searchParams]);

  const writeItemsParams = (next: { product?: string | null; add?: boolean }) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', 'items');
    if (next.product) {
      params.set('product', next.product);
      params.delete('add');
    } else {
      params.delete('product');
      if (next.add) params.set('add', '1');
      else params.delete('add');
    }
    setSearchParams(params, { replace: true });
  };

  const uploadListingPhoto = async (listing: StoreAdminListing, file: File) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await uploadOnlineStoreListingImage(
        practiceId,
        listing.listingId,
        file
      );
      if (updated) {
        setListings((prev) =>
          prev.map((row) =>
            row.listingId === listing.listingId
              ? { ...row, ...updated, variants: updated.variants ?? row.variants }
              : row
          )
        );
        setWorkspaceListing((prev) =>
          prev?.listingId === listing.listingId
            ? { ...prev, ...updated, variants: updated.variants ?? prev.variants }
            : prev
        );
      }
      setImageTick((tick) => tick + 1);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const uploadVariantPhoto = async (
    listing: StoreAdminListing,
    variant: StoreAdminVariant,
    file: File
  ) => {
    if (!variant.inventoryItemId) return;
    setBusy(true);
    setError(null);
    try {
      await uploadInventoryItemImage(practiceId, variant.inventoryItemId, file);
      setListings((prev) =>
        prev.map((row) =>
          row.listingId === listing.listingId
            ? {
                ...row,
                hasImage: true,
                imageInventoryItemId: row.imageInventoryItemId ?? variant.inventoryItemId,
                variants: row.variants.map((item) =>
                  item.inventoryItemId === variant.inventoryItemId
                    ? { ...item, hasImage: true }
                    : item
                ),
              }
            : row
        )
      );
      setWorkspaceListing((prev) =>
        prev?.listingId === listing.listingId
          ? {
              ...prev,
              hasImage: true,
              variants: prev.variants.map((item) =>
                item.inventoryItemId === variant.inventoryItemId
                  ? { ...item, hasImage: true }
                  : item
              ),
            }
          : prev
      );
      setImageTick((tick) => tick + 1);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const selectedIds = useMemo(
    () => maps.filter((m) => selected[m.id] && matchesOf(m).length).map((m) => m.id),
    [maps, selected]
  );

  const visibleMaps = useMemo(
    () => (unmatchedOnly ? maps.filter((m) => !matchesOf(m).length) : maps),
    [maps, unmatchedOnly]
  );

  const removeVariant = async (
    listing: StoreAdminListing,
    variant: StoreAdminVariant
  ) => {
    const label = [variantDisplayName(variant), variant.pack].filter(Boolean).join(' · ');
    const last = listing.variants.length <= 1;
    const ok = await appConfirm({
      title: 'Are you sure?',
      message: last
        ? `Remove ${label || listing.name} from the online store?\n\nThis is the only option, so shoppers will not see the product. The Scout inventory stays. You can add it again with + Add store item.`
        : `Remove ${label} from ${listing.name}?\n\nShoppers will not see this option. The Scout inventory stays.`,
      confirmLabel: last ? 'Yes, remove from store' : 'Yes, remove this option',
      cancelLabel: 'Keep on store',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await removeOnlineStoreVariant(practiceId, listing.listingId, {
        inventoryItemId: variant.inventoryItemId,
        procedureId: variant.procedureId,
      });
      if (updated) {
        setListings((prev) =>
          prev.map((row) => (row.listingId === listing.listingId ? { ...row, ...updated } : row))
        );
      } else {
        setListings((prev) => prev.filter((row) => row.listingId !== listing.listingId));
      }
      setFlash(last ? `${listing.name} was removed from the store.` : `Removed ${label}.`);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const patchVariantAutoship = async (
    listing: StoreAdminListing,
    variant: StoreAdminVariant,
    recommendedFrequency: string | null
  ) => {
    if (!variant.inventoryItemId) return;
    setBusy(true);
    setError(null);
    try {
      await patchOnlineStoreItem(practiceId, variant.inventoryItemId, {
        recommendedFrequency,
      });
      setListings((prev) =>
        prev.map((row) =>
          row.listingId === listing.listingId
            ? {
                ...row,
                variants: row.variants.map((item) =>
                  item.inventoryItemId === variant.inventoryItemId
                    ? { ...item, recommendedFrequency }
                    : item
                ),
              }
            : row
        )
      );
      setItems((prev) =>
        prev.map((item) =>
          item.inventoryItemId === variant.inventoryItemId
            ? { ...item, recommendedFrequency }
            : item
        )
      );
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const removeFromStore = async (listing: StoreAdminListing) => {
    const ok = await appConfirm({
      title: 'Are you sure?',
      message: `Remove ${listing.name} from the online store?\n\nShoppers will not see this product. The Scout inventory stays. You can add it again with + Add store item.`,
      confirmLabel: 'Yes, remove from store',
      cancelLabel: 'Keep on store',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await patchOnlineStoreListing(practiceId, listing.listingId, { listed: false });
      setListings((prev) => prev.filter((row) => row.listingId !== listing.listingId));
      setFlash(`${listing.name} is hidden from the store.`);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const removeFromList = async (row: EcwidMapRow) => {
    const ok = await appConfirm({
      title: 'Remove from list?',
      message: `Hide ${row.ecwidName} from this matching list? A later CSV import will not bring it back.`,
      confirmLabel: 'Remove from list',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await patchEcwidMap(practiceId, row.id, { excluded: true });
      setMaps((prev) => prev.filter((m) => m.id !== row.id));
      setSelected((s) => {
        const next = { ...s };
        delete next[row.id];
        return next;
      });
      if (matchingId === row.id) setMatchingId(null);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const applyPatch = async (
    row: EcwidMapRow,
    body: Parameters<typeof patchEcwidMap>[2],
    close = false
  ) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await patchEcwidMap(practiceId, row.id, body);
      setMaps((prev) => prev.map((m) => (m.id === row.id ? { ...m, ...updated } : m)));
      setSelected((s) => ({ ...s, [row.id]: matchesOf(updated).length > 0 }));
      if (close) setMatchingId(null);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const storeCategories = useMemo(
    () =>
      [
        ...new Set([
          ...managedCategories,
          ...listings.map((row) => row.storeCategory).filter(Boolean) as string[],
        ]),
      ].sort((a, b) => a.localeCompare(b)),
    [listings, managedCategories]
  );

  const rememberCategory = (name: string) => {
    const next = name.trim();
    if (!next) return;
    setManagedCategories((prev) =>
      prev.includes(next) ? prev : [...prev, next],
    );
    void createStoreCategory(practiceId, next).catch(() => undefined);
  };

  const filteredListings = useMemo(
    () => listings.filter((listing) => listingMatchesSearch(listing, itemQuery)),
    [itemQuery, listings]
  );
  const itemPageCount = Math.max(1, Math.ceil(filteredListings.length / STORE_ITEMS_PAGE_SIZE));
  const safeItemPage = Math.min(itemPage, itemPageCount);
  const pagedListings = useMemo(() => {
    const start = (safeItemPage - 1) * STORE_ITEMS_PAGE_SIZE;
    return filteredListings.slice(start, start + STORE_ITEMS_PAGE_SIZE);
  }, [filteredListings, safeItemPage]);

  useEffect(() => {
    if (itemPage !== safeItemPage) setItemPage(safeItemPage);
  }, [itemPage, safeItemPage]);

  const autoshipOnCount = items.filter((item) => Boolean(item.recommendedFrequency)).length;
  const allAutoshipOn = items.length > 0 && autoshipOnCount === items.length;
  const someAutoshipOn = autoshipOnCount > 0 && !allAutoshipOn;

  const toggleAllAutoship = async () => {
    if (allAutoshipOn) {
      const first = await appConfirm({
        title: 'Turn off autoship for all inventory?',
        message:
          'This turns autoship off on every store inventory option, not just the 50 on this page. Clients will no longer see a recurring-order choice at checkout for those items.',
        confirmLabel: 'Continue',
        cancelLabel: 'Cancel',
        danger: true,
      });
      if (!first) return;
      const second = await appConfirm({
        title: 'Are you sure?',
        message:
          'Existing client subscriptions are not cancelled here, but new checkout will not offer autoship. This cannot be undone except by turning it back on item by item or with this same control.',
        confirmLabel: 'Turn off autoship',
        cancelLabel: 'Keep autoship',
        danger: true,
      });
      if (!second) return;
    } else {
      const first = await appConfirm({
        title: 'Turn on autoship for all inventory?',
        message:
          'This turns on monthly autoship for every store inventory option that is currently off — the whole catalog, not just this page. Clients will be offered a recurring order at checkout.',
        confirmLabel: 'Continue',
        cancelLabel: 'Cancel',
      });
      if (!first) return;
      const second = await appConfirm({
        title: 'Are you sure?',
        message:
          'Only options that were off are changed; ones that already have a frequency stay as they are. Procedures without inventory are not included. You can still change a single option afterward.',
        confirmLabel: 'Turn on monthly autoship',
        cancelLabel: 'Cancel',
      });
      if (!second) return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await bulkPatchOnlineStoreItems(practiceId, {
        recommendedFrequency: allAutoshipOn ? null : 'monthly',
        onlyMissing: !allAutoshipOn,
      });
      setItems(next);
      await load();
      setFlash(
        allAutoshipOn
          ? 'Autoship turned off for every store item.'
          : 'Autoship turned on (monthly) for items that were off.',
      );
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (searchParams.get('tab') === 'shipping') {
    return <Navigate to="/schedule/mail-orders" replace />;
  }

  return (
    <div className="settings-card" style={{ padding: 16 }}>
      <div className="settings-tabs" role="tablist">
        {(['items', 'coupons', 'import'] as const).map((key) => (
          <button
            key={key}
            type="button"
            className={`settings-tab${tab === key ? ' active' : ''}${
              key === 'import' ? ' store-tab--end' : ''
            }`}
            onClick={() => {
              setTab(key);
              const next = new URLSearchParams(searchParams);
              next.set('tab', key);
              if (key !== 'items') {
                next.delete('product');
                next.delete('add');
                setAddStoreOpen(false);
                setWorkspaceListing(null);
              }
              setSearchParams(next, { replace: true });
            }}
          >
            {key === 'import' ? 'Ecwid import' : key === 'items' ? 'Store items' : 'Coupons'}
          </button>
        ))}
      </div>
      {addStoreOpen && tab === 'items' ? null : error ? (
        <div className="settings-message settings-error-message">
          <span>{error}</span>
          <button
            type="button"
            className="btn secondary"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {addStoreOpen && tab === 'items' ? null : flash ? (
        <div className="settings-message">
          <span>{flash}</span>
          <button
            type="button"
            className="btn secondary"
            onClick={() => setFlash(null)}
            aria-label="Dismiss message"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {tab === 'import' && (
        <>
          <p className="settings-muted">
            Ecwid is only a bootstrap. Upload the catalog CSV to seed Scout store products from
            the previous shop; the live store does not call Ecwid. Autoship clones (MONTHLY /
            QUARTERLY / etc.) are skipped. One Ecwid product can match many Scout items (tablet
            sizes, bottles, individuals, or memorial procedures). Confirming creates a master
            product plus variations — prices stay on the Scout item. Procedure matches stay
            linked for invoicing. Remove from list hides
            products you do not sell in Scout; a later CSV import will not bring them back.
          </p>
          <label className="settings-label">
            Ecwid CSV
            <input
              className="settings-input"
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setBusy(true);
                setError(null);
                void importEcwidCatalog(practiceId, file)
                  .then((res) => {
                    setMaps(res.maps);
                    setFlash(
                      `Imported ${res.masters} products. Excluded ${res.clonesExcluded} autoship clones.`
                    );
                  })
                  .catch((err) => setError(apiErrorMessage(err)))
                  .finally(() => setBusy(false));
              }}
            />
          </label>
          <div style={{ display: 'flex', gap: 8, margin: '12px 0', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className="btn primary"
              disabled={busy || !selectedIds.length}
              onClick={() => {
                setBusy(true);
                setError(null);
                void confirmEcwidMaps(practiceId, selectedIds)
                  .then((res) => {
                    const ok = res.results.filter((r) => r.ok).length;
                    const bad = res.results.filter((r) => !r.ok);
                    setFlash(
                      `Listed ${ok} item${ok === 1 ? '' : 's'} on the online store.`
                    );
                    if (bad.length) {
                      setError(bad.map((b) => `${b.name}: ${b.error}`).join(' · '));
                    }
                    return load();
                  })
                  .catch((err) => setError(apiErrorMessage(err)))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? 'Working…' : `Show ${selectedIds.length} on online store`}
            </button>
            <label className="settings-muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={unmatchedOnly}
                onChange={() => setUnmatchedOnly((v) => !v)}
              />
              Unmatched only ({maps.filter((m) => !matchesOf(m).length).length})
            </label>
          </div>
          <div className="inv-catalog-results__table-scroll">
            <table className="inv-catalog-results__table">
              <thead>
                <tr>
                  <th />
                  <th>Ecwid</th>
                  <th>SKU</th>
                  <th>Match</th>
                  <th>Confidence</th>
                  <th>Autoship</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleMaps.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <input
                        type="checkbox"
                        disabled={!matchesOf(row).length}
                        checked={!!selected[row.id]}
                        onChange={() =>
                          setSelected((s) => ({ ...s, [row.id]: !s[row.id] }))
                        }
                      />
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        {row.ecwidImageUrl ? (
                          <img
                            src={row.ecwidImageUrl}
                            alt=""
                            style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6 }}
                          />
                        ) : null}
                        <div>
                          <span>{row.ecwidName}</span>
                          {row.variationHints ? (
                            <div className="settings-muted" style={{ fontSize: 12 }}>
                              Options: {row.variationHints}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td>{row.ecwidSku}</td>
                    <td style={{ minWidth: 320 }}>
                      <InventoryMatchPicker
                        row={row}
                        practiceId={practiceId}
                        open={matchingId === row.id}
                        busy={busy}
                        onOpen={() => setMatchingId(row.id)}
                        onClose={() => setMatchingId(null)}
                        onAdd={(id, type) =>
                          void applyPatch(
                            row,
                            type === 'procedure'
                              ? { addProcedureId: id }
                              : { addInventoryItemId: id }
                          )
                        }
                        onAddAll={(hits) =>
                          void applyPatch(row, {
                            inventoryItemIds: [
                              ...new Set([
                                ...matchesOf(row)
                                  .filter((m) => matchType(m) === 'inventory')
                                  .map((m) => m.inventoryItemId),
                                ...hits
                                  .filter((h) => (h.catalogItemType ?? 'inventory') === 'inventory')
                                  .map((h) => h.id),
                              ]),
                            ],
                            procedureIds: [
                              ...new Set([
                                ...matchesOf(row)
                                  .filter((m) => matchType(m) === 'procedure')
                                  .map((m) => m.inventoryItemId),
                                ...hits
                                  .filter((h) => h.catalogItemType === 'procedure')
                                  .map((h) => h.id),
                              ]),
                            ],
                          })
                        }
                        onRemove={(id, type) =>
                          void applyPatch(
                            row,
                            type === 'procedure'
                              ? { removeProcedureId: id }
                              : { removeInventoryItemId: id }
                          )
                        }
                        onClear={() => void applyPatch(row, { inventoryItemId: null }, true)}
                      />
                    </td>
                    <td>
                      {matchesOf(row).length > 1
                        ? `${matchesOf(row).length} items`
                        : row.confidence}
                    </td>
                    <td>{row.recommendedFrequency || '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={busy}
                        onClick={() => void removeFromList(row)}
                      >
                        Remove from list
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'items' && (
        <>
          {addStoreOpen ? null : (
          <>
          <p className="settings-muted">
            Each row is a Scout store product. Add a master product first, then attach
            inventory or procedure options — or create a new inventory item and add it.
            Highlight and approval live on the product; autoship is per option. Search
            looks at every store product; the table shows 50 at a time.
          </p>
          <div style={{ display: 'flex', gap: 8, margin: '12px 0', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => {
                setWorkspaceListing(null);
                setAddStoreOpen(true);
                writeItemsParams({ add: true });
              }}
            >
              + Add store item
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={() =>
                navigate(
                  withReturnTo(
                    '/schedule/inventory/items?create=inventory',
                    storeItemsPath(null, false)
                  )
                )
              }
            >
              + Add inventory item
            </button>
          </div>
          <button
            type="button"
            className={`store-autoship-all${
              allAutoshipOn ? ' is-on' : someAutoshipOn ? ' is-mixed' : ''
            }`}
            disabled={busy || !items.length}
            onClick={() => void toggleAllAutoship()}
          >
            <span className="store-autoship-all__mark" aria-hidden>
              {allAutoshipOn ? '✓' : someAutoshipOn ? '–' : ''}
            </span>
            <span className="store-autoship-all__copy">
              <strong>Autoship all inventory</strong>
              <span>
                {allAutoshipOn
                  ? `On for all ${items.length} inventory options. Click to turn off.`
                  : someAutoshipOn
                    ? `On for ${autoshipOnCount} of ${items.length} inventory options. Click to turn the rest on.`
                    : `Off for all ${items.length || ''} inventory options. Click to turn on monthly autoship.`}
              </span>
            </span>
          </button>
          </>
          )}
          {addStoreOpen ? (
            <AddStoreProductWizard
              key={workspaceListing?.listingId ?? 'new-store-product'}
              practiceId={practiceId}
              busy={busy}
              onBusy={setBusy}
              error={error}
              onError={(message) => setError(message)}
              initialDraft={workspaceListing}
              listings={listings}
              categoryOptions={storeCategories}
              onDone={() => {
                setAddStoreOpen(false);
                setWorkspaceListing(null);
                setError(null);
                setFlash(null);
                writeItemsParams({});
              }}
              onCreated={async (listing) => {
                setError(null);
                setFlash(null);
                setWorkspaceListing(listing);
                writeItemsParams({ product: listing.listingId });
                await load();
              }}
              onVariantAdded={async () => {
                setError(null);
                setFlash(null);
                await load();
              }}
            />
          ) : null}
          {addStoreOpen ? null : (
          <>
          <input
            className="settings-input"
            style={{ maxWidth: 420, marginBottom: 10 }}
            placeholder="Search store items, SKUs, or descriptions"
            value={itemQuery}
            onChange={(e) => {
              setItemQuery(e.target.value);
              setItemPage(1);
            }}
          />
          <StoreItemsPager
            page={safeItemPage}
            pageCount={itemPageCount}
            total={filteredListings.length}
            onPage={setItemPage}
          />
        <div className="store-items-table-wrap">
        <table className="inv-catalog-results__table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Approval default</th>
              <th>Highlight on home</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pagedListings.map((listing) => (
              <tr key={listing.listingId}>
                <td style={{ verticalAlign: 'top', minWidth: 320 }}>
                  <div className="store-add-workspace__option-main">
                    <StorePhotoUpload
                      src={withImageBust(masterImageSrc(practiceId, listing), imageTick)}
                      label={listing.name}
                      disabled={busy}
                      title={`Upload photo for ${listing.name}`}
                      onFile={(file) => void uploadListingPhoto(listing, file)}
                    />
                    <div style={{ fontWeight: 600 }}>{listing.name}</div>
                  </div>
                  <label className="store-add-workspace__field" style={{ marginTop: 8 }}>
                    <span>Store category</span>
                    <StoreCategorySelect
                      value={listing.storeCategory || ''}
                      options={storeCategories}
                      disabled={busy}
                      onChange={(storeCategory) => {
                        void rememberCategory(storeCategory);
                        if ((listing.storeCategory || '') === storeCategory) return;
                        void patchOnlineStoreListing(practiceId, listing.listingId, {
                          storeCategory: storeCategory || null,
                        }).then((updated) => {
                          if (!updated) return;
                          setListings((prev) =>
                            prev.map((row) =>
                              row.listingId === listing.listingId
                                ? { ...row, ...updated }
                                : row
                            )
                          );
                        });
                      }}
                    />
                  </label>
                  <StoreSaleEditor
                    {...saleFieldsFromListing(listing)}
                    saleActive={listing.saleActive}
                    disabled={busy}
                    onChange={(next) => {
                      const current = saleFieldsFromListing(listing);
                      if (
                        current.saleType === next.saleType &&
                        current.saleValue === next.saleValue &&
                        (current.saleEndsAt || null) === (next.saleEndsAt || null)
                      ) {
                        return;
                      }
                      void patchOnlineStoreListing(practiceId, listing.listingId, next).then(
                        (updated) => {
                          if (!updated) return;
                          setListings((prev) =>
                            prev.map((row) =>
                              row.listingId === listing.listingId
                                ? { ...row, ...updated }
                                : row
                            )
                          );
                        }
                      );
                    }}
                  />
                  <StoreDescriptionEditor
                    value={listing.description}
                    listings={listings}
                    currentListingId={listing.listingId}
                    disabled={busy}
                    onSave={(description) => {
                      void patchOnlineStoreListing(practiceId, listing.listingId, {
                        description,
                      }).then((updated) => {
                        if (!updated) return;
                        setListings((prev) =>
                          prev.map((row) =>
                            row.listingId === listing.listingId ? { ...row, ...updated } : row
                          )
                        );
                      });
                    }}
                  />
                  {listing.variants.length ? (
                    <div className="store-variant-groups">
                      {groupVariantsByStrength(listing.variants).map((group) => (
                        <div key={`${listing.listingId}:${group.key}`}>
                          {group.strength ? (
                            <div className="store-variant-group__strength">
                              {group.strength}
                            </div>
                          ) : null}
                          <ul className="store-variant-group__packs">
                            {group.variants.map((variant) => {
                              const href = storeVariantHref(variant, storeItemsPath());
                              return (
                                <li
                                  key={
                                    variant.inventoryItemId
                                      ? `inv:${variant.inventoryItemId}`
                                      : `proc:${variant.procedureId}`
                                  }
                                >
                                  {variant.inventoryItemId ? (
                                    <StorePhotoUpload
                                      src={withImageBust(
                                        variantImageSrc(practiceId, variant),
                                        imageTick
                                      )}
                                      label={variantDisplayName(variant)}
                                      disabled={busy}
                                      title={`Upload photo for ${variantDisplayName(variant)}`}
                                      onFile={(file) =>
                                        void uploadVariantPhoto(listing, variant, file)
                                      }
                                    />
                                  ) : (
                                    <StorePhotoUpload
                                      src={withImageBust(
                                        masterImageSrc(practiceId, listing),
                                        imageTick
                                      )}
                                      label={variantDisplayName(variant)}
                                      disabled={busy}
                                      title={`Procedures use the ${listing.name} photo. Click to upload it.`}
                                      onFile={(file) => void uploadListingPhoto(listing, file)}
                                    />
                                  )}
                                  {href ? (
                                    <Link className="inv-catalog-results__text-btn" to={href}>
                                      {variantDisplayName(variant)}
                                    </Link>
                                  ) : (
                                    <span>{variantDisplayName(variant)}</span>
                                  )}
                                  {variant.pack &&
                                  variant.pack !== 'Each' &&
                                  !variantDisplayName(variant)
                                    .toLowerCase()
                                    .includes(variant.pack.toLowerCase()) ? (
                                    <span className="settings-muted"> · {variant.pack}</span>
                                  ) : null}
                                  {variant.catalogItemType === 'procedure' ? (
                                    <span className="settings-muted"> · procedure</span>
                                  ) : null}
                                  {variant.inventoryItemId ? (
                                    <label className="store-variant-group__autoship">
                                      <input
                                        type="checkbox"
                                        disabled={busy}
                                        checked={Boolean(variant.recommendedFrequency)}
                                        onChange={(e) => {
                                          void patchVariantAutoship(
                                            listing,
                                            variant,
                                            e.target.checked
                                              ? variant.recommendedFrequency || 'monthly'
                                              : null
                                          );
                                        }}
                                      />
                                      {variant.recommendedFrequency ? (
                                        <select
                                          className="settings-input"
                                          disabled={busy}
                                          value={variant.recommendedFrequency}
                                          onChange={(e) => {
                                            void patchVariantAutoship(
                                              listing,
                                              variant,
                                              e.target.value
                                            );
                                          }}
                                        >
                                          {AUTOSHIP_FREQS.map((freq) => (
                                            <option key={freq.value} value={freq.value}>
                                              {freq.label}
                                            </option>
                                          ))}
                                        </select>
                                      ) : (
                                        <span className="settings-muted">Autoship</span>
                                      )}
                                    </label>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="store-variant-group__remove"
                                    disabled={busy}
                                    title="Remove this option"
                                    aria-label={`Remove ${variant.pack}`}
                                    onClick={() => void removeVariant(listing, variant)}
                                  >
                                    ×
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="settings-muted" style={{ margin: '8px 0 0' }}>
                      No options yet. Add inventory or procedures below.
                    </p>
                  )}
                  <button
                    type="button"
                    className="btn secondary"
                    style={{ marginTop: 8 }}
                    disabled={busy}
                    onClick={() => {
                      setWorkspaceListing(listing);
                      setAddStoreOpen(true);
                      writeItemsParams({ product: listing.listingId });
                    }}
                  >
                    + Add option
                  </button>
                </td>
                <td>
                  <select
                    className="settings-input"
                    value={listing.approvalTag}
                    onChange={(e) => {
                      const approvalTag = e.target.value as StoreItemRow['approvalTag'];
                      void patchOnlineStoreListing(practiceId, listing.listingId, {
                        approvalTag,
                      }).then(() => load());
                    }}
                  >
                    <option value="approved">Approved</option>
                    <option value="needs_doctor_approval">Needs doctor approval</option>
                  </select>
                </td>
                <td>
                  <label className="settings-muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(listing.featuredOnHome)}
                      onChange={(e) => {
                        const featuredOnHome = e.target.checked;
                        void patchOnlineStoreListing(practiceId, listing.listingId, {
                          featuredOnHome,
                        }).then(() => load());
                      }}
                    />
                    {listing.featuredOnHome ? 'On the home page' : 'Not on the home page'}
                  </label>
                </td>
                <td>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={busy}
                    onClick={() => void removeFromStore(listing)}
                  >
                    Remove from store
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {pagedListings.length === 0 ? (
          <p className="settings-muted">
            {itemQuery.trim()
              ? 'No store items match that search.'
              : 'No store items yet.'}
          </p>
        ) : (
          <StoreItemsPager
            page={safeItemPage}
            pageCount={itemPageCount}
            total={filteredListings.length}
            onPage={setItemPage}
          />
        )}
          </>
          )}
        </>
      )}

      {tab === 'coupons' && (
        <CouponEditor
          coupons={coupons}
          onSave={async (body) => {
            await saveStoreCoupon(practiceId, body);
            await load();
          }}
        />
      )}

    </div>
  );
}

function InventoryMatchPicker({
  row,
  practiceId,
  open,
  busy,
  onOpen,
  onClose,
  onAdd,
  onAddAll,
  onRemove,
  onClear,
}: {
  row: EcwidMapRow;
  practiceId: number;
  open: boolean;
  busy: boolean;
  onOpen: () => void;
  onClose: () => void;
  onAdd: (id: number, type: 'inventory' | 'procedure') => void;
  onAddAll: (
    hits: Array<{ id: number; catalogItemType?: 'inventory' | 'procedure' }>
  ) => void;
  onRemove: (id: number, type: 'inventory' | 'procedure') => void;
  onClear: () => void;
}) {
  const matches = matchesOf(row);
  const matchedKeys = new Set(matches.map((m) => matchKey(m)));
  const [q, setQ] = useState(row.ecwidName);
  const [hits, setHits] = useState<
    Array<{
      id: number;
      name: string;
      code: string | null;
      catalogItemType?: 'inventory' | 'procedure';
    }>
  >([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (open) setQ(row.ecwidName);
  }, [open, row.ecwidName]);

  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    if (query.length < 2) {
      setHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      setSearching(true);
      void searchStoreInventory(practiceId, query)
        .then(setHits)
        .catch(() => setHits([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => window.clearTimeout(t);
  }, [open, practiceId, q]);

  const addable = hits.filter(
    (hit) => !matchedKeys.has(`${hit.catalogItemType ?? 'inventory'}:${hit.id}`)
  );

  return (
    <div>
      {matches.length ? (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 8px' }}>
          {matches.map((match) => (
            <li
              key={matchKey(match)}
              style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}
            >
              <span>
                {match.name}
                {match.code ? <span className="settings-muted"> ({match.code})</span> : null}
                {matchType(match) === 'procedure' ? (
                  <span className="settings-muted"> · procedure</span>
                ) : null}
              </span>
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={() => onRemove(match.inventoryItemId, matchType(match))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="settings-muted" style={{ marginBottom: 6 }}>
          No Scout items yet
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className="btn secondary" disabled={busy} onClick={open ? onClose : onOpen}>
          {open ? 'Done' : 'Add Scout items'}
        </button>
        {matches.length ? (
          <button type="button" className="btn secondary" disabled={busy} onClick={onClear}>
            Clear all
          </button>
        ) : null}
      </div>
      {open && (
        <div style={{ marginTop: 8 }}>
          <input
            className="settings-input"
            autoFocus
            value={q}
            disabled={busy}
            placeholder="Search inventory or procedures — memorial items live on procedures"
            onChange={(e) => setQ(e.target.value)}
          />
          {addable.length > 1 && (
            <button
              type="button"
              className="btn primary"
              style={{ marginTop: 8 }}
              disabled={busy}
              onClick={() => onAddAll(addable)}
            >
              Add all {addable.length} matches
            </button>
          )}
          {searching && <p className="settings-muted" style={{ margin: '6px 0 0' }}>Searching…</p>}
          {hits.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
              {hits.map((hit) => {
                const type = hit.catalogItemType ?? 'inventory';
                const added = matchedKeys.has(`${type}:${hit.id}`);
                return (
                  <li key={`${type}:${hit.id}`}>
                    <button
                      type="button"
                      className="btn secondary"
                      style={{ width: '100%', textAlign: 'left', marginBottom: 4 }}
                      disabled={busy || added}
                      onClick={() => onAdd(hit.id, type)}
                    >
                      {added ? 'Added · ' : ''}
                      {hit.name}
                      {hit.code ? <span className="settings-muted"> · {hit.code}</span> : null}
                      {type === 'procedure' ? (
                        <span className="settings-muted"> · procedure</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {!searching && q.trim().length >= 2 && hits.length === 0 && (
            <p className="settings-muted" style={{ margin: '6px 0 0' }}>
              No Scout items match that search.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function AddStoreProductWizard({
  practiceId,
  busy,
  onBusy,
  error,
  onError,
  listings,
  categoryOptions,
  initialDraft,
  onDone,
  onCreated,
  onVariantAdded,
}: {
  practiceId: number;
  busy: boolean;
  error?: string | null;
  onBusy: (busy: boolean) => void;
  onError: (message: string | null) => void;
  listings: StoreAdminListing[];
  categoryOptions: string[];
  initialDraft?: StoreAdminListing | null;
  onDone: () => void;
  onCreated: (listing: StoreAdminListing) => Promise<void>;
  onVariantAdded: (listing: StoreAdminListing) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState<string | null>(null);
  const [approvalTag, setApprovalTag] =
    useState<StoreItemRow['approvalTag']>('approved');
  const [featuredOnHome, setFeaturedOnHome] = useState(false);
  const [storeCategory, setStoreCategory] = useState('');
  const [sale, setSale] = useState<StoreSaleFields>({
    saleType: null,
    saleValue: null,
    saleEndsAt: null,
  });
  const [newOptionAutoship, setNewOptionAutoship] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [imageTick, setImageTick] = useState(0);
  const [draft, setDraft] = useState<StoreAdminListing | null>(initialDraft ?? null);

  useEffect(() => {
    setDraft(initialDraft ?? null);
    if (initialDraft) {
      setApprovalTag(initialDraft.approvalTag);
      setFeaturedOnHome(Boolean(initialDraft.featuredOnHome));
      setStoreCategory(initialDraft.storeCategory || '');
      setSale(saleFieldsFromListing(initialDraft));
    }
  }, [initialDraft]);

  useEffect(() => {
    if (!pendingImage) {
      setPendingPreview(null);
      return;
    }
    const url = URL.createObjectURL(pendingImage);
    setPendingPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingImage]);

  const createMaster = async () => {
    const nextName = name.trim();
    if (!nextName) {
      onError('Name the master product first.');
      return;
    }
    onBusy(true);
    onError(null);
    try {
      let created = await createOnlineStoreProduct(practiceId, {
        name: nextName,
        description,
        approvalTag,
        featuredOnHome,
        storeCategory: storeCategory.trim() || null,
        saleType: sale.saleType,
        saleValue: sale.saleValue,
        saleEndsAt: sale.saleEndsAt,
      });
      if (pendingImage) {
        const withImage = await uploadOnlineStoreListingImage(
          practiceId,
          created.listingId,
          pendingImage
        );
        if (withImage) created = withImage;
        setPendingImage(null);
      }
      setDraft(created);
      setName('');
      setDescription(null);
      setSale(saleFieldsFromListing(created));
      await onCreated(created);
    } catch (err) {
      onError(apiErrorMessage(err));
    } finally {
      onBusy(false);
    }
  };

  const uploadDraftImage = async (file: File) => {
    if (!draft) {
      setPendingImage(file);
      return;
    }
    onBusy(true);
    onError(null);
    try {
      const updated = await uploadOnlineStoreListingImage(
        practiceId,
        draft.listingId,
        file
      );
      if (updated) {
        setDraft((prev) =>
          prev
            ? { ...prev, ...updated, variants: updated.variants ?? prev.variants }
            : prev
        );
      }
      setPendingImage(null);
      setImageTick((tick) => tick + 1);
    } catch (err) {
      onError(apiErrorMessage(err));
    } finally {
      onBusy(false);
    }
  };

  const uploadOptionImage = async (variant: StoreAdminVariant, file: File) => {
    if (!variant.inventoryItemId) {
      await uploadDraftImage(file);
      return;
    }
    onBusy(true);
    onError(null);
    try {
      await uploadInventoryItemImage(practiceId, variant.inventoryItemId, file);
      setDraft((prev) =>
        prev
          ? {
              ...prev,
              hasImage: true,
              variants: prev.variants.map((item) =>
                item.inventoryItemId === variant.inventoryItemId
                  ? { ...item, hasImage: true }
                  : item
              ),
            }
          : prev
      );
      setImageTick((tick) => tick + 1);
    } catch (err) {
      onError(apiErrorMessage(err));
    } finally {
      onBusy(false);
    }
  };

  const patchDraftListing = async (body: {
    approvalTag?: StoreItemRow['approvalTag'];
    featuredOnHome?: boolean;
    description?: string | null;
    storeCategory?: string | null;
    saleType?: StoreSaleType | null;
    saleValue?: number | null;
    saleEndsAt?: string | null;
  }) => {
    if (!draft) return;
    onBusy(true);
    onError(null);
    try {
      const updated = await patchOnlineStoreListing(practiceId, draft.listingId, body);
      if (updated) {
        setDraft((prev) =>
          prev
            ? { ...prev, ...updated, variants: updated.variants ?? prev.variants }
            : prev
        );
      }
    } catch (err) {
      onError(apiErrorMessage(err));
    } finally {
      onBusy(false);
    }
  };

  const patchDraftAutoship = async (
    variant: StoreAdminVariant,
    recommendedFrequency: string | null
  ) => {
    if (!draft || !variant.inventoryItemId) return;
    onBusy(true);
    onError(null);
    try {
      await patchOnlineStoreItem(practiceId, variant.inventoryItemId, {
        recommendedFrequency,
      });
      setDraft((prev) =>
        prev
          ? {
              ...prev,
              variants: prev.variants.map((item) =>
                item.inventoryItemId === variant.inventoryItemId
                  ? { ...item, recommendedFrequency }
                  : item
              ),
            }
          : prev
      );
    } catch (err) {
      onError(apiErrorMessage(err));
    } finally {
      onBusy(false);
    }
  };

  return (
    <div className="store-add-workspace">
      <div className="store-add-workspace__header">
        <div className="store-add-workspace__identity">
          <label className="store-add-workspace__photo">
            <StoreThumb
              src={
                pendingPreview ||
                (draft ? masterImageSrc(practiceId, draft) : null)
              }
              label={draft?.name || 'New store product'}
              size="lg"
            />
            <input
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              hidden
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void uploadDraftImage(file);
              }}
            />
            <span>Upload photo</span>
          </label>
          <div>
            <p className="store-add-workspace__kicker">
              {draft ? 'Master product' : 'New store product'}
            </p>
            <div className="store-add-workspace__title">
              {draft ? draft.name : 'Name the master product'}
            </div>
          </div>
        </div>
        <button type="button" className="btn primary" disabled={busy} onClick={onDone}>
          Done adding
        </button>
      </div>
      {draft ? (
        <>
          <section className="store-add-workspace__section">
            <h3 className="store-add-workspace__section-title">
              Store settings for {draft.name}
            </h3>
            <StoreProductDefaults
              approvalTag={draft.approvalTag}
              featuredOnHome={Boolean(draft.featuredOnHome)}
              storeCategory={draft.storeCategory || ''}
              categoryOptions={categoryOptions}
              disabled={busy}
              onApproval={(value) => {
                setDraft((prev) => (prev ? { ...prev, approvalTag: value } : prev));
                void patchDraftListing({ approvalTag: value });
              }}
              onHighlight={(value) => {
                setDraft((prev) => (prev ? { ...prev, featuredOnHome: value } : prev));
                void patchDraftListing({ featuredOnHome: value });
              }}
              onCategory={(value) => {
                setDraft((prev) => (prev ? { ...prev, storeCategory: value || null } : prev));
              }}
              onCategoryCommit={(value) => {
                void createStoreCategory(practiceId, value).catch(() => undefined);
                void patchDraftListing({ storeCategory: value || null });
              }}
            />
            <StoreSaleEditor
              {...saleFieldsFromListing(draft)}
              saleActive={draft.saleActive}
              disabled={busy}
              onChange={(next) => {
                const current = saleFieldsFromListing(draft);
                if (
                  current.saleType === next.saleType &&
                  current.saleValue === next.saleValue &&
                  (current.saleEndsAt || null) === (next.saleEndsAt || null)
                ) {
                  return;
                }
                setDraft((prev) => (prev ? { ...prev, ...next } : prev));
                void patchDraftListing(next);
              }}
            />
            <p className="store-add-workspace__hint" style={{ marginTop: 12 }}>
              Description is HTML. Links and formatting copy onto inventory options
              that do not already have their own description.
            </p>
            <StoreDescriptionEditor
              value={draft.description}
              listings={listings}
              currentListingId={draft.listingId}
              disabled={busy}
              onSave={(html) => {
                setDraft((prev) => (prev ? { ...prev, description: html } : prev));
                void patchDraftListing({ description: html });
              }}
            />
          </section>
          <section className="store-add-workspace__section">
            <h3 className="store-add-workspace__section-title">
              Options already on {draft.name}
            </h3>
            {draft.variants.length ? (
              <ul className="store-add-workspace__options">
                {draft.variants.map((variant) => (
                  <li
                    key={
                      variant.inventoryItemId
                        ? `inv:${variant.inventoryItemId}`
                        : `proc:${variant.procedureId}`
                    }
                    className="store-add-workspace__option-row"
                  >
                    <span className="store-add-workspace__option-main">
                      {variant.inventoryItemId ? (
                        <StorePhotoUpload
                          src={withImageBust(
                            variantImageSrc(practiceId, variant),
                            imageTick
                          )}
                          label={variantDisplayName(variant)}
                          disabled={busy}
                          title={`Upload photo for ${variantDisplayName(variant)}`}
                          onFile={(file) => void uploadOptionImage(variant, file)}
                        />
                      ) : (
                        <StorePhotoUpload
                          src={withImageBust(
                            masterImageSrc(practiceId, draft),
                            imageTick
                          )}
                          label={variantDisplayName(variant)}
                          disabled={busy}
                          title={`Procedures use the ${draft.name} photo. Click to upload it.`}
                          onFile={(file) => void uploadDraftImage(file)}
                        />
                      )}
                      <span>
                        {(() => {
                          const href = storeVariantHref(
                            variant,
                            storeItemsPath(draft.listingId)
                          );
                          const label = (
                            <>
                              {variantDisplayName(variant)}
                              {variant.pack && variant.pack !== 'Each'
                                ? ` · ${variant.pack}`
                                : ''}
                              {variant.catalogItemType === 'procedure'
                                ? ' · procedure'
                                : ''}
                            </>
                          );
                          return href ? (
                            <Link className="inv-catalog-results__text-btn" to={href}>
                              {label}
                            </Link>
                          ) : (
                            label
                          );
                        })()}
                      </span>
                    </span>
                    {variant.inventoryItemId ? (
                      <AutoshipControls
                        frequency={variant.recommendedFrequency}
                        disabled={busy}
                        onChange={(frequency) => void patchDraftAutoship(variant, frequency)}
                      />
                    ) : (
                      <span className="settings-muted">Autoship is for inventory</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="store-add-workspace__empty">None yet.</p>
            )}
          </section>
          <section className="store-add-workspace__section store-add-workspace__section--find">
            <h3 className="store-add-workspace__section-title">
              Add an option to {draft.name}
            </h3>
            <p className="store-add-workspace__hint">
              Search Scout inventory or procedures, then click Add. Set autoship here
              and it applies to inventory options you add next.
            </p>
            {error ? <p className="store-add-workspace__error">{error}</p> : null}
            <AutoshipControls
              frequency={newOptionAutoship}
              disabled={busy}
              onChange={setNewOptionAutoship}
            />
            <StoreVariantPicker
              practiceId={practiceId}
              listing={draft}
              busy={busy}
              autoshipFrequency={newOptionAutoship}
              onBusy={onBusy}
              onError={onError}
              onAdded={async (listing) => {
                setDraft(listing);
                await onVariantAdded(listing);
              }}
            />
          </section>
        </>
      ) : (
        <section className="store-add-workspace__section">
          <p className="store-add-workspace__hint">
            Shoppers see this name. After you create it, you will add tablet sizes, bottles,
            or memorial procedures as options.
          </p>
          <input
            className="settings-input"
            autoFocus
            value={name}
            disabled={busy}
            placeholder="e.g. Apoquel Chewable Tablets"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void createMaster();
              }
            }}
          />
          <div style={{ marginTop: 10 }}>
            <StoreDescriptionEditor
              value={description}
              listings={listings}
              currentListingId="new"
              disabled={busy}
              showSave={false}
              placeholder="HTML description shoppers see. Link other store items here."
              onHtmlChange={setDescription}
              onSave={setDescription}
            />
          </div>
          <StoreProductDefaults
            approvalTag={approvalTag}
            featuredOnHome={featuredOnHome}
            storeCategory={storeCategory}
            categoryOptions={categoryOptions}
            disabled={busy}
            onApproval={setApprovalTag}
            onHighlight={setFeaturedOnHome}
            onCategory={setStoreCategory}
            onCategoryCommit={(value) => {
              if (value) void createStoreCategory(practiceId, value).catch(() => undefined);
            }}
          />
          <StoreSaleEditor
            {...sale}
            disabled={busy}
            onChange={setSale}
          />
          <button
            type="button"
            className="btn primary"
            style={{ marginTop: 8 }}
            disabled={busy || !name.trim()}
            onClick={() => void createMaster()}
          >
            Create master product
          </button>
        </section>
      )}
    </div>
  );
}

function StoreVariantPicker({
  practiceId,
  listing,
  busy,
  compact,
  autoshipFrequency,
  onBusy,
  onError,
  onAdded,
}: {
  practiceId: number;
  listing: StoreAdminListing;
  busy: boolean;
  compact?: boolean;
  autoshipFrequency?: string | null;
  onBusy: (busy: boolean) => void;
  onError: (message: string | null) => void;
  onAdded: (listing: StoreAdminListing) => Promise<void>;
}) {
  const [open, setOpen] = useState(!compact);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<
    Array<{
      id: number;
      name: string;
      code: string | null;
      catalogItemType?: 'inventory' | 'procedure';
      hasImage?: boolean;
    }>
  >([]);
  const [searching, setSearching] = useState(false);
  const taken = new Set(
    listing.variants.map((variant) =>
      variant.procedureId && variant.catalogItemType === 'procedure'
        ? `procedure:${variant.procedureId}`
        : `inventory:${variant.inventoryItemId}`
    )
  );

  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    if (query.length < 2) {
      setHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      setSearching(true);
      void searchStoreInventory(practiceId, query)
        .then(setHits)
        .catch(() => setHits([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => window.clearTimeout(t);
  }, [open, practiceId, q]);

  const addable = hits.filter(
    (hit) => !taken.has(`${hit.catalogItemType ?? 'inventory'}:${hit.id}`)
  );

  const addHit = async (hit: (typeof hits)[0]) => {
    onBusy(true);
    onError(null);
    try {
      let updated = await addOnlineStoreVariant(
        practiceId,
        listing.listingId,
        hit.catalogItemType === 'procedure'
          ? { procedureId: hit.id }
          : { inventoryItemId: hit.id }
      );
      if (hit.catalogItemType !== 'procedure' && autoshipFrequency) {
        await patchOnlineStoreItem(practiceId, hit.id, {
          recommendedFrequency: autoshipFrequency,
        });
        updated = {
          ...updated,
          variants: updated.variants.map((variant) =>
            variant.inventoryItemId === hit.id
              ? { ...variant, recommendedFrequency: autoshipFrequency }
              : variant
          ),
        };
      }
      await onAdded(updated);
      setQ('');
      setHits([]);
    } catch (err) {
      onError(apiErrorMessage(err));
    } finally {
      onBusy(false);
    }
  };

  return (
    <div style={{ marginTop: compact ? 8 : 0 }}>
      {compact ? (
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Done adding options' : '+ Add option'}
        </button>
      ) : null}
      {open ? (
        <div style={{ marginTop: compact ? 8 : 0 }}>
          <input
            className="settings-input"
            autoFocus={!compact}
            value={q}
            disabled={busy}
            placeholder="Search inventory or procedures to add"
            onChange={(e) => setQ(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={() =>
                window.location.assign(
                  withReturnTo(
                    '/schedule/inventory/items?create=inventory',
                    storeItemsPath(listing.listingId)
                  )
                )
              }
            >
              + Create inventory item
            </button>
          </div>
          {searching ? (
            <p className="settings-muted" style={{ margin: '6px 0 0' }}>
              Searching…
            </p>
          ) : null}
          {addable.length > 0 ? (
            <ul className="store-add-workspace__hits">
              {addable.map((hit) => (
                <li key={`${hit.catalogItemType ?? 'inventory'}:${hit.id}`}>
                  <span className="store-add-workspace__option-main">
                    <StoreThumb
                      src={
                        hit.hasImage && hit.catalogItemType !== 'procedure'
                          ? storeProductImageUrl(practiceId, hit.id)
                          : null
                      }
                      label={hit.name}
                    />
                    <span>
                      {hit.name}
                      {hit.catalogItemType === 'procedure' ? (
                        <span className="settings-muted"> · procedure</span>
                      ) : null}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy}
                    onClick={() => void addHit(hit)}
                  >
                    Add to {listing.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {!searching && q.trim().length >= 2 && addable.length === 0 ? (
            <p className="settings-muted" style={{ margin: '6px 0 0' }}>
              No unused inventory or procedures match. Create an inventory item, then
              search again.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function StoreItemsPager({
  page,
  pageCount,
  total,
  onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const start = total === 0 ? 0 : (page - 1) * STORE_ITEMS_PAGE_SIZE + 1;
  const end = Math.min(page * STORE_ITEMS_PAGE_SIZE, total);
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        margin: '8px 0',
      }}
    >
      <span className="settings-muted" style={{ fontSize: 13 }}>
        {total
          ? `Showing ${start}–${end} of ${total} store items`
          : 'No store items'}
      </span>
      {pageCount > 1 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className="btn secondary"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            Previous
          </button>
          <span className="settings-muted" style={{ fontSize: 13 }}>
            Page {page} of {pageCount}
          </span>
          <button
            type="button"
            className="btn secondary"
            disabled={page >= pageCount}
            onClick={() => onPage(page + 1)}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CouponEditor({
  coupons,
  onSave,
}: {
  coupons: StoreCoupon[];
  onSave: (body: { code: string; name: string; amount: number; membershipOnly: boolean }) => Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('10');
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <input className="settings-input" placeholder="CODE" value={code} onChange={(e) => setCode(e.target.value)} />
        <input className="settings-input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="settings-input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button
          type="button"
          className="btn primary"
          onClick={() => void onSave({ code, name, amount: Number(amount) || 10, membershipOnly: false })}
        >
          Save coupon
        </button>
      </div>
      <ul>
        {coupons.map((c) => (
          <li key={c.id}>
            <strong>{c.code}</strong> — {c.name} ({c.amount}
            {c.discountType === 'percent' ? '%' : ''}
            {c.membershipOnly ? ', members' : ''})
          </li>
        ))}
      </ul>
    </div>
  );
}
