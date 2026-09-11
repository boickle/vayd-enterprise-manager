import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  publicStoreProduct,
  publicStoreProducts,
  storeListingImageUrl,
  type StoreListing,
} from '../../api/onlineStore';
import { enhanceStoreDescriptionHtml, storeListingIdFromHref } from '../../utils/storeDescriptionLinks';
import { addToStoreCart, AUTOSHIP_FREQS } from './storeCartState';
import { applyStoreSale, formatSaleEnds, isStoreSaleActive, storeUnitPrice } from './storePricing';
import './Store.css';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

export default function StoreProduct() {
  const { id } = useParams();
  const navigate = useNavigate();
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
    void publicStoreProducts(PRACTICE_ID).then(setCatalog).catch(() => setCatalog([]));
  }, []);

  useEffect(() => {
    if (!id) return;
    void publicStoreProduct(PRACTICE_ID, id).then((row) => {
      setItem(row);
      const preferred = Number(id);
      const variants = row.variants || [];
      const match = Number.isFinite(preferred)
        ? variants.find((v) => v.inventoryItemId === preferred)
        : null;
      const first = match || variants[0];
      setStrength(first?.strength ?? null);
      setPack(first?.pack ?? null);
    });
  }, [id]);

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

  useEffect(() => {
    if (!canAutoship) {
      setMode('once');
      setCustomOn(false);
      return;
    }
    const recommended = selected?.recommendedFrequency || '';
    const preset = AUTOSHIP_FREQS.some((row) => row.value === recommended);
    if (recommended) {
      setMode('autoship');
      if (preset) {
        setFreq(recommended);
        setCustomOn(false);
      } else {
        const custom = /^every_(\d+)_(days|weeks|months)$/i.exec(recommended);
        if (custom) {
          setCustomOn(true);
          setCustomCount(Math.max(1, Number(custom[1]) || 1));
          setCustomUnit(custom[2].toLowerCase() as 'days' | 'weeks' | 'months');
        } else {
          setFreq('monthly');
          setCustomOn(false);
        }
      }
    } else {
      setMode('once');
      setCustomOn(false);
    }
  }, [canAutoship, selected?.inventoryItemId, selected?.procedureId, selected?.recommendedFrequency]);

  if (!item) return <p>Loading…</p>;

  const bottle = Boolean(selected?.pack?.startsWith('Bottle'));
  const safeQty = Math.max(1, Math.floor(Number(qty) || 1));
  const listedPrice = selected?.onlineStorePrice ?? item.priceFromWas ?? item.priceFrom;
  const tierPrice = selected
    ? storeUnitPrice(selected.onlineStorePrice, selected.priceBreaks, safeQty)
    : listedPrice != null
      ? Number(listedPrice)
      : 0;
  const saleOn = isStoreSaleActive(item);
  const unitPrice = applyStoreSale(tierPrice, item);
  const lineTotal = unitPrice * safeQty;
  const compareAt =
    saleOn && unitPrice < tierPrice
      ? tierPrice
      : listedPrice != null && unitPrice < Number(listedPrice)
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
        {storeListingImageUrl(PRACTICE_ID, item, selected) ? (
          <img
            src={storeListingImageUrl(PRACTICE_ID, item, selected) ?? ''}
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
              value={qty}
              onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
            />
            <button
              type="button"
              aria-label="Increase quantity"
              onClick={() => setQty((n) => n + 1)}
            >
              +
            </button>
          </div>
        </div>
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
                  setFreq(selected?.recommendedFrequency || 'monthly');
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
                  {selected?.recommendedFrequency === f.value ? ' (recommended)' : ''}
                </button>
              ))}
              <button
                type="button"
                className={`vayd-store__chip${customOn ? ' is-on' : ''}`}
                onClick={() => setCustomOn(true)}
              >
                Build your own
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
            disabled={!selected?.inventoryItemId}
            onClick={() => {
              if (!selected?.inventoryItemId) return;
              addToStoreCart({
                inventoryItemId: selected.inventoryItemId,
                name: selected.name,
                quantity: safeQty,
                unitPrice,
                basePrice: selected.onlineStorePrice ?? unitPrice,
                priceBreaks: selected.priceBreaks,
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
                recommendedFrequency: selected.recommendedFrequency || null,
                listingId: item.listingId,
                storeProductId: item.storeProductId ?? null,
                hasImage: Boolean(selected.hasImage || item.hasImage),
                approvalTag: selected.approvalTag || item.approvalTag,
                patientIds: [],
                taxLevelValue: selected.taxLevelValue ?? null,
              });
              setAdded(true);
              window.setTimeout(() => setAdded(false), 1800);
            }}
          >
            {added ? 'Added to cart' : 'Add to cart'}
          </button>
        </div>
      </div>
    </div>
  );
}
