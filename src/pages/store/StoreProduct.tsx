import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import {
  formatBackInStock,
  publicStoreProduct,
  publicStoreProducts,
  storeListingImageUrl,
  storeVariantOrderable,
  type StoreListing,
} from '../../api/onlineStore';
import { enhanceStoreDescriptionHtml, storeListingIdFromHref } from '../../utils/storeDescriptionLinks';
import { addToStoreCart, AUTOSHIP_FREQS, formatAutoshipFrequency } from './storeCartState';
import {
  applyStoreSale,
  formatSaleEnds,
  isStoreSaleActive,
  storeLineUnitPrice,
  storeUnitPrice,
} from './storePricing';
import { expandStoreTagalongs } from '../../utils/storeTagalongs';
import { storeRecommendedFrequency } from '../../utils/storeReminderFrequency';
import StoreRebatePromo from './StoreRebatePromo';
import StoreGiftCardProduct from './StoreGiftCardProduct';
import { petDbId, useStoreMemberPricing } from './useStoreMemberPricing';
import './Store.css';
import { useStorePracticeId } from './useStorePracticeId';

function weightRangeLbs(pack: string): { low: number; high: number } | null {
  const match = pack.match(/(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)\s*(lbs?|pounds?|kg)?/i);
  if (!match) return null;
  let low = Number(match[1]);
  let high = Number(match[2]);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  if (/kg/i.test(match[3] || '')) {
    low *= 2.20462;
    high *= 2.20462;
  }
  return low <= high ? { low, high } : { low: high, high: low };
}

/** The size whose range contains this weight. A weight on a shared boundary uses the higher range. */
function packForWeight(packs: string[], lbs: number): string | null {
  const hits = packs
    .map((pack) => ({ pack, range: weightRangeLbs(pack) }))
    .filter((row): row is { pack: string; range: { low: number; high: number } } => row.range != null)
    .filter((row) => lbs + 0.001 >= row.range.low && lbs - 0.001 <= row.range.high)
    .sort((a, b) => a.range.low - b.range.low || a.range.high - b.range.high);
  return hits.length ? hits[hits.length - 1].pack : null;
}

function shortPetWeight(lbs: number | null | undefined): string | null {
  if (lbs == null || !Number.isFinite(Number(lbs)) || Number(lbs) <= 0) return null;
  const n = Number(lbs);
  return Math.abs(n - Math.round(n)) < 0.05 ? `${Math.round(n)} lb` : `${Math.round(n * 10) / 10} lb`;
}

