import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../../auth/useAuth';
import {
  publicCheckout,
  storeApiError,
  publicPreviewCoupon,
  publicStoreCardOnFile,
  publicStoreFulfillment,
  publicStoreProducts,
  publicStoreTax,
  storeProductImageUrl,
  type StoreFulfillmentOption,
  type StoreReminderCadence,
  type StoreSavedCard,
  type StoreTagalongPreview,
} from '../../api/onlineStore';
import { AddressAutocomplete, type AddressFields } from '../../components/AddressAutocomplete';
import { ManualAddressFields } from '../../components/ManualAddressFields';
import { fetchClientInfo } from '../../api/clientPortal';
import {
  addressLinesFromParts,
  mailingAddressFields,
  mailingSameAsService,
} from '../../utils/clientVisitAddresses';
import {
  applyStoreSale,
  roundStoreMoney,
  storeTaxRateForLevel,
  storeUnitPrice,
} from './storePricing';
import StoreCartCardEntry, { type StoreCartCardEntryHandle } from './StoreCartCardEntry';
import { useAbandonedCartSync } from './useAbandonedCartSync';
import {
  formatMailPickupLocation,
  mailTypeAutoshipAllowed,
  mailTypeAutoshipOnly,
  mailTypeShowOnOnlineStore,
} from '../../utils/mailShippingTypes';
import {
  AUTOSHIP_FREQS,
  autoshipCadencePhrase,
  formatAutoshipFrequency,
  clearStorePortalReturn,
  readStoreCart,
  storePortalReturnPath,
  writeStoreCart,
  type StoreCartLine,
} from './storeCartState';
import { useStorePortalReturn } from './useStorePortalReturn';
import { expandStoreTagalongs, storeRebatePromoCopy } from '../../utils/storeTagalongs';
import { storeRecommendedFrequency } from '../../utils/storeReminderFrequency';
import { applyMemberStoreDiscount, memberDiscountForPets } from '../../utils/storeMemberPrice';
import { petDbId, useStoreMemberPricing } from './useStoreMemberPricing';
import StoreRebatePromo from './StoreRebatePromo';
import './Store.css';
import { currentPracticeId } from '../../utils/practiceIdFromToken';

function customFreqParts(frequency: string | null | undefined) {
  const match = /^every_(\d+)_(days|weeks|months)$/i.exec(frequency || '');
  if (!match) return { on: false, count: 1, unit: 'months' as const };
  return {
    on: true,
    count: Math.max(1, Number(match[1]) || 1),
    unit: match[2].toLowerCase() as 'days' | 'weeks' | 'months',
  };
}

function autoshipPlaceOrderNote(lines: StoreCartLine[]): string | null {
  const autoshipLines = lines.filter((line) => line.autoshipFrequency);
  if (!autoshipLines.length) return null;
  const cadences = [
    ...new Set(
      autoshipLines
        .map((line) => autoshipCadencePhrase(line.autoshipFrequency))
        .filter(Boolean),
    ),
  ];
  const oneTime = lines.some((line) => !line.autoshipFrequency);
  const schedule =
    cadences.length === 1
      ? cadences[0]
      : cadences.length === 2
        ? `${cadences[0]} and ${cadences[1]}`
        : `${cadences.slice(0, -1).join(', ')}, and ${cadences[cadences.length - 1]}`;
  if (oneTime) {
    return `Auto-ship items ship and charge this card ${schedule} until you cancel. One-time items are charged only for this order.`;
  }
  if (cadences.length === 1) {
    return `You'll receive a shipment and be charged ${schedule} until you cancel. You can change or stop auto-ship anytime.`;
  }
  return `You'll receive shipments and be charged on each item's schedule (${schedule}) until you cancel.`;
}

const PRACTICE_ID = currentPracticeId();

function lineNeedsApproval(line: StoreCartLine) {
  return line.approvalTag === 'needs_doctor_approval';
}

function lineNeedsPet(line: StoreCartLine) {
  return lineNeedsApproval(line) || Boolean(line.autoshipFrequency);
}

function titleCaseBrand(brand?: string | null) {
  const value = (brand || 'Card').trim();
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Card';
}

type OnFileShipAddress = {
  fields: AddressFields;
  lines: string[];
  source: 'mailing' | 'home';
};

function shipAddressComplete(ship: { line1: string; city: string; state: string; postal: string }) {
  return Boolean(ship.line1.trim() && ship.city.trim() && ship.state.trim() && ship.postal.trim());
}

function onFileShipAddress(info: Record<string, unknown> | null | undefined): OnFileShipAddress | null {
  if (!info) return null;
  const fields = mailingAddressFields(info);
  const lines = addressLinesFromParts({
    address1: fields.line1,
    address2: fields.line2,
    city: fields.city,
    state: fields.state,
    zip: fields.zip,
  });
  if (!lines.length) return null;
  return {
    fields,
    lines,
    source: mailingSameAsService(info) ? 'home' : 'mailing',
  };
}

