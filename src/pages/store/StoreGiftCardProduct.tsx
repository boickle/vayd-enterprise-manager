import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { storeListingImageUrl, type StoreListing } from '../../api/onlineStore';
import { addGiftCardToCart, isoDateOnly } from './storeCartState';
import {
  formatSaleEnds,
  isStoreSaleActive,
  storeGiftCardAmountError,
  storeGiftCardPrice,
} from './storePricing';
import { useStoreMemberPricing } from './useStoreMemberPricing';
import { useAuth } from '../../auth/useAuth';
import './Store.css';

const MESSAGE_MAX = 500;
const FROM_MAX = 120;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function money(n: number) {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

export default function StoreGiftCardProduct({
  listing,
  practiceId,
}: {
  listing: StoreListing;
  practiceId: number;
}) {
  const auth = useAuth() as { clientInfo?: { firstName?: string; lastName?: string } | null };
  const { loggedIn } = useStoreMemberPricing();
  const rules = listing.giftCard ?? {
    amounts: [],
    allowCustom: false,
    min: null,
    max: null,
    terms: null,
    displayTerms: null,
  };
  const [preset, setPreset] = useState<number | null>(rules.amounts[1] ?? rules.amounts[0] ?? null);
  const [custom, setCustom] = useState('');
  const [usingCustom, setUsingCustom] = useState(!rules.amounts.length);
  const [forSelf, setForSelf] = useState(false);
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [fromName, setFromName] = useState(
    [auth.clientInfo?.firstName, auth.clientInfo?.lastName].filter(Boolean).join(' ')
  );
  const [message, setMessage] = useState('');
  const [schedule, setSchedule] = useState(false);
  const [deliverAt, setDeliverAt] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [added, setAdded] = useState(false);

  const saleOn = isStoreSaleActive(listing);
  const amount = usingCustom ? Number(custom) : Number(preset);
  const amountError = storeGiftCardAmountError(amount, rules);
  const price = amountError ? null : storeGiftCardPrice(amount, listing);
  const tomorrow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return isoDateOnly(d);
  }, []);
  const lastDay = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return isoDateOnly(d);
  }, []);

  const recipientError = forSelf
    ? null
    : !recipientName.trim()
      ? 'Enter who the gift card is for.'
      : !EMAIL_RE.test(recipientEmail.trim())
        ? "Enter the recipient's email so we can send it."
        : null;
  const scheduleError =
    schedule && (!deliverAt || deliverAt < tomorrow || deliverAt > lastDay)
      ? 'Pick a delivery date between tomorrow and a year from now.'
      : null;
  const blocker = amountError || recipientError || scheduleError;
  const image = storeListingImageUrl(practiceId, listing, null);

  const add = () => {
    if (blocker || price == null) {
      setShowErrors(true);
      return;
    }
    addGiftCardToCart({
      listingId: listing.listingId,
      name: listing.name,
      amount,
      price,
      quantity: 1,
      sendToSelf: forSelf,
      recipientName: forSelf ? '' : recipientName.trim(),
      recipientEmail: forSelf ? '' : recipientEmail.trim(),
      fromName: forSelf ? '' : fromName.trim().slice(0, FROM_MAX),
      message: forSelf ? '' : message.trim().slice(0, MESSAGE_MAX),
      deliverAt: schedule ? deliverAt : '',
    });
    setAdded(true);
    setShowErrors(false);
    setRecipientName('');
    setRecipientEmail('');
    setMessage('');
    setSchedule(false);
    setDeliverAt('');
  };

  return (
    <div className="vayd-store__pdp vayd-store__gift">
      <Link className="vayd-store__pdp-nav" to="/store">
        ← All products
      </Link>
      <div className="vayd-store__pdp-media">
        {image ? (
          <img src={image} alt={listing.name} />
        ) : (
          <div className="vayd-store__gift-art" aria-hidden>
            <span className="vayd-store__gift-art-label">Gift card</span>
            <span className="vayd-store__gift-art-amount">{amountError ? '' : money(amount)}</span>
          </div>
        )}
        {saleOn ? (
          <div className="vayd-store__sale-banner">{listing.saleLabel || 'SALE'}</div>
        ) : null}
      </div>
      <div className="vayd-store__pdp-info">
        <h1>{listing.name}</h1>
        <p className="vayd-store__price">
          {price != null && price < amount - 0.005 ? (
            <>
              <span className="vayd-store__price-was">{money(amount)}</span>
              {money(price)}
              <span className="vayd-store__price-note"> for a {money(amount)} gift card</span>
            </>
          ) : price != null ? (
            money(price)
          ) : (
            ''
          )}
        </p>
        {saleOn && formatSaleEnds(listing.saleEndsAt) ? (
          <p className="vayd-store__sale-ends">Sale ends {formatSaleEnds(listing.saleEndsAt)}</p>
        ) : null}
        {listing.description ? (
          <div
            className="vayd-store__pdp-desc"
            dangerouslySetInnerHTML={{ __html: listing.description }}
          />
        ) : (
          <p className="vayd-store__pdp-desc">
            Good toward visits, services, and anything in our online store. Delivered by email, with
            a printable copy.
          </p>
        )}

        <p className="vayd-store__question">Amount</p>
        <div className="vayd-store__chips">
          {rules.amounts.map((value) => {
            const pay = storeGiftCardPrice(value, listing);
            return (
              <button
                key={value}
                type="button"
                className={`vayd-store__chip${!usingCustom && preset === value ? ' is-on' : ''}`}
                onClick={() => {
                  setPreset(value);
                  setUsingCustom(false);
                }}
              >
                {money(value)}
                {pay < value - 0.005 ? (
                  <span className="vayd-store__chip-tag">pay {money(pay)}</span>
                ) : null}
              </button>
            );
          })}
          {rules.allowCustom ? (
            <button
              type="button"
              className={`vayd-store__chip${usingCustom ? ' is-on' : ''}`}
              onClick={() => setUsingCustom(true)}
            >
              Other amount
            </button>
          ) : null}
        </div>
        {usingCustom ? (
          <label className="vayd-store__gift-custom">
            Amount
            <span className="vayd-store__gift-dollar">
              <span aria-hidden>$</span>
              <input
                inputMode="decimal"
                value={custom}
                onChange={(e) => setCustom(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder={rules.min ? String(rules.min) : '50'}
              />
            </span>
            <span className="vayd-store__muted">
              {money(rules.min ?? 1)}
              {rules.max != null ? ` – ${money(rules.max)}` : ' or more'}
            </span>
          </label>
        ) : null}
        {showErrors && amountError ? <p className="vayd-store__err">{amountError}</p> : null}

        <p className="vayd-store__question">Who is it for?</p>
        <div className="vayd-store__choices">
          <label className={`vayd-store__choice${!forSelf ? ' is-on' : ''}`}>
            <input type="radio" checked={!forSelf} onChange={() => setForSelf(false)} />
            <span>Send it to someone</span>
          </label>
          <label className={`vayd-store__choice${forSelf ? ' is-on' : ''}`}>
            <input type="radio" checked={forSelf} onChange={() => setForSelf(true)} />
            <span>It’s for me — email it to me</span>
          </label>
        </div>

        {!forSelf ? (
          <div className="vayd-store__cart-fields">
            <label>
              Recipient name
              <input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
            </label>
            <label>
              Recipient email
              <input
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
              />
            </label>
            <label>
              From
              <input
                value={fromName}
                maxLength={FROM_MAX}
                onChange={(e) => setFromName(e.target.value)}
                placeholder="Your name"
              />
            </label>
            <label className="vayd-store__cart-wide">
              Message (optional)
              <textarea
                rows={3}
                maxLength={MESSAGE_MAX}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Happy birthday to you and Biscuit!"
              />
            </label>
            <div className="vayd-store__cart-wide">
              <p className="vayd-store__question">When should we send it?</p>
              <div className="vayd-store__chips">
                <button
                  type="button"
                  className={`vayd-store__chip${!schedule ? ' is-on' : ''}`}
                  onClick={() => setSchedule(false)}
                >
                  Right away
                </button>
                <button
                  type="button"
                  className={`vayd-store__chip${schedule ? ' is-on' : ''}`}
                  onClick={() => setSchedule(true)}
                >
                  On a date
                </button>
              </div>
              {schedule ? (
                <label>
                  Delivery date
                  <input
                    type="date"
                    min={tomorrow}
                    max={lastDay}
                    value={deliverAt}
                    onChange={(e) => setDeliverAt(e.target.value)}
                  />
                  <span className="vayd-store__muted">
                    We email it that morning. You get a receipt and printable copy today.
                  </span>
                </label>
              ) : null}
            </div>
          </div>
        ) : null}
        {showErrors && (recipientError || scheduleError) ? (
          <p className="vayd-store__err">{recipientError || scheduleError}</p>
        ) : null}

        <div className="vayd-store__gift-actions">
          <button type="button" className="primary" onClick={add}>
            {price != null ? `Add ${money(amount)} gift card — ${money(price)}` : 'Add to cart'}
          </button>
          {added ? (
            <p className="vayd-store__gift-added">
              Added to your cart. <Link to="/store/cart">Check out</Link> or add another.
            </p>
          ) : null}
        </div>
        <p className="vayd-store__muted">
          {loggedIn
            ? 'Gift cards don’t need a pet on file and can be used by anyone.'
            : 'No account needed — anyone can buy or use a gift card.'}{' '}
          <Link to="/store/gift-cards/balance">Check a gift card balance</Link>
        </p>
        {rules.displayTerms || rules.terms ? (
          <details className="vayd-store__gift-terms">
            <summary>Gift card terms</summary>
            <p>{rules.displayTerms || rules.terms}</p>
          </details>
        ) : null}
      </div>
    </div>
  );
}
