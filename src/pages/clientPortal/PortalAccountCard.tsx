import { useEffect, useRef, useState } from 'react';
import {
  publicAccountCredit,
  publicPayAccountBalance,
  publicStoreCardOnFile,
  storeApiError,
  type StoreOpenInvoice,
  type StoreSavedCard,
} from '../../api/onlineStore';
import { fetchClientInfo } from '../../api/clientPortal';
import { currentPracticeId } from '../../utils/practiceIdFromToken';
import StoreCartCardEntry, { type StoreCartCardEntryHandle } from '../store/StoreCartCardEntry';
import StoreOpenInvoicesPanel from '../store/StoreOpenInvoicesPanel';
import { PortalModal } from './PortalPrimitives';
import '../store/Store.css';

type Props = {
  clientId: number;
  /** Email on the client record. The balance lookup only matches this. */
  email: string;
  /** Sign-in email, used as a second place to find a saved card. */
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

export default function PortalAccountCard({ clientId, email, cardEmail, customerName, onShop }: Props) {
  const practiceId = currentPracticeId();
  const [credit, setCredit] = useState(0);
  const [owed, setOwed] = useState(0);
  const [invoices, setInvoices] = useState<StoreOpenInvoice[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [invoicesOpen, setInvoicesOpen] = useState(false);
  const [enterNewCard, setEnterNewCard] = useState(false);
  const [cards, setCards] = useState<StoreSavedCard[]>([]);
  const [cardId, setCardId] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [billingEmail, setBillingEmail] = useState(email.trim());
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

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    void (async () => {
      let lookup = email.trim();
      const info = await fetchClientInfo(clientId);
      const onFile = String(info?.email || info?.primaryEmail || '').trim();
      if (onFile) lookup = onFile;
      if (cancelled) return;
      if (lookup) setBillingEmail(lookup);
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
      if (!lookup) return;
      try {
        const row = await publicAccountCredit(practiceId, clientId, lookup);
        if (cancelled) return;
        setCredit(Number(row.available) || 0);
        setOwed(Number(row.owed) || 0);
        setInvoices(row.invoices || []);
      } catch {
        if (!cancelled) {
          setCredit(0);
          setOwed(0);
        }
      }
      const cardEmails = Array.from(
        new Set([lookup, (cardEmail || '').trim(), email.trim()].filter(Boolean).map((value) => value.toLowerCase())),
      );
      const rows = await Promise.all(
        cardEmails.map((value) =>
          publicStoreCardOnFile(practiceId, value).catch(() => ({ hasCard: false, cards: [] as StoreSavedCard[] })),
        ),
      );
      if (cancelled) return;
      const seen = new Set<string>();
      const unique = rows.flatMap((row) => row.cards || []).filter((card) => {
        if (!card.paymentMethodId || seen.has(card.paymentMethodId)) return false;
        seen.add(card.paymentMethodId);
        return true;
      });
      setCards(unique);
      setCardId(unique[0]?.paymentMethodId || '');
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, email, cardEmail, customerName, practiceId]);

  if (credit < 0.01 && owed < 0.01 && !note) return null;

  async function payNow() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      let paymentMethodId = cardId;
      if (enterNewCard || !cards.length) {
        const created = await newCardRef.current?.createPaymentMethod();
        paymentMethodId = created?.paymentMethodId ?? '';
      }
      if (!paymentMethodId) {
        setError('Choose or enter a card to pay.');
        return;
      }
      const result = await publicPayAccountBalance(practiceId, {
        clientId,
        email: billingEmail.trim(),
        paymentMethodId,
        customerName,
      });
      setOwed(0);
      setInvoices([]);
      setPayOpen(false);
      setEnterNewCard(false);
      setNote(`Paid ${money(result.paid)}. Thank you.`);
    } catch (e: unknown) {
      setError(storeApiError(e));
    } finally {
      setBusy(false);
    }
  }

  if (note && credit < 0.01 && owed < 0.01) {
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
            <span className="pp-stat-k">{credit > 0.009 ? 'You have a credit' : `Your balance: ${money(owed)}`}</span>
            <span className="pp-stat-l">{credit > 0.009 ? money(credit) : 'We appreciate your prompt payment!'}</span>
          </span>
          {credit > 0.009 ? (
            <button type="button" className="pp-btn pp-btn--primary pp-btn--sm" onClick={onShop}>
              Explore using it on the store
            </button>
          ) : (
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

        {credit <= 0.009 && payOpen ? (
          <div className="pp-account__pay">
            {invoices.length > 0 ? (
              <button type="button" className="pp-btn pp-btn--ghost pp-btn--sm pp-account__invoices-btn" onClick={() => setInvoicesOpen(true)}>
                {invoiceButtonLabel}
              </button>
            ) : null}

            {enterNewCard || !cards.length ? (
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
              {busy ? 'Paying…' : `Pay ${money(owed)}`}
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
