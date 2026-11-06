// src/pages/roomLoader/OutdoorAccessQuestion.tsx
// The configured lifestyle question (an outdoor cat, in most practices) and whatever the
// practice pitches off a yes.
import { AlertTriangle } from 'lucide-react';
import type { RoomLoaderOutdoorConfig } from '../../utils/roomLoaderConfigTypes';
import { fillPetName, type ResolvedOffer } from '../../utils/roomLoaderOfferEngine';
import RoomLoaderHtml from './RoomLoaderHtml';
import type { RoomLoaderPriceFor } from './RoomLoaderPrice';
import { outdoorAccessKey, outdoorPitchKey } from './roomLoaderFormKeys';
import './RoomLoaderSections.css';

type Props = {
  petKey: string;
  petName: string;
  config: RoomLoaderOutdoorConfig;
  pitch: ResolvedOffer | null;
  formData: Record<string, any>;
  onChange: (key: string, value: string) => void;
  priceFor: RoomLoaderPriceFor;
  disabled?: boolean;
};

export default function OutdoorAccessQuestion({
  petKey,
  petName,
  config,
  pitch,
  formData,
  onChange,
  priceFor,
  disabled = false,
}: Props) {
  const key = outdoorAccessKey(petKey);
  const answer = String(formData[key] ?? '');
  const pitchKeyName = outdoorPitchKey(petKey);
  const pitchAnswer = String(formData[pitchKeyName] ?? '');
  const price = pitch ? priceFor(pitch.item) : null;

  return (
    <section className="rl-outdoor">
      <h3 className="rl-outdoor__title">
        {fillPetName(config.questionText, petName)}
        {config.required ? <span className="rl-required"> *</span> : null}
      </h3>
      <div className="rl-yesno" role="radiogroup" aria-label={fillPetName(config.questionText, petName)}>
        <label className={answer === 'yes' ? 'is-selected' : undefined}>
          <input
            type="radio"
            name={key}
            value="yes"
            checked={answer === 'yes'}
            disabled={disabled}
            onChange={() => onChange(key, 'yes')}
          />
          <span>Yes</span>
        </label>
        <label className={answer === 'no' ? 'is-selected' : undefined}>
          <input
            type="radio"
            name={key}
            value="no"
            checked={answer === 'no'}
            disabled={disabled}
            onChange={() => onChange(key, 'no')}
          />
          <span>No</span>
        </label>
      </div>

      {answer === 'yes' && pitch ? (
        <div className="rl-outdoor__pitch">
          <RoomLoaderHtml html={fillPetName(pitch.descriptionHtml, petName)} />
          <label className="rl-offer__check">
            <input
              type="checkbox"
              checked={pitchAnswer === 'yes'}
              disabled={disabled}
              onChange={(e) => onChange(pitchKeyName, e.target.checked ? 'yes' : 'no')}
            />
            <span className="rl-offer__name">{pitch.displayName}</span>
            {price ? <span className="rl-offer__price">{price}</span> : null}
          </label>
          {pitchAnswer === 'no' && pitch.cautionHtml ? (
            <div className="rl-caution">
              <AlertTriangle size={15} aria-hidden className="rl-caution__icon" />
              <div>
                <strong className="rl-caution__title">Before you skip this</strong>
                <RoomLoaderHtml html={fillPetName(pitch.cautionHtml, petName)} />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
