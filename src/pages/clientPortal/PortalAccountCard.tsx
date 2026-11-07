import { useEffect, useRef, useState } from 'react';
import {
  myStoreAccount,
  myStoreCards,
  payMyStoreBalance,
  newStoreAttemptKey,
  storeApiError,
  storeAttemptMayRetry,
  type StoreOpenInvoice,
  type StoreSavedCard,
} from '../../api/onlineStore';
import { fetchClientInfo } from '../../api/clientPortal';
import { currentPracticeId } from '../../utils/practiceIdFromToken';
import StoreCartCardEntry, { type StoreCartCardEntryHandle } from '../store/StoreCartCardEntry';
import StoreOpenInvoicesPanel from '../store/StoreOpenInvoicesPanel';
import { StoreGiftCardCodeEntry, type AppliedGiftCard } from '../store/StoreGiftCardCart';
import { PortalModal } from './PortalPrimitives';
import '../store/Store.css';

type Props = {
  clientId: number;
  /** Email on the client record; prefills the new-card billing form. */
  email: string;
  /** Not used for lookups any more (OS-01): cards and bills come from the login. */
  cardEmail?: string | null;
  customerName?: string | null;
  onShop: () => void;
};

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function cardLabel(card: StoreSavedCard): string {
  const brand = (card.brand || 'Card').replace(/^./, (c) => c.toUpperCase());
  return card.last4 ? `${brand} •••• ${card.last4}` : brand;
}