function formatSavedCard(card: StoreSavedCard) {
  const last4 = card.last4 || '••••';
  const exp =
    card.expMonth && card.expYear
      ? ` · exp ${String(card.expMonth).padStart(2, '0')}/${String(card.expYear).slice(-2)}`
      : '';
  const used = card.recommended ? ' · last used' : '';
  return `${titleCaseBrand(card.brand)} •••• ${last4}${exp}${used}`;
}

/** Scroll whatever actually scrolls (the app shell's <main>, or the window) to the top. */
function scrollPageToTop() {
  const main = document.querySelector('main');
  if (main) main.scrollTo({ top: 0 });
  window.scrollTo({ top: 0 });
}

export default function StoreCartPage() {
  const nav = useNavigate();
  const location = useLocation();
  const portalReturn = useStorePortalReturn();
  const auth = useAuth() as {
    token?: string | null;
    userId?: string | null;
    clientInfo?: { firstName?: string; lastName?: string; email?: string } | null;
  };
  const clientId = auth.userId && Number.isFinite(Number(auth.userId)) ? Number(auth.userId) : null;
  const loggedIn = Boolean(auth.token && clientId);

  const [lines, setLines] = useState(readStoreCart);
  // Item the shopper just added from elsewhere (e.g. portal "Reorder"): scroll
  // to it and flash it briefly so the landing is obvious.
  const [highlightItemId, setHighlightItemId] = useState<number | null>(() => {
    const raw = (location.state as { highlightItemId?: unknown } | null)?.highlightItemId;
    const n = Number(raw);
    return raw != null && Number.isFinite(n) ? n : null;
  });
  const rowRefs = useRef<Record<number, HTMLTableRowElement | null>>({});
  useEffect(() => {
    if (highlightItemId == null) {
      scrollPageToTop();
      return;
    }
    // Consume the navigation state so a refresh doesn't replay the flash.
    nav(location.pathname + location.search, { replace: true, state: null });
    const row = rowRefs.current[highlightItemId];
    if (row) {
      // Rows can be tall (pet picker, autoship chips), so align the top of the
      // row rather than its middle; scroll-margin keeps it clear of the header.
      // Jump, don't animate: the offset we're leaving belongs to the previous page.
      row.scrollIntoView({ block: 'start' });
    } else {
      scrollPageToTop();
    }
    const timer = window.setTimeout(() => setHighlightItemId(null), 2600);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { pets, discounts: memberDiscounts } = useStoreMemberPricing();
  const [coupon, setCoupon] = useState('');
  const [couponOff, setCouponOff] = useState(0);
  const [couponFreeShip, setCouponFreeShip] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<StoreFulfillmentOption[]>([]);
  const [fulfillmentId, setFulfillmentId] = useState('');
  const [taxRates, setTaxRates] = useState({ name: 'Sales Tax', level1: 5.5, level2: 0, level3: 0 });
  const [tagalongsByItem, setTagalongsByItem] = useState<Record<number, StoreTagalongPreview[]>>({});
  const [cadenceByItem, setCadenceByItem] = useState<Record<number, StoreReminderCadence>>({});
  const [cards, setCards] = useState<StoreSavedCard[]>([]);
  const [selectedCardId, setSelectedCardId] = useState('');
  const [enterNewCard, setEnterNewCard] = useState(false);
  const newCardRef = useRef<StoreCartCardEntryHandle>(null);
  const [ship, setShip] = useState({
    customerName: '',
    email: '',
    line1: '',
    line2: '',
    city: '',
    state: '',
    postal: '',
  });
  const [onFileAddress, setOnFileAddress] = useState<OnFileShipAddress | null>(null);
  const [shipAddressConfirmed, setShipAddressConfirmed] = useState<'yes' | 'no' | ''>('');
  const [shipManualEntry, setShipManualEntry] = useState(false);
  const [updateMailingOnFile, setUpdateMailingOnFile] = useState<'yes' | 'no' | ''>('');

  const persist = (next: StoreCartLine[]) => {
    writeStoreCart(next);
    setLines(next);
  };

  const updateLine = (index: number, patch: Partial<StoreCartLine>) => {
    persist(
      lines.map((line, i) => {
        if (i !== index) return line;
        const prevQty = Math.max(1, Math.floor(Number(line.quantity) || 1));
        const next = { ...line, ...patch };
        const qty = Math.max(1, Math.floor(Number(next.quantity) || 1));
        next.quantity = qty;
        next.unitPrice = applyStoreSale(
          storeUnitPrice(next.basePrice ?? next.unitPrice, next.priceBreaks, qty),
          next.sale
        );
        const cadence = next.reminderCadence ?? cadenceByItem[line.inventoryItemId] ?? null;
        const prevRecommended = storeRecommendedFrequency(
          cadence,
          line.recommendedFrequency,
          prevQty
        );
        const nextRecommended = storeRecommendedFrequency(
          cadence,
          line.recommendedFrequency,
          qty
        );
        next.reminderCadence = cadence;
        next.recommendedFrequency = nextRecommended;
        if (
          line.autoshipFrequency &&
          prevRecommended &&
          line.autoshipFrequency === prevRecommended &&
          nextRecommended &&
          patch.autoshipFrequency === undefined
        ) {
          next.autoshipFrequency = nextRecommended;
        }
        return next;
      })
    );
  };

  useEffect(() => {
    void publicStoreFulfillment(PRACTICE_ID).then((rows) => {
      const visible = rows.filter((row) => mailTypeShowOnOnlineStore(row));
      setOptions(visible);
      setFulfillmentId((current) =>
        visible.some((row) => row.id === current) ? current : visible[0]?.id || ''
      );
    });
    void publicStoreTax(PRACTICE_ID)
      .then((row) => {
        setTaxRates({
          name: row.name || 'Sales Tax',
          level1: Number(row.rate) || 0,
          level2: Number(row.level2Rate) || 0,
          level3: Number(row.level3Rate) || 0,
        });
      })
      .catch(() => undefined);
    void publicStoreProducts(PRACTICE_ID)
      .then((listings) => {
        const next: Record<number, StoreTagalongPreview[]> = {};
        const cadences: Record<number, StoreReminderCadence> = {};
        for (const listing of listings) {
          for (const variant of listing.variants || []) {
            if (variant.inventoryItemId == null) continue;
            next[variant.inventoryItemId] = variant.tagalongs ?? [];
            if (variant.reminderCadence) cadences[variant.inventoryItemId] = variant.reminderCadence;
          }
        }
        setTagalongsByItem(next);
        setCadenceByItem(cadences);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!loggedIn || !clientId) return;
    void fetchClientInfo(clientId).then((info) => {
      if (!info) return;
      const onFile = onFileShipAddress(info as Record<string, unknown>);
      setOnFileAddress(onFile);
      setShip((prev) => ({
        ...prev,
        customerName:
          prev.customerName ||
          [info.firstName, info.lastName].filter(Boolean).join(' ') ||
          auth.clientInfo?.firstName ||
          '',
        email: prev.email || info.email || auth.clientInfo?.email || '',
        line1: prev.line1 || onFile?.fields.line1 || '',
        line2: prev.line2 || onFile?.fields.line2 || '',
        city: prev.city || onFile?.fields.city || '',
        state: prev.state || onFile?.fields.state || '',
        postal: prev.postal || onFile?.fields.zip || '',
      }));
    });
  }, [auth.clientInfo, clientId, loggedIn]);

  useEffect(() => {
    const email = ship.email.trim();
    if (!email) {
      setCards([]);
      setSelectedCardId('');
      return;
    }
    void publicStoreCardOnFile(PRACTICE_ID, email).then((row) => {
      const next = row.hasCard ? row.cards ?? [] : [];
      setCards(next);
      const recommended = next.find((c) => c.recommended) ?? next[0];
      setSelectedCardId(recommended?.paymentMethodId || '');
      setEnterNewCard(!next.length);
    });
  }, [ship.email]);

  const rxLines = lines.filter(lineNeedsPet);
  const needsLogin = rxLines.length > 0 && !loggedIn;
  const petsMissing = loggedIn && rxLines.some((line) => !(line.patientIds || []).length);
  const hasAutoship = lines.some((line) => line.autoshipFrequency);
  const allAutoship = lines.length > 0 && lines.every((line) => line.autoshipFrequency);
  const mixedCart = hasAutoship && !allAutoship;
  const autoshipOption = options.find((row) => mailTypeAutoshipOnly(row)) || null;
  const selectedFulfillment = options.find((row) => row.id === fulfillmentId) || null;
  const fulfillment =
    selectedFulfillment?.kind === 'pickup'
      ? selectedFulfillment
      : selectedFulfillment && (!allAutoship || mailTypeAutoshipAllowed(selectedFulfillment))
        ? selectedFulfillment
        : (allAutoship && autoshipOption) || selectedFulfillment || options[0] || null;
  const pickup = fulfillment?.kind === 'pickup';
  const extrasByIndex = useMemo(
    () =>
      lines.map((line) => expandStoreTagalongs(line, tagalongsByItem[line.inventoryItemId])),
    [lines, tagalongsByItem]
  );
  const chargedUnits = useMemo(
    () =>
      lines.map((line) =>
        applyMemberStoreDiscount(
          line.unitPrice,
          memberDiscountForPets(memberDiscounts, line.patientIds)
        )
      ),
    [lines, memberDiscounts]
  );
  const hasMemberPricing = Object.keys(memberDiscounts).length > 0;
  const subtotal = useMemo(
    () =>
      lines.reduce((n, line, i) => {
        const extras = extrasByIndex[i] ?? [];
        return (
          n +
          (chargedUnits[i] ?? line.unitPrice) * line.quantity +
          extras.reduce((sum, extra) => sum + extra.amount, 0)
        );
      }, 0),
    [chargedUnits, extrasByIndex, lines]
  );
  const shipping =
    couponFreeShip || pickup || fulfillment?.charge !== 'amount'
      ? 0
      : Number(fulfillment?.amount) || 0;
  const tax = useMemo(() => {
    let n = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      const extras = extrasByIndex[i] ?? [];
      const amount = (chargedUnits[i] ?? line.unitPrice) * line.quantity;
      const beforeAmt = extras
        .filter((extra) => extra.taxMode === 'before_tax')
        .reduce((sum, extra) => sum + extra.amount, 0);
      const share = subtotal > 0 ? amount / subtotal : 0;
      const after = Math.max(0, amount - couponOff * share);
      const rate = storeTaxRateForLevel(line.taxLevelValue ?? 1, {
        level1: taxRates.level1,
        level2: taxRates.level2,
        level3: taxRates.level3,
      });
      n += (after + beforeAmt) * rate;
      for (const extra of extras) {
        if (extra.taxMode === 'before_tax') continue;
        const extraShare = subtotal > 0 ? extra.amount / subtotal : 0;
        const extraAfter = extra.amount - couponOff * extraShare;
        const extraRate = storeTaxRateForLevel(extra.taxLevelValue ?? 0, {
          level1: taxRates.level1,
          level2: taxRates.level2,
          level3: taxRates.level3,
        });
        n += extraAfter * extraRate;
      }
    }
    if (shipping > 0) {
      n += shipping * storeTaxRateForLevel(1, {
        level1: taxRates.level1,
        level2: taxRates.level2,
        level3: taxRates.level3,
      });
    }
    return roundStoreMoney(n);
  }, [chargedUnits, couponOff, extrasByIndex, lines, shipping, subtotal, taxRates]);
  const total = Math.max(0, subtotal - couponOff + shipping + tax);
  const patientNamesById = useMemo(
    () =>
      Object.fromEntries(
        pets
          .map((pet) => [Number(pet.id), pet.name] as const)
          .filter(([id, name]) => Number.isFinite(id) && name),
      ),
    [pets],
  );
  useAbandonedCartSync(ship.email || auth.clientInfo?.email, clientId, {
    customerName: ship.customerName,
    fulfillmentLabel: fulfillment?.label || (pickup ? 'Office pickup' : null),
    estimatedTotal: total,
    patientNamesById,
  });

  useEffect(() => {
    if (!allAutoship || !autoshipOption) return;
    if (selectedFulfillment?.kind === 'pickup') return;
    if (selectedFulfillment && mailTypeAutoshipAllowed(selectedFulfillment) && !mailTypeAutoshipOnly(selectedFulfillment)) {
      return;
    }
    if (fulfillmentId !== autoshipOption.id) {
      setFulfillmentId(autoshipOption.id);
    }
  }, [allAutoship, autoshipOption, fulfillmentId, selectedFulfillment]);

  const hasOnFileShip = Boolean(onFileAddress?.lines.length);
  const shipReady = pickup
    ? true
    : hasOnFileShip
      ? shipAddressConfirmed === 'yes' ||
        (shipAddressConfirmed === 'no' && shipAddressComplete(ship))
      : shipAddressComplete(ship);
  const askUpdateMailing =
    loggedIn &&
    !pickup &&
    shipAddressComplete(ship) &&
    (shipAddressConfirmed === 'no' || !hasOnFileShip);
  const mailingUpdateReady =
    !askUpdateMailing || updateMailingOnFile === 'yes' || updateMailingOnFile === 'no';
  const canPlace =
    lines.length > 0 &&
    !needsLogin &&
    !petsMissing &&
    Boolean(ship.customerName.trim()) &&
    Boolean(ship.email.trim()) &&
    shipReady &&
    mailingUpdateReady;

  return (
    <div className="vayd-store__cart">
      <div className="vayd-store__cart-head">
        <h1>Cart</h1>
        <div className="vayd-store__cart-head-links">
          {auth.token && portalReturn ? (
            <Link
              className="ghost"
              to={storePortalReturnPath(portalReturn)}
              onClick={() => clearStorePortalReturn()}
            >
              ← Back to portal
            </Link>
          ) : null}
          <Link className="ghost" to="/store">
            {auth.token && portalReturn ? 'Keep shopping' : '← Back to store'}
          </Link>
        </div>
      </div>
      {!lines.length ? <p>Your cart is empty.</p> : null}

      {lines.length ? (
        <table className="vayd-store__cart-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => {
              const image = storeProductImageUrl(PRACTICE_ID, line.inventoryItemId);
              const rx = lineNeedsApproval(line);
              const needsPet = lineNeedsPet(line) || hasMemberPricing;
              const extras = extrasByIndex[i] ?? [];
              const cadence = line.reminderCadence ?? cadenceByItem[line.inventoryItemId] ?? null;
              const recommended = storeRecommendedFrequency(
                cadence,
                line.recommendedFrequency,
                line.quantity
              );
              const charged = chargedUnits[i] ?? line.unitPrice;
              const memberPct = memberDiscountForPets(memberDiscounts, line.patientIds);
              return (
                <Fragment key={`${line.inventoryItemId}-${i}`}>
                <tr
                  ref={(el) => {
                    rowRefs.current[line.inventoryItemId] = el;
                  }}
                  className={
                    highlightItemId === line.inventoryItemId
                      ? 'vayd-store__cart-row vayd-store__cart-row--just-added'
                      : 'vayd-store__cart-row'
                  }
                >
                  <td>
                    <div className="vayd-store__cart-item">
                      {line.hasImage !== false ? (
                        <img src={image} alt="" />
                      ) : (
                        <div className="vayd-store__cart-ph" aria-hidden />
                      )}
                      <div>
                        <strong>{line.name}</strong>
                        <div className="vayd-store__cart-meta">
                          {memberPct > 0 ? (
                            <>
                              <span className="vayd-store__price-was">${line.unitPrice.toFixed(2)}</span>
                              {' '}
                              ${charged.toFixed(2)} each · Member {memberPct}% off
                            </>
                          ) : (
                            <>${line.unitPrice.toFixed(2)} each</>
                          )}
                          {rx ? ' · Prescription' : ''}
                        </div>
                        <div className="vayd-store__cart-purchase">
                          <div className="vayd-store__chips">
                            <button
                              type="button"
                              className={`vayd-store__chip${!line.autoshipFrequency ? ' is-on' : ''}`}
                              onClick={() => updateLine(i, { autoshipFrequency: null })}
                            >
                              Buy once
                            </button>
                            <button
                              type="button"
                              className={`vayd-store__chip vayd-store__chip--throb${line.autoshipFrequency ? ' is-on' : ''}`}
                              onClick={() =>
                                updateLine(i, {
                                  autoshipFrequency:
                                    line.autoshipFrequency ||
                                    recommended ||
                                    'monthly',
                                })
                              }
                            >
                              Auto-ship
                              <span className="vayd-store__chip-tag">Free shipping</span>
                            </button>
                          </div>
                          {line.autoshipFrequency ? (
                            <>
                              <div className="vayd-store__chips">
                                {AUTOSHIP_FREQS.map((f) => (
                                  <button
                                    key={f.value}
                                    type="button"
                                    className={`vayd-store__chip${
                                      line.autoshipFrequency === f.value ? ' is-on' : ''
                                    }`}
                                    onClick={() => updateLine(i, { autoshipFrequency: f.value })}
                                  >
                                    {f.label}
                                    {recommended === f.value ? ' (recommended)' : ''}
                                  </button>
                                ))}
                                <button
                                  type="button"
                                  className={`vayd-store__chip${
                                    customFreqParts(line.autoshipFrequency).on ? ' is-on' : ''
                                  }`}
                                  onClick={() => {
                                    const current = customFreqParts(line.autoshipFrequency);
                                    updateLine(i, {
                                      autoshipFrequency: `every_${current.count}_${current.unit}`,
                                    });
                                  }}
                                >
                                  Build your own
                                </button>
                                {recommended &&
                                !AUTOSHIP_FREQS.some((row) => row.value === recommended) ? (
                                  <button
                                    type="button"
                                    className={`vayd-store__chip${
                                      line.autoshipFrequency === recommended ? ' is-on' : ''
                                    }`}
                                    onClick={() => updateLine(i, { autoshipFrequency: recommended })}
                                  >
                                    {formatAutoshipFrequency(recommended)} (recommended)
                                  </button>
                                ) : null}
                              </div>
                              {customFreqParts(line.autoshipFrequency).on ? (
                                <div className="vayd-store__custom-freq">
                                  <span>Every</span>
                                  <input
                                    type="number"
                                    min={1}
                                    max={36}
                                    value={customFreqParts(line.autoshipFrequency).count}
                                    onChange={(e) => {
                                      const unit = customFreqParts(line.autoshipFrequency).unit;
                                      updateLine(i, {
                                        autoshipFrequency: `every_${Math.max(1, Number(e.target.value) || 1)}_${unit}`,
                                      });
                                    }}
                                  />
                                  <select
                                    value={customFreqParts(line.autoshipFrequency).unit}
                                    onChange={(e) => {
                                      const count = customFreqParts(line.autoshipFrequency).count;
                                      updateLine(i, {
                                        autoshipFrequency: `every_${count}_${e.target.value}`,
                                      });
                                    }}
                                  >
                                    <option value="days">days</option>
                                    <option value="weeks">weeks</option>
                                    <option value="months">months</option>
                                  </select>
                                </div>
                              ) : (
                                <p className="vayd-store__autoship-note">
                                  Auto-ship {formatAutoshipFrequency(line.autoshipFrequency)}. Free shipping.
                                </p>
                              )}
                            </>
                          ) : null}
                        </div>
                        {needsPet && loggedIn ? (
                          <div className="vayd-store__cart-pets">
                            <span className="vayd-store__cart-pets-label">For</span>
                            <div className="vayd-store__cart-pets-list">
                              {!pets.length ? (
                                <span className="vayd-store__autoship-note">No pets on this account yet.</span>
                              ) : null}
                              {pets.map((pet) => {
                                const id = petDbId(pet);
                                if (id == null) return null;
                                const on = (line.patientIds || [])[0] === id;
                                return (
                                  <label key={id} className={on ? 'is-on' : undefined}>
                                    <input
                                      type="radio"
                                      name={`store-cart-pet-${i}`}
                                      checked={on}
                                      onChange={() => updateLine(i, { patientIds: [id] })}
                                    />
                                    {pet.name}
                                    {memberDiscounts[id] ? ` · member ${memberDiscounts[id]}% off` : ''}
                                  </label>
                                );
                              })}
                            </div>
                            {!(line.patientIds || []).length ? (
                              <p className="vayd-store__autoship-note">Choose the pet this is for.</p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="vayd-store__stepper">
                      <button type="button" onClick={() => updateLine(i, { quantity: line.quantity - 1 })}>
                        −
                      </button>
                      <input
                        type="number"
                        min={1}
                        value={line.quantity}
                        onChange={(e) => updateLine(i, { quantity: Number(e.target.value) || 1 })}
                      />
                      <button type="button" onClick={() => updateLine(i, { quantity: line.quantity + 1 })}>
                        +
                      </button>
                    </div>
                  </td>
                  <td>${(charged * line.quantity).toFixed(2)}</td>
                  <td>
                    <button type="button" className="ghost" onClick={() => persist(lines.filter((_, idx) => idx !== i))}>
                      Remove
                    </button>
                  </td>
                </tr>
                {storeRebatePromoCopy(tagalongsByItem[line.inventoryItemId]) ? (
                  <tr className="vayd-store__cart-tagalong">
                    <td colSpan={4}>
                      <StoreRebatePromo rules={tagalongsByItem[line.inventoryItemId]} extras={extras} />
                    </td>
                  </tr>
                ) : null}
                {extras.map((extra) => (
                  <tr key={`${line.inventoryItemId}-tagalong-${extra.ruleId}`} className="vayd-store__cart-tagalong">
                    <td>
                      <div className="vayd-store__cart-item">
                        <div className="vayd-store__cart-ph" aria-hidden />
                        <div>
                          <strong>{extra.name}</strong>
                          <div className="vayd-store__cart-meta">
                            Added with this item
                            {extra.taxMode === 'before_tax' ? ' · included in product tax' : ''}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>{extra.qty}</td>
                    <td>${extra.amount.toFixed(2)}</td>
                    <td />
                  </tr>
                ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      ) : null}

      {needsLogin ? (
        <div className="vayd-store__note">
          Auto-ship and prescription items need a client login so we can attach them to the right pet.
          <div className="vayd-store__actions">
            <Link
              className="primary"
              to="/login"
              state={{ from: { pathname: '/store/cart' } }}
            >
              Log in to continue
            </Link>
          </div>
        </div>
      ) : null}

      {lines.length ? (
        <div className="vayd-store__cart-grid">
          <section>
            <h2>Fulfillment</h2>
            <div className="vayd-store__chips">
              {options
                .filter((option) => {
                  if (mailTypeAutoshipOnly(option)) return allAutoship && option.kind === 'pickup';
                  if (allAutoship && option.kind === 'shipping' && !mailTypeAutoshipAllowed(option)) {
                    return false;
                  }
                  return true;
                })
                .map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`vayd-store__chip${fulfillmentId === option.id ? ' is-on' : ''}`}
                    onClick={() => setFulfillmentId(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              {allAutoship && autoshipOption ? (
                <button
                  type="button"
                  className={`vayd-store__chip${
                    fulfillmentId === autoshipOption.id ||
                    (!pickup && fulfillment != null && mailTypeAutoshipOnly(fulfillment))
                      ? ' is-on'
                      : ''
                  }`}
                  onClick={() => setFulfillmentId(autoshipOption.id)}
                >
                  Ship
                </button>
              ) : null}
            </div>
            {pickup ? (
              <div className="vayd-store__autoship-note">
                {formatMailPickupLocation(fulfillment?.pickupLocation).length ? (
                  <p style={{ margin: 0 }}>
                    {formatMailPickupLocation(fulfillment?.pickupLocation).join(' · ')}
                  </p>
                ) : null}
                {fulfillment?.clientInstructions ? (
                  <p style={{ margin: formatMailPickupLocation(fulfillment?.pickupLocation).length ? '8px 0 0' : 0 }}>
                    {fulfillment.clientInstructions}
                  </p>
                ) : (
                  <p style={{ margin: formatMailPickupLocation(fulfillment?.pickupLocation).length ? '8px 0 0' : 0 }}>
                    You’ll get a notification when your pick-up is ready. No shipping charge for pickup.
                  </p>
                )}
              </div>
            ) : mixedCart ? (
              <p className="vayd-store__autoship-note">
                This order includes a one-time item, so shipping is charged now. Later auto-ship
                renewals use free auto-ship shipping.
              </p>
            ) : allAutoship && autoshipOption ? (
              <p className="vayd-store__autoship-note">
                Auto-ship includes free shipping
                {autoshipOption.estimatedDaysToFill != null
                  ? ` · usually filled in ${autoshipOption.estimatedDaysToFill} business day${autoshipOption.estimatedDaysToFill === 1 ? '' : 's'}`
                  : ''}
                .
              </p>
            ) : fulfillment?.estimatedDaysToFill != null ? (
              <p className="vayd-store__autoship-note">
                Usually filled in {fulfillment.estimatedDaysToFill} business day
                {fulfillment.estimatedDaysToFill === 1 ? '' : 's'}. Shipping is charged now.
              </p>
            ) : (
              <p className="vayd-store__autoship-note">
                Shipping & handling is added below and charged now.
              </p>
            )}

            <h2>{pickup ? 'Your details' : 'Ship to'}</h2>
            <div className="vayd-store__cart-fields">
              <label>
                Name
                <input value={ship.customerName} onChange={(e) => setShip({ ...ship, customerName: e.target.value })} />
              </label>
              <label>
                Email
                <input value={ship.email} onChange={(e) => setShip({ ...ship, email: e.target.value })} />
              </label>
            </div>
            {!pickup ? (
              <div className="vayd-store__ship-address">
                {hasOnFileShip ? (
                  <p className="vayd-store__question">
                    Is this the mailing address you want us to send this to?
                  </p>
                ) : (
                  <p className="vayd-store__question">Where should we send this?</p>
                )}
                <p className="vayd-store__muted">PO Boxes are fine.</p>
                {hasOnFileShip && onFileAddress ? (
                  <>
                    <div className="vayd-store__address-card">
                      {onFileAddress.lines.map((line) => (
                        <div key={line}>{line}</div>
                      ))}
                      <div className="vayd-store__address-note">
                        {onFileAddress.source === 'mailing'
                          ? 'Mailing address on file'
                          : 'Home address on file — we do not have a separate mailing address'}
                      </div>
                    </div>
                    <div className="vayd-store__choices">
                      {(
                        [
                          { value: 'yes', label: 'Yes — send it here' },
                          { value: 'no', label: 'No — I’ll enter a different address' },
                        ] as const
                      ).map((row) => (
                        <label
                          key={row.value}
                          className={`vayd-store__choice${shipAddressConfirmed === row.value ? ' is-on' : ''}`}
                        >
                          <input
                            type="radio"
                            name="store-ship-confirm"
                            checked={shipAddressConfirmed === row.value}
                            onChange={() => {
                              setShipAddressConfirmed(row.value);
                              setUpdateMailingOnFile('');
                              setShipManualEntry(false);
                              if (row.value === 'yes') {
                                setShip((prev) => ({
                                  ...prev,
                                  line1: onFileAddress.fields.line1,
                                  line2: onFileAddress.fields.line2 || '',
                                  city: onFileAddress.fields.city,
                                  state: onFileAddress.fields.state || '',
                                  postal: onFileAddress.fields.zip,
                                }));
                              } else {
                                setShip((prev) => ({
                                  ...prev,
                                  line1: '',
                                  line2: '',
                                  city: '',
                                  state: '',
                                  postal: '',
                                }));
                              }
                            }}
                          />
                          <span>{row.label}</span>
                        </label>
                      ))}
                    </div>
                  </>
                ) : null}
                {!hasOnFileShip || shipAddressConfirmed === 'no' ? (
                  <div className="vayd-store__address-edit">
                    <p className="vayd-store__muted">
                      Predictive search works for street addresses. Check the box below if
                      yours is a PO Box or is not listed.
                    </p>
                    <label className="vayd-store__po-box">
                      <input
                        type="checkbox"
                        checked={shipManualEntry}
                        onChange={(e) => {
                          const manual = e.target.checked;
                          setShipManualEntry(manual);
                          setShip((prev) => ({
                            ...prev,
                            line1: '',
                            line2: '',
                            city: '',
                            state: '',
                            postal: '',
                          }));
                        }}
                      />
                      <span>
                        This address is a PO Box or isn&apos;t listed — I&apos;ll enter it
                        manually
                      </span>
                    </label>
                    {shipManualEntry ? (
                      <ManualAddressFields
                        value={{
                          line1: ship.line1,
                          line2: ship.line2 || undefined,
                          city: ship.city,
                          state: ship.state,
                          zip: ship.postal,
                          country: 'US',
                        }}
                        onChange={(next) => {
                          setShip((prev) => ({
                            ...prev,
                            line1: next.line1 || '',
                            line2: next.line2 || '',
                            city: next.city || '',
                            state: next.state || '',
                            postal: next.zip || '',
                          }));
                        }}
                        errors={{}}
                        errorPrefix="ship"
                        line1Placeholder="PO Box 123 or street address"
                      />
                    ) : (
                      <AddressAutocomplete
                        compact
                        showConfirmedMessage={false}
                        placeholder="Start typing the street address"
                        inputClassName="vayd-store__address-input"
                        value={{
                          line1: ship.line1,
                          line2: ship.line2 || undefined,
                          city: ship.city,
                          state: ship.state,
                          zip: ship.postal,
                          country: 'US',
                        }}
                        onChange={(next: AddressFields) => {
                          setShip((prev) => ({
                            ...prev,
                            line1: next.line1 || prev.line1,
                            line2: next.line2 || prev.line2,
                            city: next.city || prev.city,
                            state: next.state || prev.state,
                            postal: next.zip || prev.postal,
                          }));
                        }}
                      />
                    )}
                  </div>
                ) : null}
                {askUpdateMailing ? (
                  <div className="vayd-store__update-mailing">
                    <p className="vayd-store__question">
                      Would you like us to update the mailing address we have on file
                      with this one?
                    </p>
                    <div className="vayd-store__choices">
                      {(
                        [
                          { value: 'yes', label: 'Yes — save this as my mailing address' },
                          { value: 'no', label: 'No — just use it for this order' },
                        ] as const
                      ).map((row) => (
                        <label
                          key={row.value}
                          className={`vayd-store__choice${updateMailingOnFile === row.value ? ' is-on' : ''}`}
                        >
                          <input
                            type="radio"
                            name="store-update-mailing"
                            checked={updateMailingOnFile === row.value}
                            onChange={() => setUpdateMailingOnFile(row.value)}
                          />
                          <span>{row.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <aside className="vayd-store__cart-summary">
            <h2>Total</h2>
            <label className="vayd-store__cart-coupon">
              Coupon
              <span>
                <input value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder="Code" />
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    void publicPreviewCoupon(PRACTICE_ID, coupon, subtotal)
                      .then((p) => {
                        setCouponOff(p.discount);
                        setCouponFreeShip(Boolean(p.freeShipping));
                      })
                      .catch((e) => setErr(e instanceof Error ? e.message : 'Coupon failed'));
                  }}
                >
                  Apply
                </button>
              </span>
            </label>
            <table>
              <tbody>
                <tr>
                  <th>Subtotal</th>
                  <td>${subtotal.toFixed(2)}</td>
                </tr>
                {couponOff ? (
                  <tr>
                    <th>Coupon</th>
                    <td>−${couponOff.toFixed(2)}</td>
                  </tr>
                ) : null}
                <tr>
                  <th>{pickup ? 'Pickup' : 'Shipping'}</th>
                  <td>{shipping ? `$${shipping.toFixed(2)}` : 'Free'}</td>
                </tr>
                <tr>
                  <th>{taxRates.name || 'Sales tax'}</th>
                  <td>${tax.toFixed(2)}</td>
                </tr>
                <tr className="vayd-store__cart-grand">
                  <th>Total</th>
                  <td>${total.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
            {cards.length && !enterNewCard ? (
              <div className="vayd-store__card-pay">
                <label>
                  Card on file
                  <select
                    className="vayd-store__card-select"
                    value={selectedCardId}
                    onChange={(e) => setSelectedCardId(e.target.value)}
                  >
                    {cards.map((saved) => (
                      <option key={saved.paymentMethodId} value={saved.paymentMethodId}>
                        {formatSavedCard(saved)}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="vayd-store__card-link" onClick={() => setEnterNewCard(true)}>
                  Use a different card
                </button>
              </div>
            ) : (
              <StoreCartCardEntry
                ref={newCardRef}
                billingPrefill={{
                  name: ship.customerName,
                  email: ship.email,
                  line1: ship.line1,
                  line2: ship.line2,
                  city: ship.city,
                  state: ship.state,
                  postal: ship.postal,
                }}
                onClose={cards.length ? () => setEnterNewCard(false) : undefined}
              />
            )}
            {petsMissing ? (
              <p className="vayd-store__err">Choose which pet each auto-ship or prescription item is for.</p>
            ) : null}
            {err ? <p className="vayd-store__err">{err}</p> : null}
            {hasAutoship ? (
              <p className="vayd-store__autoship-note vayd-store__autoship-note--checkout">
                {autoshipPlaceOrderNote(lines)}
              </p>
            ) : null}
            <button
              type="button"
              className="primary vayd-store__place"
              disabled={busy || !canPlace}
              onClick={() => {
                setBusy(true);
                setErr(null);
                void (async () => {
                  let paymentMethodId: string | null = null;
                  let saveCard = true;
                  if (enterNewCard || !cards.length) {
                    const created = await newCardRef.current?.createPaymentMethod();
                    paymentMethodId = created?.paymentMethodId ?? null;
                    saveCard = created?.saveCard !== false;
                  } else {
                    paymentMethodId = selectedCardId || null;
                  }
                  const order = await publicCheckout(PRACTICE_ID, {
                    customerName: ship.customerName,
                    customerEmail: ship.email,
                    couponCode: coupon || undefined,
                    clientId,
                    fulfillmentId: fulfillment?.id || null,
                    paymentMethodId,
                    saveCard,
                    updateMailingOnFile: askUpdateMailing && updateMailingOnFile === 'yes',
                    ship: {
                      name: ship.customerName,
                      line1: ship.line1,
                      line2: ship.line2,
                      city: ship.city,
                      state: ship.state,
                      postal: ship.postal,
                    },
                    lines: lines.map((l) => ({
                      inventoryItemId: l.inventoryItemId,
                      quantity: l.quantity,
                      autoshipFrequency: l.autoshipFrequency,
                      patientIds: l.patientIds || [],
                    })),
                  });
                  writeStoreCart([]);
                  nav(`/store/thanks/${order.id}`, { state: { order } });
                })()
                  .catch((e) => setErr(storeApiError(e)))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? 'Placing order…' : 'Place order'}
            </button>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
