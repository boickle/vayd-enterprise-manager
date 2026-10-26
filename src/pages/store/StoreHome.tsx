import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  listingCategoryNames,
  listingInStoreCategory,
  publicHiddenStoreCategories,
  publicStoreProducts,
  storeListingImageUrl,
  type StoreListing,
} from '../../api/onlineStore';
import './Store.css';
import { useStorePracticeId } from './useStorePracticeId';

function categoryParts(raw: string | null | undefined): string[] {
  return String(raw || '')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
}

function categoryParent(raw: string | null | undefined): string {
  return categoryParts(raw)[0] || '';
}

function listingMatchesQuery(listing: StoreListing, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (listing.name.toLowerCase().includes(q)) return true;
  if (listingCategoryNames(listing).some((cat) => cat.toLowerCase().includes(q))) return true;
  return listing.variants.some(
    (variant) =>
      variant.name.toLowerCase().includes(q) ||
      (variant.code || '').toLowerCase().includes(q)
  );
}

export default function StoreHome() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState(() => searchParams.get('category')?.trim() || '');
  const [browse, setBrowse] = useState<'featured' | 'all'>('featured');
  const [items, setItems] = useState<StoreListing[]>([]);
  const [hiddenCategories, setHiddenCategories] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { practiceId, ready } = useStorePracticeId();

  const applyCategory = (next: string) => {
    setCategory(next);
    if (next) setSearchParams({ category: next }, { replace: true });
    else setSearchParams({}, { replace: true });
  };

  useEffect(() => {
    const fromUrl = searchParams.get('category')?.trim() || '';
    setCategory(fromUrl);
  }, [searchParams]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void publicHiddenStoreCategories(practiceId).then((names) => {
      if (!cancelled) setHiddenCategories(names);
    });
    void publicStoreProducts(practiceId)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {
        if (!cancelled) {
          setItems([]);
          setLoadError('Could not load the store. Try refreshing the page.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [practiceId, ready]);

  const groups = useMemo(() => {
    const isHidden = (name: string) =>
      hiddenCategories.some((h) => name === h || name.startsWith(`${h} / `));
    const parents = new Map<string, Set<string>>();
    for (const item of items) {
      for (const cat of listingCategoryNames(item)) {
        const parts = categoryParts(cat);
        if (!parts.length || isHidden(parts.join(' / '))) continue;
        const parent = parts[0];
        if (isHidden(parent)) continue;
        if (!parents.has(parent)) parents.set(parent, new Set());
        if (parts.length > 1) parents.get(parent)!.add(parts.slice(1).join(' / '));
      }
    }
    return [...parents.entries()]
      .map(([parent, kids]) => ({
        parent,
        children: [...kids].sort((a, b) => a.localeCompare(b)),
      }))
      .sort((a, b) => a.parent.localeCompare(b.parent));
  }, [items, hiddenCategories]);

  const selectedParent = categoryParent(category);
  const selectedGroup = groups.find((group) => group.parent === selectedParent);
  const childChips = selectedGroup?.children ?? [];

  const featured = useMemo(() => items.filter((item) => item.featuredOnHome), [items]);
  const hasFeatured = featured.length > 0;
  const visible = useMemo(() => {
    const matched = items.filter(
      (item) => listingMatchesQuery(item, q) && listingInStoreCategory(item, category)
    );
    if (q.trim() || category) return matched;
    if (browse === 'featured' && hasFeatured) {
      return featured.filter((item) => listingMatchesQuery(item, q));
    }
    return matched;
  }, [browse, category, featured, hasFeatured, items, q]);

  return (
    <>
      <h1>Shop Online Pharmacy</h1>
      <input
        className="vayd-store__search"
        placeholder="Search online store"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="vayd-store__chips">
        {hasFeatured && !q.trim() ? (
          <button
            type="button"
            className={`vayd-store__chip${browse === 'featured' && !category ? ' is-on' : ''}`}
            onClick={() => {
              applyCategory('');
              setBrowse('featured');
            }}
          >
            Featured
          </button>
        ) : null}
        <button
          type="button"
          className={`vayd-store__chip${(browse === 'all' || !hasFeatured || Boolean(q.trim())) && !category ? ' is-on' : ''}`}
            onClick={() => {
              applyCategory('');
              setBrowse('all');
            }}
        >
          All
        </button>
        {groups.map((group) => (
          <button
            key={group.parent}
            type="button"
            className={`vayd-store__chip${selectedParent === group.parent ? ' is-on' : ''}`}
            onClick={() => applyCategory(group.parent)}
          >
            {group.parent}
            {group.children.length ? ` (${group.children.length})` : ''}
          </button>
        ))}
      </div>
      {childChips.length ? (
        <div className="vayd-store__chips vayd-store__chips--sub">
          <button
            type="button"
            className={`vayd-store__chip${category === selectedParent ? ' is-on' : ''}`}
            onClick={() => applyCategory(selectedParent)}
          >
            All {selectedParent}
          </button>
          {childChips.map((child) => {
            const value = `${selectedParent} / ${child}`;
            return (
              <button
                key={value}
                type="button"
                className={`vayd-store__chip${category === value ? ' is-on' : ''}`}
                onClick={() => applyCategory(value)}
              >
                {child}
              </button>
            );
          })}
        </div>
      ) : null}
      {loading ? <p>Loading store items…</p> : null}
      <div className="vayd-store__grid">
        {visible.map((item) => {
          const imageSrc = storeListingImageUrl(practiceId, item);
          return (
          <Link key={item.listingId} className="vayd-store__card" to={`/store/${item.listingId}`}>
            <div className="vayd-store__card-media">
              {imageSrc ? <img src={imageSrc} alt="" /> : null}
              {item.saleActive ? (
                <div className="vayd-store__sale-banner">{item.saleLabel || 'SALE'}</div>
              ) : null}
            </div>
            <div className="vayd-store__card-body">
              <h3>{item.name}</h3>
              <div className="vayd-store__price">
                {item.saleActive && item.priceFromWas != null ? (
                  <span className="vayd-store__price-was">
                    {item.variants.length > 1 ? 'From ' : ''}
                    ${Number(item.priceFromWas).toFixed(2)}
                  </span>
                ) : null}
                {item.priceFrom != null
                  ? item.variants.length > 1
                    ? `From $${Number(item.priceFrom).toFixed(2)}`
                    : `$${Number(item.priceFrom).toFixed(2)}`
                  : 'See details'}
              </div>
              {item.variants.length > 0 &&
              item.variants.every((variant) => variant.availability?.status === 'out_of_stock') ? (
                <div className="vayd-store__badge vayd-store__badge--out">Out of stock</div>
              ) : item.variants.length > 0 &&
                item.variants.every(
                  (variant) => (variant.availability?.status ?? 'available') !== 'available',
                ) ? (
                <div className="vayd-store__badge vayd-store__badge--out">Backordered</div>
              ) : null}
              {item.featuredOnHome ? (
                <div className="vayd-store__badge vayd-store__badge--on">Featured</div>
              ) : null}
              {item.variants.length > 1 ? (
                <div className="vayd-store__badge">{item.variants.length} options</div>
              ) : null}
              {item.variants.some((variant) => variant.recommendedFrequency) ? (
                <div className="vayd-store__badge">Autoship</div>
              ) : null}
              {item.approvalTag === 'needs_doctor_approval' ? (
                <div className="vayd-store__badge">Prescription — we’ll verify</div>
              ) : null}
            </div>
          </Link>
          );
        })}
      </div>
      {!loading && !visible.length ? (
        <p>
          {loadError
            ? loadError
            : q.trim() || category
              ? 'No products match that search.'
              : 'No products are listed right now. Check back soon, or log in if you already have an account.'}
        </p>
      ) : null}
    </>
  );
}
