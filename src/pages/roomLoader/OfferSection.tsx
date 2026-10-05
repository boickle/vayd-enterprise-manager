// src/pages/roomLoader/OfferSection.tsx
// The configured add-ons for one pet: the items a practice offers everyone, plus the
// species/age/history gated ones.
//
// Declining an offer deliberately shows nothing extra. Each card already carries the
// practice's reason for recommending it directly above the checkbox, so the caution copy
// only restated it a second time. That copy still runs on the care plan summary page,
// where the line is crossed out with no description beside it.
import { fillPetName, type ResolvedOffer } from '../../utils/roomLoaderOfferEngine';
import RoomLoaderHtml from './RoomLoaderHtml';
import type { RoomLoaderPriceFor } from './RoomLoaderPrice';
import { offerKey } from './roomLoaderFormKeys';
import './RoomLoaderSections.css';

type Props = {
  petKey: string;
  title: string;
  /** Fills `{petName}` in the configured description and caution copy. */
  petName?: string;
  lead?: string;
  offers: ResolvedOffer[];
  formData: Record<string, any>;
  onChange: (key: string, value: string) => void;
  priceFor: RoomLoaderPriceFor;
  disabled?: boolean;
};

export default function OfferSection({
  petKey,
  title,
  petName = '',
  lead,
  offers,
  formData,
  onChange,
  priceFor,
  disabled = false,
}: Props) {
  if (offers.length === 0) return null;

  return (
    <section className="rl-offers">
      <h3 className="rl-offers__title">{title}</h3>
      {lead ? <p className="rl-offers__lead">{lead}</p> : null}
      <ul className="rl-offers__list">
        {offers.map((offer) => {
          const key = offerKey(petKey, offer.id);
          const answer = String(formData[key] ?? '');
          const price = priceFor(offer.item);
          return (
            <li key={offer.id} className="rl-offer">
              <label className="rl-offer__check">
                <input
                  type="checkbox"
                  checked={answer === 'yes'}
                  disabled={disabled}
                  onChange={(e) => onChange(key, e.target.checked ? 'yes' : 'no')}
                />
                <span className="rl-offer__name">{offer.displayName}</span>
                {price ? <span className="rl-offer__price">{price}</span> : null}
              </label>
              <RoomLoaderHtml
                html={fillPetName(offer.descriptionHtml, petName)}
                className="rl-offer__desc"
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
