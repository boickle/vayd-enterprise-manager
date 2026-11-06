import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { formatMailPickupLocation } from '../../utils/mailShippingTypes';
import {
  publicStoreFulfillment,
  type StoreCheckoutResult,
  type StoreFulfillmentOption,
} from '../../api/onlineStore';
import './Store.css';
import { useStorePracticeId } from './useStorePracticeId';

function sendLabel(deliverAt: string | null) {
  if (!deliverAt) return 'on its way now';
  const when = new Date(deliverAt);
  if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) return 'on its way now';
  return `scheduled for ${when.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`;
}

export default function StoreThanks() {
  const { practiceId } = useStorePracticeId();
  const { id } = useParams();
  const location = useLocation();
  const order = (location.state as { order?: StoreCheckoutResult } | null)?.order;
  const giftCards = order?.giftCards ?? [];
  const giftOnly = id === 'gift-cards' || order?.kind === 'gift_cards';
  const pickup = order?.origin === 'office_pickup';
  const [instructions, setInstructions] = useState<string | null>(null);
  const pickupLines = formatMailPickupLocation(
    pickup
      ? {
          name: order?.shipName || 'Office pick-up',
          line1: order?.shipLine1,
          line2: order?.shipLine2,
          city: order?.shipCity,
          state: order?.shipState,
          postal: order?.shipPostal,
        }
      : null
  );

  useEffect(() => {
    if (giftOnly) return;
    let cancelled = false;
    void publicStoreFulfillment(practiceId).then((rows) => {
      if (cancelled) return;
      const label = (order?.shippingChargeName || '').trim().toLowerCase();
      const match =
        rows.find((row: StoreFulfillmentOption) => row.label.trim().toLowerCase() === label) ||
        rows.find((row) => (row.kind === 'pickup') === pickup) ||
        null;
      setInstructions(match?.clientInstructions?.trim() || null);
    });
    return () => {
      cancelled = true;
    };
  }, [giftOnly, order?.shippingChargeName, pickup, practiceId]);

  const giftSection = giftCards.length ? (
    <div className="vayd-store__gift-thanks">
      <h2>{giftCards.length === 1 ? 'Your gift card' : 'Your gift cards'}</h2>
      <ul>
        {giftCards.map((card) => (
          <li key={card.id}>
            <div>
              <strong>${card.faceValue.toFixed(2)} gift card</strong> ••••{card.last4}
              <div className="vayd-store__muted" style={{ margin: '2px 0 0' }}>
                {card.recipientEmail
                  ? `Email to ${card.recipientName || card.recipientEmail} is ${sendLabel(card.deliverAt)}.`
                  : 'Ready to use.'}
              </div>
            </div>
            {card.printUrl ? (
              <a className="ghost" href={card.printUrl} target="_blank" rel="noreferrer">
                Print
              </a>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="vayd-store__muted">
        Gift cards can be used at a visit, in this store, or toward a bill in the client portal.
      </p>
    </div>
  ) : null;

  if (giftOnly) {
    return (
      <>
        <h1>Thank you</h1>
        <p>
          Your payment went through. You’ll get a receipt at {order?.customerEmail || 'your email'}.
        </p>
        {giftSection ?? (
          <p className="vayd-store__muted">Your gift cards are on their way by email.</p>
        )}
        <Link to="/store">Back to the store</Link>
      </>
    );
  }

  return (
    <>
      <h1>Thank you</h1>
      <p>
        {pickup ? `Order #${id} is confirmed.` : `Order #${id} is in our mail queue.`} You’ll
        get a receipt in your email.
      </p>
      {pickup ? (
        <div className="vayd-store__note">
          {pickupLines.length ? (
            <p style={{ margin: '0 0 8px' }}>
              Pick up at {pickupLines.join(', ')}.
            </p>
          ) : (
            <p style={{ margin: '0 0 8px' }}>This order is for office pick-up.</p>
          )}
          <p style={{ margin: 0 }}>
            {instructions || 'You’ll get a notification when your pick-up is ready.'}
          </p>
        </div>
      ) : (
        <p>Prescription items are reviewed before we pack. Autoship renewal dates are on the order.</p>
      )}
      {giftSection}
      <Link to="/store">Back to the store</Link>
    </>
  );
}
