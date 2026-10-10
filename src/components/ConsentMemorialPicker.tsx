import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { StoreListingRef } from '../utils/euthanasiaConsentSettings';
import axios from 'axios';
import {
  type ConsentMemorialItem,
  memorialCartTotal,
  memorialItemParts,
} from '../api/consent';
import {
  storeListingImageUrl,
  type StoreListing,
  type StoreVariant,
} from '../api/onlineStore';
import { enhanceStoreDescriptionHtml, storeListingIdFromHref } from '../utils/storeDescriptionLinks';

const publicStoreClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000',
  withCredentials: false,
});

function resolvedDefaultSubcategory(value?: string): string {
  const next = String(value || '').trim();
  if (!next || /^all$/i.test(next)) return '';
  return next;
}

function listingInCategory(listing: StoreListing, selected: string): boolean {
  const cat = (listing.storeCategory || '').trim();
  if (!selected) return true;
  if (cat === selected) return true;
  return cat.startsWith(`${selected} / `) || cat.startsWith(`${selected}/`);
}

function childCategory(raw: string | null | undefined, parent: string): string {
  const cat = String(raw || '').trim();
  const prefix = `${parent} / `;
  if (cat.startsWith(prefix)) return cat.slice(prefix.length);
  if (cat.startsWith(`${parent}/`)) return cat.slice(parent.length + 1).trim();
  return '';
}

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function variantKey(listingId: string, variant?: StoreVariant | null): string {
  if (variant?.procedureId) return `${listingId}:p:${variant.procedureId}`;
  if (variant?.inventoryItemId) return `${listingId}:i:${variant.inventoryItemId}`;
  return listingId;
}

const GENERIC_VARIANT_LABEL = /^(each|individual tablet|1|option)$/i;

function variantChoiceLabel(listingName: string, variant: StoreVariant): string {
  const option = String(variant.optionLabel || '').trim();
  if (option && !GENERIC_VARIANT_LABEL.test(option)) return option;
  const strength = String(variant.strength || '').trim();
  if (strength && !GENERIC_VARIANT_LABEL.test(strength)) return strength;
  const pack = String(variant.pack || '').trim();
  if (pack && !GENERIC_VARIANT_LABEL.test(pack)) return pack;
  const name = String(variant.name || '').trim();
  const parent = listingName.trim();
  if (name && parent) {
    const prefix = new RegExp(
      `^${parent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[-–—:/|]\\s*`,
      'i',
    );
    const rest = name.replace(prefix, '').trim();
    if (rest && rest.toLowerCase() !== parent.toLowerCase()) return rest;
  }
  if (name && name.toLowerCase() !== parent.toLowerCase()) {
    const parentCore = parent.split(/\s*[-–—:/|]\s*/)[0] || parent;
    const stripped = name
      .replace(new RegExp(`^${parentCore.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[-–—:/|,]*\\s*`, 'i'), '')
      .replace(/\s*[-–—]\s*Final Gift\s*$/i, '')
      .trim();
    if (stripped && stripped.toLowerCase() !== name.toLowerCase()) return stripped;
    return name;
  }
  return option || pack || name || 'Option';
}

function cartKey(item: ConsentMemorialItem): string {
  if (item.procedureId) return `${item.listingId}:p:${item.procedureId}`;
  if (item.inventoryItemId) return `${item.listingId}:i:${item.inventoryItemId}`;
  return item.listingId;
}

function isIncludedCremationVariant(listingName: string, variant: StoreVariant): boolean {
  const label = `${variantChoiceLabel(listingName, variant)} ${variant.name} ${variant.optionLabel || ''} ${variant.pack || ''}`;
  return /included|private cremation|substitute/i.test(label);
}

function preferredVariant(listing: StoreListing, preferIncluded: boolean): StoreVariant | null {
  const rows = listing.variants || [];
  if (preferIncluded) {
    const included = rows.find((row) => isIncludedCremationVariant(listing.name, row));
    if (included) return included;
  }
  return rows[0] ?? null;
}

