import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../../auth/useAuth';
import {
  publicCheckout,
  storeApiError,
  publicPreviewCoupon,
  publicStoreCardOnFile,
  publicStoreFulfillment,
  publicStoreTax,
  storeProductImageUrl,
  type StoreFulfillmentOption,
  type StoreSavedCard,
} from '../../api/onlineStore';
import { AddressAutocomplete, type AddressFields } from '../../components/AddressAutocomplete';
import { fetchClientInfo, fetchClientPets, type Pet } from '../../api/clientPortal';
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
  formatAutoshipFrequency,
  readStoreCart,
  writeStoreCart,
  type StoreCartLine,
} from './storeCartState';
import './Store.css';

function customFreqParts(frequency: string | null | undefined) {
  const match = /^every_(\d+)_(days|weeks|months)$/i.exec(frequency || '');
  if (!match) return { on: false, count: 8, unit: 'weeks' as const };
  const unit = match[2].toLowerCase();
  return {
    on: true,
    count: Math.max(1, Number(match[1]) || 8),
    unit: unit === 'days' || unit === 'months' ? (unit as 'days' | 'months') : ('weeks' as const),
  };
}

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

function petDbId(pet: Pet): number | null {
  const raw = pet.dbId ?? pet.id;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

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

function formatSavedCard(card: StoreSavedCard) {
  const last4 = card.last4 || '••••';
  const exp =
    card.expMonth && card.expYear
      ? ` · exp ${String(card.expMonth).padStart(2, '0')}/${String(card.expYear).slice(-2)}`
      : '';
  const used = card.recommended ? ' · last used' : '';
  return `${titleCaseBrand(card.brand)} •••• ${last4}${exp}${used}`;
}

export default function StoreCartPage() {
  const nav = useNavigate();
  const auth = useAuth() as {
    token?: string | null;
    userId?: string | null;
    clientInfo?: { firstName?: string; lastName?: string; email?: string } | null;
  };
  const clientId = auth.userId && Number.isFinite(Number(auth.userId)) ? Number(auth.userId) : null;
  const loggedIn = Boolean(auth.token && clientId);

  const [lines, setLines] = useState(readStoreCart);
  const [pets, setPets] = useState<Pet[]>([]);
  const [coupon, setCoupon] = useState('');
  const [couponOff, setCouponOff] = useState(0);
  const [couponFreeShip, setCouponFreeShip] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<StoreFulfillmentOption[]>([]);
  const [fulfillmentId, setFulfillmentId] = useState('');
  const [taxRates, setTaxRates] = useState({ name: 'Sales Tax', level1: 5.5, level2: 0, level3: 0 });
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
    state: 'ME',
    postal: '',
  });

  const persist = (next: StoreCartLine[]) => {
    writeStoreCart(next);
    setLines(next);
  };

  const updateLine = (index: number, patch: Partial<StoreCartLine>) => {
    persist(
      lines.map((line, i) => {
        if (i !== index) return line;
        const next = { ...line, ...patch };
        const qty = Math.max(1, Math.floor(Number(next.quantity) || 1));
        next.quantity = qty;
        next.unitPrice = applyStoreSale(
          storeUnitPrice(next.basePrice ?? next.unitPrice, next.priceBreaks, qty),
          next.sale
        );
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
  }, []);

  useEffect(() => {
    if (!loggedIn || !clientId) return;
    void fetchClientPets().then(setPets).catch(() => setPets([]));
    void fetchClientInfo(clientId).then((info) => {
      if (!info) return;
      setShip((prev) => ({
        ...prev,
        customerName:
          prev.customerName ||
          [info.firstName, info.lastName].filter(Boolean).join(' ') ||
          auth.clientInfo?.firstName ||
          '',
        email: prev.email || info.email || auth.clientInfo?.email || '',
        line1: prev.line1 || info.address1 || info.mailingAddress1 || '',
        line2: prev.line2 || info.address2 || info.mailingAddress2 || '',
        city: prev.city || info.city || info.mailingCity || '',
        state: prev.state || info.state || info.mailingState || 'ME',
        postal: prev.postal || info.zipcode || info.mailingZipcode || '',
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
  const subtotal = useMemo(
    () => lines.reduce((n, line) => n + line.unitPrice * line.quantity, 0),
    [lines]
  );
  const shipping =
    couponFreeShip || pickup || fulfillment?.charge !== 'amount'
      ? 0
      : Number(fulfillment?.amount) || 0;
  const tax = useMemo(() => {
    let n = 0;
    for (const line of lines) {
      const amount = line.unitPrice * line.quantity;
      const share = subtotal > 0 ? amount / subtotal : 0;
      const after = Math.max(0, amount - couponOff * share);
      const rate = storeTaxRateForLevel(line.taxLevelValue ?? 1, {
        level1: taxRates.level1,
        level2: taxRates.level2,
        level3: taxRates.level3,
      });
      n += after * rate;
    }
    if (shipping > 0) {
      n += shipping * storeTaxRateForLevel(1, {
        level1: taxRates.level1,
        level2: taxRates.level2,
        level3: taxRates.level3,
      });
    }
    return roundStoreMoney(n);
  }, [couponOff, lines, shipping, subtotal, taxRates]);
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

  const canPlace =
    lines.length > 0 &&
    !needsLogin &&
    !petsMissing &&
    Boolean(ship.customerName.trim()) &&
    Boolean(ship.email.trim()) &&
    (pickup || Boolean(ship.line1.trim()));

  return (
    <div className="vayd-store__cart">
      <div className="vayd-store__cart-head">
        <h1>Cart</h1>
        <Link className="ghost" to="/store">
          ← Back to store
        </Link>
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
              const needsPet = lineNeedsPet(line);
              return (
                <tr key={`${line.inventoryItemId}-${i}`}>
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
                          ${line.unitPrice.toFixed(2)} each
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
                                    line.recommendedFrequency ||
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
                                    {line.recommendedFrequency === f.value ? ' (recommended)' : ''}
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
                  <td>${(line.unitPrice * line.quantity).toFixed(2)}</td>
                  <td>
                    <button type="button" className="ghost" onClick={() => persist(lines.filter((_, idx) => idx !== i))}>
                      Remove
                    </button>
                  </td>
                </tr>
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
            {!pickup ? <p className="vayd-store__note">PO Boxes are fine.</p> : null}
            <div className="vayd-store__cart-fields">
              <label>
                Name
                <input value={ship.customerName} onChange={(e) => setShip({ ...ship, customerName: e.target.value })} />
              </label>
              <label>
                Email
                <input value={ship.email} onChange={(e) => setShip({ ...ship, email: e.target.value })} />
              </label>
              {!pickup ? (
                <>
                  <label className="vayd-store__cart-wide">
                    Address
                    <AddressAutocomplete
                      compact
                      showConfirmedMessage={false}
                      placeholder="Start typing the street address"
                      inputClassName="vayd-store__address-input"
                      value={{
                        line1: ship.line1,
                        city: ship.city,
                        state: ship.state,
                        zip: ship.postal,
                        country: 'US',
                      }}
                      onChange={(next: AddressFields) => {
                        setShip((prev) => ({
                          ...prev,
                          line1: next.line1 || prev.line1,
                          city: next.city || prev.city,
                          state: next.state || prev.state,
                          postal: next.zip || prev.postal,
                        }));
                      }}
                    />
                  </label>
                  <label>
                    Apt / PO Box
                    <input value={ship.line2} onChange={(e) => setShip({ ...ship, line2: e.target.value })} />
                  </label>
                  <label>
                    City
                    <input value={ship.city} onChange={(e) => setShip({ ...ship, city: e.target.value })} />
                  </label>
                  <label>
                    State
                    <input value={ship.state} onChange={(e) => setShip({ ...ship, state: e.target.value })} />
                  </label>
                  <label>
                    ZIP
                    <input value={ship.postal} onChange={(e) => setShip({ ...ship, postal: e.target.value })} />
                  </label>
                </>
              ) : null}
            </div>
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
