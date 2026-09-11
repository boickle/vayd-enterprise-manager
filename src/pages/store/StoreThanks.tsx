import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { formatMailPickupLocation } from '../../utils/mailShippingTypes';
import {
  publicStoreFulfillment,
  type MailOrder,
  type StoreFulfillmentOption,
} from '../../api/onlineStore';
import './Store.css';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

export default function StoreThanks() {
  const { id } = useParams();
  const location = useLocation();
  const order = (location.state as { order?: MailOrder } | null)?.order;
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
    let cancelled = false;
    void publicStoreFulfillment(PRACTICE_ID).then((rows) => {
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
  }, [order?.shippingChargeName, pickup]);

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
      <Link to="/store">Back to the store</Link>
    </>
  );
}
