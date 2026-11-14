import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  fetchHouseholdCardOffer,
  moveHouseholdCards,
  type HouseholdCardAudience,
  type HouseholdCardMoveResult,
  type HouseholdCardOffer,
  type HouseholdCardTarget,
} from '../../api/householdCards';
import { apiErrorMessage } from '../../api/http';
import './HouseholdCardOfferDialog.css';

function cardName(card: { brand: string; last4: string } | null | undefined): string {
  if (!card) return 'no card';
  const brand = (card.brand || 'Card').replace(/^./, (c) => c.toUpperCase());
  return card.last4 ? `${brand} •${card.last4}` : brand;
}

const key = (t: { kind: string; id: number | null }) => `${t.kind}:${t.id ?? ''}`;

type Props = {
  audience: HouseholdCardAudience;
  /** Staff: the client whose card was saved. Clients: ignored (their own household). */
  clientId: number | null;
  /** The card just saved; default the visit card on file. */
  paymentMethodId?: string | null;
  /** Wait before asking (a card saved by a reader payment reaches the card on file a moment later). */
  delayMs?: number;
  onClose: () => void;
};

/**
 * One card, everywhere (owner, Nov 13, 2026). After a card is saved in one place (a visit bill,
 * the online store, a membership), offers to bill the household's other places that charge a
 * different card: the visit card on file, each membership, each auto-ship. Nothing is ticked:
 * staff ask the owner first; a client chooses. Shows nothing when everything is already on it.
 */
export default function HouseholdCardOfferDialog({ audience, clientId, paymentMethodId, delayMs = 0, onClose }: Props) {
  const [offer, setOffer] = useState<HouseholdCardOffer | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<HouseholdCardMoveResult[] | null>(null);

  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      fetchHouseholdCardOffer(audience, clientId, paymentMethodId)
        .then((next) => {
          if (!live) return;
          if (!next || next.targets.length === 0) onClose();
          else setOffer(next);
        })
        .catch(() => live && onClose());
    }, delayMs);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience, clientId, paymentMethodId, delayMs]);

  if (!offer) return null;
  const staff = audience === 'staff';
  const newCard = cardName(offer.card);

  const toggle = (t: HouseholdCardTarget) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key(t))) next.delete(key(t));
      else next.add(key(t));
      return next;
    });

  async function update() {
    if (!offer) return;
    setBusy(true);
    setError(null);
    try {
      const picks = offer.targets.filter((t) => picked.has(key(t))).map((t) => ({ kind: t.kind, id: t.id }));
      setResults(await moveHouseholdCards(audience, clientId, offer.card.paymentMethodId, picks));
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="app-dialog-backdrop" role="presentation">
      <div
        className="app-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="household-card-offer-title"
        data-testid="household-card-offer"
      >
        <h2 id="household-card-offer-title" className="app-dialog__title">
          Use {newCard} for these too?
        </h2>
        {results ? (
          <ul className="household-card-offer__results" data-testid="household-card-offer-results">
            {results.map((r) => (
              <li key={key(r)} className={r.ok ? 'household-card-offer__ok' : 'household-card-offer__err'}>
                {r.ok ? `${r.label}: now on ${newCard}.` : `${r.label}: not changed. ${r.error ?? ''}`}
              </li>
            ))}
          </ul>
        ) : (
          <>
            <p className="app-dialog__body">
              {staff
                ? `These are billed on a different card. Ask the owner first, then tick the ones to move to ${newCard}.`
                : `These are billed on a different card. Tick any you'd like to move to ${newCard}.`}
            </p>
            <div className="household-card-offer__list">
              {offer.targets.map((t) => (
                <label key={key(t)} className="household-card-offer__row">
                  <input
                    type="checkbox"
                    checked={picked.has(key(t))}
                    disabled={busy}
                    onChange={() => toggle(t)}
                  />
                  <span>
                    {t.kind === 'card_on_file' && !staff ? 'Card on file for visits and refills at Vet At Your Door' : t.label}
                    <span className="household-card-offer__now">
                      {t.current ? `Now: ${cardName(t.current)}` : 'No card yet'}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {error ? (
              <p className="app-dialog__hint" role="alert">
                {error}
              </p>
            ) : null}
          </>
        )}
        <div className="app-dialog__actions">
          {results ? (
            <button type="button" className="app-dialog__btn app-dialog__btn--primary" onClick={onClose}>
              Done
            </button>
          ) : (
            <>
              <button type="button" className="app-dialog__btn" disabled={busy} onClick={onClose}>
                Not now
              </button>
              <button
                type="button"
                className="app-dialog__btn app-dialog__btn--primary"
                disabled={busy || picked.size === 0}
                onClick={() => void update()}
              >
                {busy ? 'Updating…' : 'Update'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
