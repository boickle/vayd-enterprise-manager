// src/pages/roomLoader/ChronicMedsSection.tsx
// Asks whether the owner needs a refill of anything their pet is already on. This
// replaced the free-text pre-exam medication question: the chronic prescriptions come
// from the chart, so the owner picks from their own list instead of typing drug names.
import type { RoomLoaderChronicMedsConfig } from '../../utils/roomLoaderConfigTypes';
import { fillPetName } from '../../utils/roomLoaderOfferEngine';
import RoomLoaderHtml from './RoomLoaderHtml';
import { chronicMedKey, chronicMedsOtherKey } from './roomLoaderFormKeys';
import './RoomLoaderSections.css';

export type ChronicMed = {
  prescriptionId: number;
  name: string;
  strength: string | null;
  instructions: string | null;
  inventoryItemId: number | null;
  refillsRemaining: number | null;
  autoshipActive: boolean;
};

type Props = {
  petKey: string;
  petName: string;
  config: RoomLoaderChronicMedsConfig;
  meds: ChronicMed[];
  formData: Record<string, any>;
  onChange: (key: string, value: string) => void;
  disabled?: boolean;
};

export default function ChronicMedsSection({
  petKey,
  petName,
  config,
  meds,
  formData,
  onChange,
  disabled = false,
}: Props) {
  if (!config.enabled) return null;
  if (meds.length === 0) return null;

  const choices: Array<{ value: string; label: string }> = [];
  if (config.allowBring) choices.push({ value: 'bring', label: config.bringLabel });
  if (config.allowShip) choices.push({ value: 'ship', label: config.shipLabel });
  choices.push({ value: 'no', label: 'Not right now' });

  return (
    <section className="rl-meds">
      <h3 className="rl-meds__title">{fillPetName(config.questionText, petName)}</h3>
      <RoomLoaderHtml html={config.introHtml} className="rl-meds__intro" />

      {meds.map((med) => {
        const key = chronicMedKey(petKey, med.prescriptionId);
        const answer = String(formData[key] ?? '');
        return (
          <div key={med.prescriptionId} className="rl-med">
            <div className="rl-med__head">
              <span className="rl-med__name">
                {med.name}
                {med.strength ? ` ${med.strength}` : ''}
              </span>
              {med.autoshipActive ? (
                <span className="rl-med__badge">Auto-ship already running</span>
              ) : null}
            </div>
            {med.instructions ? <p className="rl-med__sig">{med.instructions}</p> : null}
            <div className="rl-choices" role="radiogroup" aria-label={`Refill ${med.name}`}>
              {choices.map((choice) => (
                <label
                  key={choice.value}
                  className={answer === choice.value ? 'is-selected' : undefined}
                >
                  <input
                    type="radio"
                    name={key}
                    value={choice.value}
                    checked={answer === choice.value}
                    disabled={disabled}
                    onChange={() => onChange(key, choice.value)}
                  />
                  <span>{choice.label}</span>
                </label>
              ))}
            </div>
          </div>
        );
      })}

      {config.allowFreeText ? (
        <div className="rl-med rl-med--other">
          <label className="rl-label" htmlFor={chronicMedsOtherKey(petKey)}>
            {config.freeTextLabel}
          </label>
          <textarea
            id={chronicMedsOtherKey(petKey)}
            className="rl-textarea"
            rows={2}
            disabled={disabled}
            value={String(formData[chronicMedsOtherKey(petKey)] ?? '')}
            onChange={(e) => onChange(chronicMedsOtherKey(petKey), e.target.value)}
          />
        </div>
      ) : null}
    </section>
  );
}