export default function PortalAccountCard({ clientId, email, customerName, onShop }: Props) {
  const practiceId = currentPracticeId();
  const [credit, setCredit] = useState(0);
  // OS-06: `owed` is only what can be paid online; `held` is old eVet bills that wait for eVet sync to end.
  const [owed, setOwed] = useState(0);
  const [held, setHeld] = useState(0);
  const [invoices, setInvoices] = useState<StoreOpenInvoice[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [invoicesOpen, setInvoicesOpen] = useState(false);
  const [enterNewCard, setEnterNewCard] = useState(false);
  const [cards, setCards] = useState<StoreSavedCard[]>([]);
  const [cardId, setCardId] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [giftCodes, setGiftCodes] = useState<AppliedGiftCard[]>([]);
  const [billingPrefill, setBillingPrefill] = useState({
    name: customerName?.trim() || '',
    email: email.trim(),
    line1: '',
    line2: '',
    city: '',
    state: '',
    postal: '',
  });
  const newCardRef = useRef<StoreCartCardEntryHandle>(null);
  // OS-03: one key per payment attempt, kept after no answer or a 5xx, new after a 4xx or any change.
  const attemptRef = useRef<{
    key: string;
    signature: string;
    paymentMethodId: string | null;
  } | null>(null);
  const payingRef = useRef(false);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    void (async () => {
      let lookup = email.trim();
      const info = await fetchClientInfo(clientId);
      const onFile = String(info?.email || info?.primaryEmail || '').trim();
      if (onFile) lookup = onFile;
      if (cancelled) return;
      const displayName =
        customerName?.trim() ||
        [info?.firstName, info?.lastName].filter(Boolean).join(' ').trim() ||
        '';
      setBillingPrefill({
        name: displayName,
        email: lookup || email.trim(),
        line1: String(info?.address1 || '').trim(),
        line2: String(info?.address2 || '').trim(),
        city: String(info?.city || '').trim(),
        state: String(info?.state || info?.stateProvince || '').trim(),
        postal: String(info?.zipcode || info?.zip || '').trim(),
      });
      // OS-01: the API takes the household from the portal login, never from an id or email we send.
      try {
        const row = await myStoreAccount();
        if (cancelled) return;
        setCredit(Number(row.available) || 0);
        setOwed(Number(row.payableOwed) || 0);
        setHeld(Number(row.evetNotPayable) || 0);
        setInvoices(row.invoices || []);
      } catch {
        if (!cancelled) {
          setCredit(0);
          setOwed(0);
          setHeld(0);
        }
      }
      const row = await myStoreCards().catch(() => ({ hasCard: false, cards: [] as StoreSavedCard[] }));
      if (cancelled) return;
      const mine = (row.cards || []).filter((card) => Boolean(card.paymentMethodId));
      setCards(mine);
      setCardId(mine[0]?.paymentMethodId || '');
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, email, customerName]);

  if (credit < 0.01 && owed < 0.01 && held < 0.01 && !note) return null;

  const giftCardBalance = giftCodes.reduce((sum, row) => sum + row.balance, 0);
  // The server only applies gift cards to Scout invoices, never to eVet ones.
  const giftCardEligible = invoices
    .filter((inv) => inv.source === 'scout')
    .reduce((sum, inv) => sum + (Number(inv.due) || 0), 0);
  const giftCardApplied =
    Math.round(Math.min(owed, giftCardEligible, giftCardBalance) * 100) / 100;
  const giftCardLimited = giftCodes.length > 0 && giftCardApplied < giftCardBalance - 0.009;
  const cardDue = Math.max(0, Math.round((owed - giftCardApplied) * 100) / 100);
  const needsCard = cardDue > 0.009;

  async function payNow() {
    // OS-03: a second click while the first is still paying does nothing.
    if (payingRef.current) return;
    payingRef.current = true;
    setBusy(true);
    setError(null);
    setNote(null);
    let attempt: NonNullable<typeof attemptRef.current> | null = null;
    try {
      const usingNewCard = needsCard && (enterNewCard || !cards.length);
      const codes = giftCodes.map((row) => row.code);
      const signature = JSON.stringify([owed, usingNewCard ? 'new' : needsCard ? cardId : 'none', codes]);
      attempt = attemptRef.current;
      if (!attempt || attempt.signature !== signature) {
        attempt = { key: newStoreAttemptKey(), signature, paymentMethodId: null };
      }
      attemptRef.current = attempt;
      let paymentMethodId = '';
      if (needsCard) {
        paymentMethodId = cardId;
        if (usingNewCard) {
          // Retrying the same attempt reuses the card made for it, so Stripe sees the same request.
          if (!attempt.paymentMethodId) {
            const created = await newCardRef.current?.createPaymentMethod();
            attempt.paymentMethodId = created?.paymentMethodId ?? null;
          }
          paymentMethodId = attempt.paymentMethodId ?? '';
        }
        if (!paymentMethodId) {
          setError('Choose or enter a card to pay.');
          return;
        }
      }
      const result = await payMyStoreBalance({
        paymentMethodId,
        customerName,
        giftCardCodes: codes,
        attemptKey: attempt.key,
      });
      attemptRef.current = null;
      setOwed(0);
      setInvoices([]);
      setPayOpen(false);
      setEnterNewCard(false);
      setGiftCodes([]);
      setNote(
        result.giftCardApplied > 0.009
          ? `Paid ${money(result.paid)} (${money(result.giftCardApplied)} from gift card${
              result.cardCharged > 0.009 ? `, ${money(result.cardCharged)} on your card` : ''
            }). Thank you.`
          : `Paid ${money(result.paid)}. Thank you.`,
      );
    } catch (e: unknown) {
      // A definite answer (declined, refused) ends the attempt; no answer keeps it for a safe retry.
      if (!storeAttemptMayRetry(e) && attemptRef.current === attempt) attemptRef.current = null;
      setError(storeApiError(e));
    } finally {
      payingRef.current = false;
      setBusy(false);
    }
  }

  if (note && credit < 0.01 && owed < 0.01 && held < 0.01) {
    return (
      <section className="pp-account" aria-label="Account balance">
        <p className="pp-account__note">{note}</p>
      </section>
    );
  }

  const invoiceButtonLabel =
    invoices.length === 1 ? 'View open invoice' : `View open invoices (${invoices.length})`;

  return (
    <>
      <section className="pp-account" aria-label="Account balance">
        <div className="pp-account__row">
          <span className="pp-stat-icon" aria-hidden>
            {credit > 0.009 ? '💚' : '💳'}
          </span>
          <span className="pp-account__copy">
            <span className="pp-stat-k">{credit > 0.009 ? 'You have a credit' : `Your balance: ${money(owed + held)}`}</span>
            <span className="pp-stat-l">{credit > 0.009 ? money(credit) : 'We appreciate your prompt payment!'}</span>
          </span>
          {credit > 0.009 ? (
            <button type="button" className="pp-btn pp-btn--primary pp-btn--sm" onClick={onShop}>
              Explore using it on the store
            </button>
          ) : owed < 0.01 ? null : (
            <button
              type="button"
              className="pp-btn pp-btn--primary pp-btn--sm"
              onClick={() => {
                setPayOpen((current) => !current);
                setError(null);
              }}
            >
              {payOpen ? 'Close' : 'Pay now'}
            </button>
          )}
        </div>

        {held > 0.009 ? (
          <p className="pp-account__note vayd-store__evet-held">
            {money(held)} is on older bills from our previous system, which can’t be paid online yet. Please
            call us to pay them.
          </p>
        ) : null}

        {credit <= 0.009 && owed >= 0.01 && payOpen ? (
          <div className="pp-account__pay">
            {invoices.length > 0 ? (
              <button type="button" className="pp-btn pp-btn--ghost pp-btn--sm pp-account__invoices-btn" onClick={() => setInvoicesOpen(true)}>
                {invoiceButtonLabel}
              </button>
            ) : null}

            <div className="vayd-store">
              <StoreGiftCardCodeEntry
                practiceId={practiceId}
                applied={giftCodes}
                onChange={setGiftCodes}
                note="Gift cards pay invoices from your visits with us."
              />
              {giftCardLimited ? (
                <p className="vayd-store__muted">
                  {giftCardApplied > 0.009
                    ? `${money(giftCardApplied)} of your gift card balance can go toward this payment. The rest stays on the card.`
                    : 'Your gift card can’t be used for this balance. It stays on the card for a future visit.'}
                </p>
              ) : null}
            </div>

            {!needsCard ? null : enterNewCard || !cards.length ? (
              <div className="vayd-store">
                <StoreCartCardEntry
                  ref={newCardRef}
                  billingPrefill={billingPrefill}
                  onClose={cards.length ? () => setEnterNewCard(false) : undefined}
                />
              </div>
            ) : (
              <div className="pp-account__card-on-file">
                <label>
                  Card on file
                  <select value={cardId} onChange={(e) => setCardId(e.target.value)}>
                    {cards.map((card) => (
                      <option key={card.paymentMethodId} value={card.paymentMethodId}>
                        {cardLabel(card)}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="pp-account__card-link" onClick={() => setEnterNewCard(true)}>
                  Use a different card
                </button>
              </div>
            )}

            <button type="button" className="pp-btn pp-btn--primary pp-btn--sm" disabled={busy} onClick={() => void payNow()}>
              {busy
                ? 'Paying…'
                : giftCardApplied > 0.009
                  ? needsCard
                    ? `Pay ${money(owed)} (${money(cardDue)} on card)`
                    : `Pay ${money(owed)} with gift card`
                  : `Pay ${money(owed)}`}
            </button>
          </div>
        ) : null}

        {note ? <p className="pp-account__note">{note}</p> : null}
        {error ? <p className="pp-account__error">{error}</p> : null}
      </section>

      {invoicesOpen ? (
        <PortalModal
          title="Open invoices"
          wide
          onClose={() => setInvoicesOpen(false)}
          labelledBy="pp-account-invoices-title"
        >
          <div className="vayd-store">
            <StoreOpenInvoicesPanel invoices={invoices} />
          </div>
          <div className="pp-modal-foot">
            <button type="button" className="pp-btn pp-btn--primary" onClick={() => setInvoicesOpen(false)}>
              Done
            </button>
          </div>
        </PortalModal>
      ) : null}
    </>
  );
}