function weighInDateLabel(at: string | null | undefined): string | null {
  if (!at) return null;
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatLastWeightLine(lbs: number | null | undefined, at: string | null | undefined): string | null {
  const shown = shortPetWeight(lbs);
  if (!shown) return null;
  const when = weighInDateLabel(at);
  if (when) return `${shown}, taken ${when}`;
  return `${shown} (weigh-in date not on file)`;
}

export default function StoreProduct() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { practiceId, ready } = useStorePracticeId();
  const { loggedIn, pets } = useStoreMemberPricing();
  const [patientId, setPatientId] = useState<number | null>(null);
  const [item, setItem] = useState<StoreListing | null>(null);
  const [catalog, setCatalog] = useState<StoreListing[]>([]);
  const [qty, setQty] = useState(1);
  const [mode, setMode] = useState<'once' | 'autoship'>('once');
  const [freq, setFreq] = useState('monthly');
  const [customOn, setCustomOn] = useState(false);
  const [customCount, setCustomCount] = useState(8);
  const [customUnit, setCustomUnit] = useState<'days' | 'weeks' | 'months'>('weeks');
  const [strength, setStrength] = useState<string | null>(null);
  const [pack, setPack] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    if (!ready) return;
    void publicStoreProducts(practiceId).then(setCatalog).catch(() => setCatalog([]));
  }, [practiceId, ready]);

  useEffect(() => {
    if (!id || !ready) return;
    void publicStoreProduct(practiceId, id).then((row) => {
      setItem(row);
      const preferred = Number(id);
      const variants = row.variants || [];
      const match = Number.isFinite(preferred)
        ? variants.find((v) => v.inventoryItemId === preferred)
        : null;
      const months = (v: (typeof variants)[number]) =>
        /month/i.test(v.strength ?? '') ? parseFloat(v.strength ?? '') || 0 : 0;
      const longest = variants.reduce<(typeof variants)[number] | undefined>(
        (best, v) => (best == null || months(v) > months(best) ? v : best),
        undefined
      );
      const first = match || (longest && months(longest) > 0 ? longest : variants[0]);
      setStrength(first?.strength ?? null);
      setPack(first?.pack ?? null);
    });
  }, [id, practiceId, ready]);

  const strengths = useMemo(() => {
    if (!item) return [];
    return [...new Set((item.variants || []).map((v) => v.strength).filter(Boolean))] as string[];
  }, [item]);

  const packsForStrength = useMemo(() => {
    if (!item) return [];
    return [
      ...new Set(
        (item.variants || [])
          .filter((v) => !strength || v.strength === strength)
          .map((v) => v.pack)
      ),
    ];
  }, [item, strength]);

  const selected = useMemo(() => {
    if (!item) return null;
    return (
      (item.variants || []).find(
        (v) =>
          (strength ? v.strength === strength : true) &&
          (pack ? v.pack === pack : true)
      ) || item.variants?.[0] || null
    );
  }, [item, strength, pack]);

  const canAutoship = Boolean(
    selected?.inventoryItemId && (item?.variants || []).some((row) => row.inventoryItemId)
  );
  const recommendedFreq = storeRecommendedFrequency(
    selected?.reminderCadence,
    selected?.recommendedFrequency,
    Math.max(1, Math.floor(Number(qty) || 1))
  );
  const lastRecommendedRef = useRef<string | null>(null);
  const petChoices = useMemo(
    () =>
      pets
        .map((pet) => ({ pet, id: petDbId(pet) }))
        .filter((row): row is { pet: (typeof pets)[number]; id: number } => row.id != null),
    [pets],
  );
  const selectedPet = petChoices.find((row) => row.id === patientId)?.pet ?? null;
  const petWeightLabel = formatLastWeightLine(selectedPet?.latestWeightLbs, selectedPet?.latestWeightAt);
  const asksForPet =
    loggedIn &&
    (canAutoship ||
      item?.approvalTag === 'needs_doctor_approval' ||
      Boolean(item?.requiresPet) ||
      (item?.variants || []).length > 1);

  useEffect(() => {
    if (patientId != null && petChoices.some((row) => row.id === patientId)) return;
    if (petChoices.length === 1) setPatientId(petChoices[0].id);
  }, [patientId, petChoices]);

  useEffect(() => {
    if (selectedPet?.latestWeightLbs == null) return;
    const match = packForWeight(packsForStrength, selectedPet.latestWeightLbs);
    if (match) setPack(match);
  }, [patientId, selectedPet?.latestWeightLbs, packsForStrength]);

  useEffect(() => {
    lastRecommendedRef.current = null;
  }, [selected?.inventoryItemId, selected?.procedureId]);

  useEffect(() => {
    if (!canAutoship) {
      setMode('once');
      setCustomOn(false);
      lastRecommendedRef.current = null;
      return;
    }
    if (!recommendedFreq) return;
    const current = customOn ? `every_${customCount}_${customUnit}` : freq;
    const shouldSnap =
      !lastRecommendedRef.current || current === lastRecommendedRef.current;
    lastRecommendedRef.current = recommendedFreq;
    if (!shouldSnap) return;
    setMode('autoship');
    if (AUTOSHIP_FREQS.some((row) => row.value === recommendedFreq)) {
      setFreq(recommendedFreq);
      setCustomOn(false);
      return;
    }
    const custom = /^every_(\d+)_(days|weeks|months)$/i.exec(recommendedFreq);
    if (custom) {
      setCustomOn(true);
      setCustomCount(Math.max(1, Number(custom[1]) || 1));
      setCustomUnit(custom[2].toLowerCase() as 'days' | 'weeks' | 'months');
    } else {
      setFreq(recommendedFreq);
      setCustomOn(false);
    }
  }, [canAutoship, customCount, customOn, customUnit, freq, recommendedFreq]);

  if (!item) return <p>Loading…</p>;
  if (item.kind === 'gift_card') return <StoreGiftCardProduct listing={item} practiceId={practiceId} />;

  const bottle = Boolean(selected?.pack?.startsWith('Bottle'));
  const stockStatus = selected?.availability?.status ?? 'available';
  const orderable = storeVariantOrderable(selected);
  const maxQty =
    stockStatus === 'available' && selected?.availability?.available != null
      ? Math.max(1, selected.availability.available)
      : null;
  const backBy = formatBackInStock(selected?.availability?.backInStockDate);
  const safeQty = Math.min(maxQty ?? Infinity, Math.max(1, Math.floor(Number(qty) || 1)));
  const listedPrice = selected?.onlineStorePrice ?? item.priceFromWas ?? item.priceFrom;
  const tierPrice = selected
    ? storeUnitPrice(selected.onlineStorePrice, selected.priceBreaks, safeQty)
    : listedPrice != null
      ? Number(listedPrice)
      : 0;
  const saleOn = isStoreSaleActive(item);
  const lineFees = selected
    ? { serviceFee: selected.serviceFee, minimumPrice: selected.minimumPrice }
    : {};
  const unitPrice = selected
    ? storeLineUnitPrice({
        base: selected.onlineStorePrice,
        breaks: selected.priceBreaks,
        sale: item,
        ...lineFees,
        qty: safeQty,
      })
    : applyStoreSale(tierPrice, item);
  const lineTotal = unitPrice * safeQty;
  const preSaleUnit = selected
    ? storeLineUnitPrice({ base: selected.onlineStorePrice, ...lineFees, qty: safeQty })
    : tierPrice;
  const qualifyingTagalongs = selected
    ? expandStoreTagalongs({ quantity: safeQty }, selected.tagalongs)
    : [];
  const compareAt =
    unitPrice < preSaleUnit - 0.005
      ? preSaleUnit
      : !selected && listedPrice != null && unitPrice < Number(listedPrice)
        ? Number(listedPrice)
        : null;
  const autoshipFrequency =
    mode === 'autoship'
      ? customOn
        ? `every_${customCount}_${customUnit}`
        : freq || null
      : null;

  return (
    <div className="vayd-store__pdp">
      <Link className="vayd-store__pdp-nav" to="/store">
        ← All products
      </Link>
      <div className="vayd-store__pdp-media">
        {storeListingImageUrl(practiceId, item, selected) ? (
          <img
            src={storeListingImageUrl(practiceId, item, selected) ?? ''}
            alt={item.name}
          />
        ) : (
          <div className="vayd-store__pdp-placeholder" aria-hidden />
        )}
        {saleOn ? (
          <div className="vayd-store__sale-banner">{item.saleLabel || 'SALE'}</div>
        ) : null}
      </div>
      <div className="vayd-store__pdp-info">
        <h1>{item.name}</h1>
        <p className="vayd-store__price">
          {compareAt != null ? (
            <span className="vayd-store__price-was">${compareAt.toFixed(2)}</span>
          ) : null}
          {selected || listedPrice != null ? `$${unitPrice.toFixed(2)}` : ''}
          {safeQty > 1 ? (
            <span className="vayd-store__price-note"> each · ${lineTotal.toFixed(2)}</span>
          ) : null}
          {selected && (item.variants || []).length > 1 ? (
            <span className="vayd-store__price-note"> · {selected.pack}</span>
          ) : null}
        </p>
        {saleOn && formatSaleEnds(item.saleEndsAt) ? (
          <p className="vayd-store__sale-ends">Sale ends {formatSaleEnds(item.saleEndsAt)}</p>
        ) : null}
        {stockStatus === 'out_of_stock' ? (
          <p className="vayd-store__stock is-out">
            Out of stock{backBy ? ` — expected back ${backBy}` : ''}
          </p>
        ) : stockStatus === 'backorder' ? (
          <p className="vayd-store__stock is-backorder">
            Backordered — order now and we’ll ship it when it’s back in stock
            {backBy ? ` (expected ${backBy})` : ''}.
          </p>
        ) : maxQty != null && maxQty <= 5 ? (
          <p className="vayd-store__stock is-low">Only {maxQty} left</p>
        ) : null}
        {item.approvalTag === 'needs_doctor_approval' ? (
          <div className="vayd-store__note">
            This is a prescription item. Anyone can order; we verify the record before we mail.
          </div>
        ) : null}
        {item.description ? (
          <div
            className="vayd-store__pdp-desc"
            dangerouslySetInnerHTML={{
              __html: enhanceStoreDescriptionHtml(item.description, catalog),
            }}
            onClick={(event) => {
              const anchor = (event.target as HTMLElement).closest('a');
              const href = anchor?.getAttribute('href') || '';
              const listingId = storeListingIdFromHref(href);
              if (listingId) {
                event.preventDefault();
                navigate(`/store/${listingId}`);
              }
            }}
          />
        ) : null}

        {strengths.length > 1 && (
          <div className="vayd-store__option">
            <div className="vayd-store__option-label">
              {strengths.every((s) => /month/i.test(s))
                ? 'Duration'
                : strengths.every((s) => /mg/i.test(s))
                  ? 'Tablet size'
                  : 'Option'}
            </div>
            <div className="vayd-store__chips">
              {strengths.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`vayd-store__chip${strength === s ? ' is-on' : ''}`}
                  onClick={() => {
                    setStrength(s);
                    const packs = (item.variants || []).filter((v) => v.strength === s).map((v) => v.pack);
                    if (pack && !packs.includes(pack)) setPack(packs[0] ?? null);
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {asksForPet ? (
          <div className="vayd-store__option">
            <div className="vayd-store__option-label">Pet</div>
            {petChoices.length ? (
              <div className="vayd-store__chips">
                {petChoices.map((row) => {
                  const weight = shortPetWeight(row.pet.latestWeightLbs);
                  const when = weighInDateLabel(row.pet.latestWeightAt);
                  const chipDetail = weight ? (when ? `${weight}, ${when}` : weight) : null;
                  return (
                    <button
                      key={row.id}
                      type="button"
                      className={`vayd-store__chip${patientId === row.id ? ' is-on' : ''}`}
                      onClick={() => setPatientId(row.id)}
                    >
                      {chipDetail ? `${row.pet.name} (${chipDetail})` : row.pet.name}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="vayd-store__autoship-note">No pets on this account yet.</p>
            )}
            {selectedPet ? (
              <p className="vayd-store__pet-weight">
                {petWeightLabel ? `Last weight ${petWeightLabel}` : 'No weight on file yet.'}
              </p>
            ) : petChoices.length > 1 ? (
              <p className="vayd-store__autoship-note">Choose the pet this is for. You can change it at checkout.</p>
            ) : null}
          </div>
        ) : !loggedIn && (item.variants || []).length > 1 ? (
          <p className="vayd-store__autoship-note">
            <Link to="/login" state={{ from: location }}>
              Sign in
            </Link>{' '}
            to choose which pet this is for and see their last weight.
          </p>
        ) : null}

        {(item.variants || []).length > 1 && (
          <div className="vayd-store__option">
            <div className="vayd-store__option-label">
              {strengths.every((s) => /month/i.test(s))
                ? 'Weight'
                : strengths.length
                  ? 'Amount'
                  : 'Size'}
            </div>
            <div className="vayd-store__chips">
              {packsForStrength.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`vayd-store__chip${pack === p ? ' is-on' : ''}`}
                  onClick={() => setPack(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="vayd-store__option">
          <div className="vayd-store__option-label">
            {bottle ? 'Number of bottles' : 'Quantity'}
          </div>
          <div className="vayd-store__stepper">
            <button
              type="button"
              aria-label="Decrease quantity"
              onClick={() => setQty((n) => Math.max(1, n - 1))}
            >
              −
            </button>
            <input
              type="number"
              min={1}
              max={maxQty ?? undefined}
              value={safeQty}
              onChange={(e) =>
                setQty(Math.min(maxQty ?? Infinity, Math.max(1, Number(e.target.value) || 1)))
              }
            />
            <button
              type="button"
              aria-label="Increase quantity"
              disabled={maxQty != null && safeQty >= maxQty}
              onClick={() => setQty((n) => Math.min(maxQty ?? Infinity, n + 1))}
            >
              +
            </button>
          </div>
        </div>
        <StoreRebatePromo rules={selected?.tagalongs} extras={qualifyingTagalongs} />
        {canAutoship ? (
        <div className="vayd-store__option">
          <div className="vayd-store__option-label">Purchase</div>
          <div className="vayd-store__chips">
            <button
              type="button"
              className={`vayd-store__chip${mode === 'once' ? ' is-on' : ''}`}
              onClick={() => setMode('once')}
            >
              Buy once
            </button>
            <button
              type="button"
              className={`vayd-store__chip vayd-store__chip--throb${mode === 'autoship' ? ' is-on' : ''}`}
              onClick={() => {
                setMode('autoship');
                if (!freq && !customOn) {
                  setFreq(recommendedFreq || 'monthly');
                }
              }}
            >
              Auto-ship
              <span className="vayd-store__chip-tag">Free shipping</span>
            </button>
          </div>
        </div>
        ) : null}
        {canAutoship && mode === 'autoship' ? (
          <div className="vayd-store__option">
            <div className="vayd-store__option-label">Frequency</div>
            <div className="vayd-store__chips">
              {AUTOSHIP_FREQS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  className={`vayd-store__chip${!customOn && freq === f.value ? ' is-on' : ''}`}
                  onClick={() => {
                    setCustomOn(false);
                    setFreq(f.value);
                  }}
                >
                  {f.label}
                  {recommendedFreq === f.value ? ' (recommended)' : ''}
                </button>
              ))}
              {recommendedFreq &&
              !AUTOSHIP_FREQS.some((row) => row.value === recommendedFreq) ? (
                <button
                  type="button"
                  className={`vayd-store__chip${!customOn && freq === recommendedFreq ? ' is-on' : ''}${
                    customOn && `every_${customCount}_${customUnit}` === recommendedFreq ? ' is-on' : ''
                  }`}
                  onClick={() => {
                    const custom = /^every_(\d+)_(days|weeks|months)$/i.exec(recommendedFreq);
                    if (custom) {
                      setCustomOn(true);
                      setCustomCount(Math.max(1, Number(custom[1]) || 1));
                      setCustomUnit(custom[2].toLowerCase() as 'days' | 'weeks' | 'months');
                    } else {
                      setCustomOn(false);
                      setFreq(recommendedFreq);
                    }
                  }}
                >
                  {formatAutoshipFrequency(recommendedFreq)} (recommended)
                </button>
              ) : null}
              <button
                type="button"
                className={`vayd-store__chip${customOn ? ' is-on' : ''}`}
                onClick={() => setCustomOn(true)}
              >
                Custom
              </button>
            </div>
            {customOn ? (
              <div className="vayd-store__custom-freq">
                <span>Every</span>
                <input
                  type="number"
                  min={1}
                  max={36}
                  value={customCount}
                  onChange={(e) => setCustomCount(Math.max(1, Number(e.target.value) || 1))}
                />
                <select
                  value={customUnit}
                  onChange={(e) => setCustomUnit(e.target.value as 'days' | 'weeks' | 'months')}
                >
                  <option value="days">days</option>
                  <option value="weeks">weeks</option>
                  <option value="months">months</option>
                </select>
              </div>
            ) : null}
            <p className="vayd-store__autoship-note">
              Free shipping. Next renewal uses this frequency from today.
            </p>
          </div>
        ) : null}
        <div className="vayd-store__actions">
          <button
            type="button"
            className="primary"
            disabled={
              !selected?.inventoryItemId ||
              !orderable ||
              (asksForPet && petChoices.length > 0 && patientId == null)
            }
            onClick={() => {
              if (!selected?.inventoryItemId || !orderable) return;
              if (asksForPet && petChoices.length > 0 && patientId == null) return;
              addToStoreCart({
                inventoryItemId: selected.inventoryItemId,
                name: selected.name,
                quantity: safeQty,
                unitPrice,
                basePrice: selected.onlineStorePrice ?? unitPrice,
                priceBreaks: selected.priceBreaks,
                serviceFee: selected.serviceFee ?? null,
                minimumPrice: selected.minimumPrice ?? null,
                sale: saleOn
                  ? {
                      saleType: item.saleType,
                      saleValue: item.saleValue,
                      saleEndsAt: item.saleEndsAt,
                      saleLabel: item.saleLabel,
                      saleActive: true,
                    }
                  : null,
                autoshipFrequency,
                recommendedFrequency: recommendedFreq,
                reminderCadence: selected.reminderCadence || null,
                listingId: item.listingId,
                storeProductId: item.storeProductId ?? null,
                hasImage: Boolean(selected.hasImage || item.hasImage),
                approvalTag: selected.approvalTag || item.approvalTag,
                requiresPet: Boolean(item.requiresPet),
                patientIds: patientId != null ? [patientId] : [],
                taxLevelValue: selected.taxLevelValue ?? null,
              });
              setAdded(true);
              window.setTimeout(() => setAdded(false), 1800);
            }}
          >
            {!orderable
              ? 'Out of stock'
              : added
                ? 'Added to cart'
                : stockStatus === 'backorder'
                  ? 'Add to cart (backorder)'
                  : 'Add to cart'}
          </button>
        </div>
      </div>
    </div>
  );
}
