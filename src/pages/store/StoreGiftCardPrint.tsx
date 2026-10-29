import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { getGiftCardPrintView, type GiftCardPrintView } from '../../api/giftCards';
import './Store.css';

/** Printable card from the link in the gift card email. Holds the full code. */
export default function StoreGiftCardPrint() {
  const { token = '' } = useParams();
  const [card, setCard] = useState<GiftCardPrintView | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getGiftCardPrintView(token)
      .then((row) => !cancelled && setCard(row))
      .catch((e) => !cancelled && setErr(e instanceof Error ? e.message : 'Gift card not found'));
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (err) return <p className="vayd-gift-print__msg">{err}</p>;
  if (!card) return <p className="vayd-gift-print__msg">Loading…</p>;

  const storeUrl = `${window.location.origin}/store`;
  return (
    <div className="vayd-gift-print">
      <div className="vayd-gift-print__actions">
        <button type="button" className="primary" onClick={() => window.print()}>
          Print
        </button>
      </div>
      <div className="vayd-gift-print__card">
        <div className="vayd-gift-print__top">
          <img src="/final_thick_lines_cropped.jpeg" alt={card.brand} />
          <span>Gift card</span>
        </div>
        <div className="vayd-gift-print__amount">${card.faceValue.toFixed(2)}</div>
        {card.recipientName ? (
          <div className="vayd-gift-print__to">For {card.recipientName}</div>
        ) : null}
        {card.fromName ? <div className="vayd-gift-print__from">From {card.fromName}</div> : null}
        {card.message ? <p className="vayd-gift-print__message">{card.message}</p> : null}
        <div className="vayd-gift-print__code-label">Gift card code</div>
        <div className="vayd-gift-print__code">{card.code}</div>
      </div>
      {card.status === 'void' ? (
        <p className="vayd-gift-print__warn">This gift card is no longer valid.</p>
      ) : card.balance < card.faceValue ? (
        <p className="vayd-gift-print__note">Balance remaining: ${card.balance.toFixed(2)}</p>
      ) : null}
      <div className="vayd-gift-print__how">
        <h2>How to use it</h2>
        <ul>
          <li>At your visit: give the code to your doctor or our team at checkout.</li>
          <li>Online: enter the code at checkout in our store, {storeUrl}.</li>
          <li>Paying a bill: enter the code when paying in the client portal.</li>
        </ul>
        {card.terms ? <p className="vayd-gift-print__terms">{card.terms}</p> : null}
      </div>
    </div>
  );
}
