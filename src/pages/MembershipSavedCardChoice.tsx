import type { StoreSavedCard } from '../api/onlineStore';

/** "Visa" from "visa"; "Card" when Stripe gave no brand. */
function brandName(brand?: string | null): string {
  const value = (brand || '').trim();
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Card';
}

/** The card on file: the first saved card the API marks `recommended` (it lists the card on file first). */
export function cardOnFileFrom(cards: StoreSavedCard[] | undefined | null): StoreSavedCard | null {
  return (cards ?? []).find((card) => card.recommended && card.paymentMethodId) ?? null;
}

export function savedCardLabel(card: StoreSavedCard): string {
  return `Use ${brandName(card.brand)} ending ${card.last4 || '••••'}`;
}

/**
 * PAY-C7: the choice the store gives at checkout, for a portal membership signup: pay with the card
 * already on file (chosen by default) or enter a new one.
 */
export default function MembershipSavedCardChoice({
  card,
  useSaved,
  onChange,
  disabled,
}: {
  card: StoreSavedCard;
  useSaved: boolean;
  onChange: (useSaved: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset
      disabled={disabled}
      style={{ border: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}
    >
      <legend style={{ fontWeight: 600, fontSize: 14, padding: 0, marginBottom: 6 }}>Payment card</legend>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="radio"
          name="membership-card-choice"
          checked={useSaved}
          onChange={() => onChange(true)}
        />
        {savedCardLabel(card)}
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="radio"
          name="membership-card-choice"
          checked={!useSaved}
          onChange={() => onChange(false)}
        />
        Enter a new card
      </label>
    </fieldset>
  );
}
