// src/pages/roomLoader/RoomLoaderLabsPage.tsx
// The labs page body for one pet. Every heading, blurb and image comes from the
// practice's Room Loader configuration; this file only decides layout.
import type { ReactNode } from 'react';
import { AlertTriangle, ClipboardList } from 'lucide-react';
import type { RoomLoaderConfig } from '../../utils/roomLoaderConfigTypes';
import { fillPetName, type EngineContext, type ResolvedPetPlan } from '../../utils/roomLoaderOfferEngine';
import LabPanelsSection from './LabPanelsSection';
import RoomLoaderHtml from './RoomLoaderHtml';
import { sampleInstructionsForAnswers } from './roomLoaderConfigPlan';
import type { RoomLoaderPriceFor } from './RoomLoaderPrice';
import { PANEL_ACCEPTED, PANEL_DECLINED, medicalConcernPanelKey } from './roomLoaderFormKeys';
import './RoomLoaderSections.css';

type Props = {
  config: RoomLoaderConfig;
  petKey: string;
  petName: string;
  plan: ResolvedPetPlan;
  ctx: EngineContext;
  formData: Record<string, any>;
  onChange: (key: string, value: string) => void;
  priceFor: RoomLoaderPriceFor;
  errors: Record<string, string>;
  /** Membership badge rendered beside the pet's name. */
  badge?: ReactNode;
  doctorName?: string;
  disabled?: boolean;
};

/** True when the practice configured nothing for this pet, so the page should stay empty. */
export function labsPageIsEmpty(plan: ResolvedPetPlan): boolean {
  return plan.panelRules.length === 0 && plan.medicalConcernOptions.length === 0;
}

export default function RoomLoaderLabsPage({
  config,
  petKey,
  petName,
  plan,
  ctx,
  formData,
  onChange,
  priceFor,
  errors,
  badge,
  doctorName,
  disabled = false,
}: Props) {
  if (labsPageIsEmpty(plan)) return null;

  const sampleInstructions = sampleInstructionsForAnswers({
    config,
    plan,
    ctx,
    petKey,
    formData,
  });
  const page = config.labsPage;
  const intro =
    ctx.medicalConcern && page.medicalConcernIntroHtml.trim() !== ''
      ? page.medicalConcernIntroHtml
      : page.introHtml;
  const labsPageSample =
    page.imageUrl != null && page.imageUrl !== ''
      ? { imageUrl: page.imageUrl, imageCaption: page.imageCaption ?? '' }
      : null;

  return (
    <div className="rl-labs">
      {page.title.trim() !== '' || intro.trim() !== '' ? (
        <header className="rl-labs__header">
          {page.title.trim() !== '' ? <h1 className="rl-labs__title">{page.title}</h1> : null}
          {intro.trim() !== '' ? (
            <RoomLoaderHtml html={intro} className="rl-labs__intro" />
          ) : null}
        </header>
      ) : null}

      <div className="rl-labs__pet">
        <h2 className="rl-labs__petName">{petName}</h2>
        {badge}
      </div>

      <LabPanelsSection
        petKey={petKey}
        petName={petName}
        rules={plan.panelRules}
        ctx={ctx}
        formData={formData}
        onChange={onChange}
        priceFor={priceFor}
        doctorName={doctorName}
        disabled={disabled}
        labsPageSample={labsPageSample}
      />

      {plan.panelRules.map((rule) => {
        const message = errors[`${petKey}_panel_${rule.id}`];
        return message ? (
          <p key={rule.id} className="rl-labs__error">
            {message}
          </p>
        ) : null;
      })}

      {plan.medicalConcernOptions.length > 0 ? (
        <section className="rl-panels">
          <RoomLoaderHtml html={config.medicalConcern.introHtml} className="rl-panel__intro" />
          {plan.medicalConcernOptions.map((option) => {
            const key = medicalConcernPanelKey(petKey, option.id);
            const answer = String(formData[key] ?? '');
            const price = priceFor(option.item);
            return (
              <div key={option.id} className="rl-panel" aria-labelledby={`${key}-label`}>
                <h3 id={`${key}-label`} className="rl-panel__title">
                  {option.displayName}
                  {price ? <span className="rl-option__price">{price}</span> : null}
                </h3>
                <RoomLoaderHtml html={option.descriptionHtml} className="rl-panel__desc" />
                {option.imageUrl ? (
                  <figure className="rl-panel__figure">
                    <img
                      src={option.imageUrl}
                      alt={option.imageCaption || option.displayName}
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                    {option.imageCaption ? <figcaption>{option.imageCaption}</figcaption> : null}
                  </figure>
                ) : null}
                <div className="rl-yesno" role="radiogroup" aria-labelledby={`${key}-label`}>
                  <label className={answer === PANEL_ACCEPTED ? 'is-selected' : undefined}>
                    <input
                      type="radio"
                      name={key}
                      value={PANEL_ACCEPTED}
                      checked={answer === PANEL_ACCEPTED}
                      disabled={disabled}
                      onChange={() => onChange(key, PANEL_ACCEPTED)}
                    />
                    <span>Yes, please</span>
                  </label>
                  <label className={answer === PANEL_DECLINED ? 'is-selected' : undefined}>
                    <input
                      type="radio"
                      name={key}
                      value={PANEL_DECLINED}
                      checked={answer === PANEL_DECLINED}
                      disabled={disabled}
                      onChange={() => onChange(key, PANEL_DECLINED)}
                    />
                    <span>Not this time</span>
                  </label>
                </div>
                {answer === PANEL_DECLINED && config.defaultDeclineCautionHtml.trim() !== '' ? (
                  <div className="rl-caution">
                    <AlertTriangle size={15} aria-hidden className="rl-caution__icon" />
                    <RoomLoaderHtml html={config.defaultDeclineCautionHtml} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}

      {sampleInstructions.map((instruction) => (
        <aside key={instruction.id} className="rl-sample">
          <ClipboardList size={16} aria-hidden className="rl-sample__icon" />
          <div className="rl-sample__body">
            {instruction.heading.trim() !== '' ? (
              <h3 className="rl-sample__title">{fillPetName(instruction.heading, petName)}</h3>
            ) : null}
            <RoomLoaderHtml html={fillPetName(instruction.bodyHtml, petName)} />
          </div>
        </aside>
      ))}
    </div>
  );
}