export function ConsentStoreListingModal({
  practiceId,
  listing,
  loading,
  error,
  onClose,
  onAddToCart,
  onOpenListing,
  substituteFor,
}: {
  practiceId: number;
  listing: StoreListing | null;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  onAddToCart?: (listing: StoreListing, variant: StoreVariant | null) => void;
  onOpenListing?: (listingId: string) => void;
  substituteFor?: StoreListingRef | null;
}) {
  const [variant, setVariant] = useState<StoreVariant | null>(
    listing ? preferredVariant(listing, Boolean(substituteFor)) : null,
  );
  const [catalog, setCatalog] = useState<StoreListing[]>([]);

  useEffect(() => {
    setVariant(listing ? preferredVariant(listing, Boolean(substituteFor)) : null);
  }, [listing, substituteFor]);

  useEffect(() => {
    if (!practiceId) return;
    let cancelled = false;
    void publicStoreClient
      .get<StoreListing[]>('/public/store/products', { params: { practiceId } })
      .then((res) => {
        if (!cancelled) setCatalog(Array.isArray(res.data) ? res.data : []);
      })
      .catch(() => {
        if (!cancelled) setCatalog([]);
      });
    return () => {
      cancelled = true;
    };
  }, [practiceId]);

  if (!listing && !loading && !error) return null;

  return (
    <div
      className="consent-memorial-modal"
      role="dialog"
      aria-modal="true"
      aria-label={listing?.name || 'Item details'}
    >
      <button
        type="button"
        className="consent-memorial-modal-backdrop"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="consent-memorial-modal-card">
        {loading ? <p className="consent-muted">Loading item details…</p> : null}
        {error ? <p className="consent-error">{error}</p> : null}
        {listing ? (
          <>
            <div className="consent-memorial-media">
              {storeListingImageUrl(practiceId, listing, variant) ? (
                <img src={storeListingImageUrl(practiceId, listing, variant) ?? ''} alt="" />
              ) : (
                <div className="consent-memorial-placeholder" />
              )}
            </div>
            <h3>{listing.name}</h3>
            <p className="consent-muted">
              {substituteFor
                ? '$0.00 as a substitute for private cremation'
                : money(variant?.onlineStorePrice ?? listing.priceFrom) || ''}
            </p>
            {substituteFor ? (
              <p>
                Adding this to your cart substitutes it for the {substituteFor.name} included with
                private cremation. There is no charge.
              </p>
            ) : null}
            {listing.description ? (
              <div
                className="consent-memorial-desc"
                dangerouslySetInnerHTML={{
                  __html: enhanceStoreDescriptionHtml(listing.description, catalog),
                }}
                onClick={(event) => {
                  const anchor = (event.target as HTMLElement).closest('a');
                  const href = anchor?.getAttribute('href') || '';
                  const listingId = storeListingIdFromHref(href);
                  if (!listingId || !onOpenListing) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenListing(listingId);
                }}
              />
            ) : null}
            {(listing.variants || []).length > 1 ? (
              <div className="consent-memorial-chips">
                {listing.variants.map((row) => (
                  <button
                    key={variantKey(listing.listingId, row)}
                    type="button"
                    className={`consent-memorial-chip${
                      variantKey(listing.listingId, variant) === variantKey(listing.listingId, row)
                        ? ' is-on'
                        : ''
                    }`}
                    onClick={() => setVariant(row)}
                  >
                    {variantChoiceLabel(listing.name, row)}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
        <div className="consent-memorial-modal-actions">
          {onAddToCart && listing ? (
            <button type="button" className="consent-btn" onClick={() => onAddToCart(listing, variant)}>
              Add to cart
            </button>
          ) : null}
          <button type="button" className="consent-btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export const CLAY_PAW_PRINT_CART_ID = 'clay-paw-print';

export function ConsentCartFloat({
  items,
  onRemove,
}: {
  items: ConsentMemorialItem[];
  onRemove?: (listingId: string, item: ConsentMemorialItem) => void;
}) {
  const count = items.length;
  const [open, setOpen] = useState(false);
  const [pop, setPop] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const total = items.reduce((sum, item) => sum + (Number(item.priceFrom) || 0) * (item.quantity || 1), 0);

  useEffect(() => {
    if (!count) {
      setOpen(false);
      return;
    }
    setPop(true);
    const handle = window.setTimeout(() => setPop(false), 400);
    return () => window.clearTimeout(handle);
  }, [count]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!count) return null;

  return (
    <div
      ref={rootRef}
      className={`consent-cart-float${pop ? ' is-pop' : ''}${open ? ' is-open' : ''}`}
    >
      <div className="consent-cart-float-panel">
        <div className="consent-cart-float-title">In your cart</div>
        <ul>
          {items.map((item) => {
            const parts = memorialItemParts(item);
            return (
              <li key={cartKey(item)}>
                <span>
                  {parts.title}
                  {parts.detail ? <em>{parts.detail}</em> : null}
                </span>
                {onRemove ? (
                  <button
                    type="button"
                    className="consent-memorial-remove"
                    onClick={() => onRemove(item.listingId, item)}
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="consent-cart-float-total">
          <span>Subtotal</span>
          <strong>
            {total.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
          </strong>
        </div>
      </div>
      <button
        type="button"
        className="consent-cart-float-btn"
        aria-label={`Cart, ${count} items`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
          <line x1="3" y1="6" x2="21" y2="6" />
          <path d="M16 10a4 4 0 0 1-8 0" />
        </svg>
        <span className="consent-cart-float-count">{count}</span>
      </button>
    </div>
  );
}

export function ConsentMemorialList({
  selected,
  onRemove,
  title = 'Selected items',
  footer,
}: {
  selected: ConsentMemorialItem[];
  onRemove?: (listingId: string, item: ConsentMemorialItem) => void;
  title?: string;
  footer?: ReactNode;
}) {
  if (!selected.length) return null;
  const total = memorialCartTotal(selected);
  return (
    <div className="consent-invoice">
      <div className="consent-invoice-head">
        <h3>{title}</h3>
      </div>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {selected.map((item) => {
            const parts = memorialItemParts(item);
            return (
              <tr key={cartKey(item)}>
                <td>
                  <strong>{parts.title}</strong>
                  {parts.detail ? <div className="consent-invoice-detail">{parts.detail}</div> : null}
                  {onRemove ? (
                    <button
                      type="button"
                      className="consent-memorial-remove"
                      onClick={() => onRemove(item.listingId, item)}
                    >
                      Remove
                    </button>
                  ) : null}
                </td>
                <td>{item.quantity || 1}</td>
                <td>{parts.amountLabel}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="consent-invoice-total">
        <span>Total</span>
        <strong>
          {total === 0
            ? 'No charge'
            : total.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
        </strong>
      </div>
      {footer}
    </div>
  );
}

const COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

function countPhrase(count: number): string {
  const word = COUNT_WORDS[count] ?? String(count);
  if (count === 1) return `is ${word} urn`;
  return `are ${word} urns`;
}

function UrnLink({
  urn,
  onOpen,
}: {
  urn: StoreListingRef;
  onOpen?: (listingId: string) => void;
}) {
  if (!onOpen) return <span>{urn.name}</span>;
  return (
    <button type="button" className="consent-inline-link" onClick={() => onOpen(urn.listingId)}>
      {urn.name}
    </button>
  );
}

function joinUrnLinks(
  urns: StoreListingRef[],
  onOpen?: (listingId: string) => void,
) {
  return urns.map((urn, index) => (
    <Fragment key={urn.listingId}>
      {index > 0 ? (index === urns.length - 1 ? ', and ' : ', ') : null}
      the <UrnLink urn={urn} onOpen={onOpen} />
    </Fragment>
  ));
}

export default function ConsentMemorialPicker({
  practiceId,
  category,
  petName,
  selected,
  onChange,
  privateCremationUrns,
  onOpenListing,
  defaultSubcategory,
}: {
  practiceId: number;
  category: string;
  petName: string;
  selected: ConsentMemorialItem[];
  onChange: (next: ConsentMemorialItem[]) => void;
  privateCremationUrns?: { included: StoreListingRef | null; substitutes: StoreListingRef[] } | null;
  onOpenListing?: (listingId: string) => void;
  defaultSubcategory?: string;
}) {
  const [open, setOpen] = useState(selected.length > 0);
  const [items, setItems] = useState<StoreListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [subcategory, setSubcategory] = useState(resolvedDefaultSubcategory(defaultSubcategory));
  const [detail, setDetail] = useState<StoreListing | null>(null);

  useEffect(() => {
    const wanted = resolvedDefaultSubcategory(defaultSubcategory);
    if (!wanted) return;
    setSubcategory((current) => current || wanted);
  }, [defaultSubcategory]);

  useEffect(() => {
    if (!open || !practiceId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void publicStoreClient
      .get<StoreListing[]>('/public/store/products', {
        params: { practiceId },
      })
      .then((res) => {
        if (cancelled) return;
        const rows = Array.isArray(res.data) ? res.data : [];
        setItems(rows.filter((row) => listingInCategory(row, category)));
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError('Could not load memorial items here. Use the store link instead.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, practiceId, category]);

  const chips = useMemo(() => {
    const names = new Set<string>();
    for (const item of items) {
      const child = childCategory(item.storeCategory, category);
      if (child) names.add(child.split(' / ')[0] || child);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [items, category]);

  useEffect(() => {
    if (!chips.length || !subcategory) return;
    if (chips.includes(subcategory)) return;
    const match = chips.find((name) => name.toLowerCase() === subcategory.toLowerCase());
    if (match) setSubcategory(match);
  }, [chips, subcategory]);

  const visible = useMemo(() => {
    if (!subcategory) return items;
    return items.filter((item) => listingInCategory(item, `${category} / ${subcategory}`));
  }, [items, subcategory, category]);

  const openDetail = (listing: StoreListing) => {
    setDetail(listing);
  };

  const substituteIds = new Set(
    (privateCremationUrns?.substitutes || []).map((row) => row.listingId),
  );
  const includedUrn = privateCremationUrns?.included ?? null;

  const addToCart = (detail: StoreListing, variant: StoreVariant | null) => {
    const isSubstitute = substituteIds.has(detail.listingId);
    const chosen = variant || preferredVariant(detail, isSubstitute);
    const unit = isSubstitute ? 0 : chosen?.onlineStorePrice ?? detail.priceFrom;
    const choiceLabel = chosen ? variantChoiceLabel(detail.name, chosen) : '';
    const next: ConsentMemorialItem = {
      listingId: detail.listingId,
      name: detail.name,
      storeCategory: detail.storeCategory,
      priceFrom: unit,
      timing: 'shop_now',
      quantity: 1,
      variantName: isSubstitute && includedUrn
        ? `Substitutes ${includedUrn.name}`
        : choiceLabel && choiceLabel !== detail.name
          ? choiceLabel
          : null,
      inventoryItemId: chosen?.inventoryItemId ?? null,
      procedureId: chosen?.procedureId ?? null,
      catalogItemType: chosen?.catalogItemType,
    };
    const withoutReplaced = isSubstitute
      ? selected.filter((row) => !substituteIds.has(row.listingId))
      : selected.filter((row) => cartKey(row) !== cartKey(next));
    onChange([...withoutReplaced, next]);
    setDetail(null);
  };

  return (
    <div className="consent-memorial">
      {privateCremationUrns?.included ? (
        <p>
          Please note: If you choose a private cremation with Vet At Your Door, this includes the
          return of your pet’s ashes in our{' '}
          <UrnLink urn={privateCremationUrns.included} onOpen={onOpenListing} />, along with a
          brass name plate with your pet’s name.
          {privateCremationUrns.substitutes.length > 0 ? (
            <>
              {' '}
              There {countPhrase(privateCremationUrns.substitutes.length)} that can be substituted
              for no charge here online for the{' '}
              <UrnLink urn={privateCremationUrns.included} onOpen={onOpenListing} />:{' '}
              {joinUrnLinks(privateCremationUrns.substitutes, onOpenListing)}.
            </>
          ) : null}
        </p>
      ) : null}
      <p>
        Some families find comfort in memorializing their pet in a lasting way. If that feels
        right to you, you’re welcome to browse or purchase memorial items now, or anytime
        through our online store before {petName}’s appointment.
      </p>
      <div className="consent-memorial-actions">
        <button type="button" className="consent-btn" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide memorial items' : 'View now'}
        </button>
      </div>
      {open ? (
        <div className="consent-memorial-store">
          {chips.length ? (
            <div className="consent-memorial-chips">
              <button
                type="button"
                className={`consent-memorial-chip${!subcategory ? ' is-on' : ''}`}
                onClick={() => setSubcategory('')}
              >
                All
              </button>
              {chips.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={`consent-memorial-chip${subcategory === name ? ' is-on' : ''}`}
                  onClick={() => setSubcategory(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          ) : null}
          {loading ? <p className="consent-muted">Loading memorial items…</p> : null}
          {loadError ? <p className="consent-error">{loadError}</p> : null}
          <div className="consent-memorial-grid">
            {visible.map((item) => {
              const imageSrc = storeListingImageUrl(practiceId, item);
              const chosen = selected.some((row) => row.listingId === item.listingId);
              return (
                <button
                  key={item.listingId}
                  type="button"
                  className={`consent-memorial-card${chosen ? ' is-on' : ''}`}
                  onClick={() => openDetail(item)}
                >
                  <div className="consent-memorial-media">
                    {imageSrc ? (
                      <img src={imageSrc} alt="" />
                    ) : (
                      <div className="consent-memorial-placeholder" />
                    )}
                  </div>
                  <h3>{item.name}</h3>
                  <p className="consent-muted">
                    {item.priceFrom != null
                      ? `${item.variants.length > 1 ? 'From ' : ''}${money(item.priceFrom)}`
                      : 'See details'}
                  </p>
                  {chosen ? <p className="consent-muted">🛒 In your cart</p> : null}
                </button>
              );
            })}
          </div>
          {!loading && !loadError && !visible.length ? (
            <p className="consent-muted">
              No memorial items are listed yet. Use the store link above.
            </p>
          ) : null}
        </div>
      ) : null}
      {detail ? (
        <ConsentStoreListingModal
          practiceId={practiceId}
          listing={detail}
          onClose={() => setDetail(null)}
          onAddToCart={addToCart}
          substituteFor={
            detail && substituteIds.has(detail.listingId) ? includedUrn : null
          }
          onOpenListing={(listingId) => {
            const found = items.find((row) => row.listingId === listingId);
            if (found) {
              setDetail(found);
              return;
            }
            setDetail(null);
            onOpenListing?.(listingId);
          }}
        />
      ) : null}
    </div>
  );
}
