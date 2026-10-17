// src/pages/roomLoader/LabPanelsSection.tsx
// The labs question for one pet, built from the practice's configured panel rules.
// A rule with one option is a yes/no; a rule with several is a choose-one. Crossing a
// panel out reveals whichever individual tests the practice configured as its sub-asks.
import { AlertTriangle } from 'lucide-react';
import type {
  RoomLoaderPanelOption,
  RoomLoaderPanelRule,
} from '../../utils/roomLoaderConfigTypes';
import {
  estimateLinesReplacedByPanel,
  panelSubAsksFor,
  type EngineContext,
} from '../../utils/roomLoaderOfferEngine';
import RoomLoaderHtml from './RoomLoaderHtml';
import type { RoomLoaderPriceFor } from './RoomLoaderPrice';
import { fillLabCopy } from './fillLabCopy';
import {
  PANEL_ACCEPTED,
  PANEL_DECLINED,
  chosenPanelOptionId,
  panelAnswerKey,
  panelIsDeclined,
  panelSubAskKey,
} from './roomLoaderFormKeys';
import './RoomLoaderSections.css';

/** Labs page “sample results” image from Settings → Labs page copy (used when the panel has no image). */
export type LabsPageSampleImage = {
  imageUrl: string;
  imageCaption: string;
};

type Props = {
  petKey: string;
  petName: string;
  rules: RoomLoaderPanelRule[];
  ctx: EngineContext;
  formData: Record<string, any>;
  onChange: (key: string, value: string) => void;
  /** Formats a catalog price for display, or returns null while prices are loading. */
  priceFor: RoomLoaderPriceFor;
  doctorName?: string;
  disabled?: boolean;
  labsPageSample?: LabsPageSampleImage | null;
};

function panelOptionWithLabsSample(
  option: RoomLoaderPanelOption,
  labsPageSample?: LabsPageSampleImage | null
): RoomLoaderPanelOption {
  if (option.imageUrl || !labsPageSample?.imageUrl) return option;
  return {
    ...option,
    imageUrl: labsPageSample.imageUrl,
    imageCaption: labsPageSample.imageCaption || option.imageCaption,
  };
}

function PanelFigure({
  option,
  layout = 'block',
}: {
  option: RoomLoaderPanelOption;
  layout?: 'block' | 'side';
}) {
  if (!option.imageUrl) return null;
  return (
    <figure
      className={`rl-panel__figure${layout === 'side' ? ' rl-panel__figure--side' : ''}`}
    >
      <img
        src={option.imageUrl}
        alt={option.imageCaption || `${option.displayName} sample results`}
        onError={(e) => {
          e.currentTarget.style.display = 'none';
        }}
      />
      {option.imageCaption ? <figcaption>{option.imageCaption}</figcaption> : null}
    </figure>
  );
}

function namesReplacedOnEstimate(option: RoomLoaderPanelOption, ctx: EngineContext): string[] {
  return estimateLinesReplacedByPanel(option, ctx.estimateLines).map((line) => {
    const match = option.replacesItems.find(
      (ref) =>
        (line.itemId != null &&
          ref.itemType === line.itemType &&
          Number(ref.itemId) === Number(line.itemId)) ||
        (ref.code &&
          line.code &&
          ref.code.trim().toUpperCase() === String(line.code).trim().toUpperCase())
    );
    return match?.name || line.code || 'an item';
  });
}

function PanelBody({ option }: { option: RoomLoaderPanelOption }) {
  return (
    <>
      <RoomLoaderHtml html={option.descriptionHtml} className="rl-panel__desc" />
      <PanelFigure option={option} />
    </>
  );
}

export default function LabPanelsSection({
  petKey,
  petName,
  rules,
  ctx,
  formData,
  onChange,
  priceFor,
  doctorName = 'your veterinarian',
  disabled = false,
  labsPageSample = null,
}: Props) {
  if (rules.length === 0) return null;

  return (
    <div className="rl-panels">
      {rules.map((rule) => {
        const answerKey = panelAnswerKey(petKey, rule.id);
        const answer = String(formData[answerKey] ?? '');
        const multi = rule.options.length > 1;
        const declined = panelIsDeclined(answer);
        const chosenId = chosenPanelOptionId(answer, rule.options[0]?.id ?? '');
        const chosen = rule.options.find((o) => o.id === chosenId) ?? null;
        const copyVars = {
          petName,
          doctorName,
          panel1: rule.options[0]?.displayName || rule.options[0]?.item.name || 'this panel',
          panel2: rule.options[1]?.displayName || rule.options[1]?.item.name || 'the other panel',
        };
        const introSource =
          ctx.medicalConcern && (rule.concernIntroHtml || '').trim() !== ''
            ? rule.concernIntroHtml
            : rule.introHtml;
        const closingSource =
          ctx.medicalConcern && (rule.concernClosingHtml || '').trim() !== ''
            ? rule.concernClosingHtml
            : rule.closingHtml;
        const replacedNames = chosen ? namesReplacedOnEstimate(chosen, ctx) : [];

        return (
          <section key={rule.id} className="rl-panel" aria-labelledby={`${answerKey}-label`}>
            <h3 id={`${answerKey}-label`} className="rl-panel__title">
              {multi
                ? `Which panel would you like ${petName} to receive?`
                : fillLabCopy(rule.options[0].displayName, copyVars)}
            </h3>

            {multi ? (
              <RoomLoaderHtml html={fillLabCopy(introSource, copyVars)} className="rl-panel__intro" />
            ) : null}

            {multi ? (
              <div className="rl-panel__options" role="radiogroup" aria-labelledby={`${answerKey}-label`}>
                {rule.options.map((option) => {
                  const price = priceFor(option.item);
                  return (
                    <label
                      key={option.id}
                      className={`rl-option${answer === option.id ? ' is-selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name={answerKey}
                        value={option.id}
                        checked={answer === option.id}
                        disabled={disabled}
                        onChange={() => onChange(answerKey, option.id)}
                      />
                      <span className="rl-option__body">
                        <span className="rl-option__head">
                          <span className="rl-option__name">{option.displayName}</span>
                          {price ? <span className="rl-option__price">{price}</span> : null}
                        </span>
                        <PanelBody option={{ ...option, descriptionHtml: fillLabCopy(option.descriptionHtml, copyVars) }} />
                      </span>
                    </label>
                  );
                })}
                <label className={`rl-option rl-option--decline${declined ? ' is-selected' : ''}`}>
                  <input
                    type="radio"
                    name={answerKey}
                    value={PANEL_DECLINED}
                    checked={declined}
                    disabled={disabled}
                    onChange={() => onChange(answerKey, PANEL_DECLINED)}
                  />
                  <span className="rl-option__body">
                    <span className="rl-option__name">No thank you</span>
                  </span>
                </label>
              </div>
            ) : (
              <div className="rl-panel__single">
                <div className="rl-panel__prose">
                  <PanelFigure
                    option={panelOptionWithLabsSample(rule.options[0], labsPageSample)}
                    layout="side"
                  />
                  {(introSource || '').trim() !== '' ? (
                    <RoomLoaderHtml
                      html={fillLabCopy(introSource, copyVars)}
                      className="rl-panel__intro"
                    />
                  ) : null}
                  <RoomLoaderHtml
                    html={fillLabCopy(rule.options[0].descriptionHtml, copyVars)}
                    className="rl-panel__desc"
                  />
                </div>
                <div className="rl-yesno" role="radiogroup" aria-labelledby={`${answerKey}-label`}>
                  <label className={answer === PANEL_ACCEPTED ? 'is-selected' : undefined}>
                    <input
                      type="radio"
                      name={answerKey}
                      value={PANEL_ACCEPTED}
                      checked={answer === PANEL_ACCEPTED}
                      disabled={disabled}
                      onChange={() => onChange(answerKey, PANEL_ACCEPTED)}
                    />
                    <span>
                      Yes, please
                      {priceFor(rule.options[0].item) ? (
                        <> — {priceFor(rule.options[0].item)}</>
                      ) : null}
                    </span>
                  </label>
                  <label className={declined ? 'is-selected' : undefined}>
                    <input
                      type="radio"
                      name={answerKey}
                      value={PANEL_DECLINED}
                      checked={declined}
                      disabled={disabled}
                      onChange={() => onChange(answerKey, PANEL_DECLINED)}
                    />
                    <span>Not this time</span>
                  </label>
                </div>
              </div>
            )}

            {declined ? (
              <PanelSubAsks
                petKey={petKey}
                options={rule.options}
                ctx={ctx}
                formData={formData}
                onChange={onChange}
                priceFor={priceFor}
                disabled={disabled}
              />
            ) : null}

            {(closingSource || '').trim() !== '' ? (
              <RoomLoaderHtml html={fillLabCopy(closingSource, copyVars)} className="rl-panel__closing" />
            ) : null}

            {replacedNames.length > 0 ? (
              <p className="rl-panel__replaces">
                This panel already includes {replacedNames.join(', ')}, so we have taken{' '}
                {replacedNames.length > 1 ? 'those' : 'that'} off your estimate.
              </p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

/**
 * The individual tests offered after a panel is crossed out. Options are flattened
 * because a declined choose-one rule should still surface each panel's follow-ups.
 */
function PanelSubAsks({
  petKey,
  options,
  ctx,
  formData,
  onChange,
  priceFor,
  disabled,
}: {
  petKey: string;
  options: RoomLoaderPanelOption[];
  ctx: EngineContext;
  formData: Record<string, any>;
  onChange: (key: string, value: string) => void;
  priceFor: Props['priceFor'];
  disabled: boolean;
}) {
  const seen = new Set<string>();
  const subAsks = options
    .flatMap((option) => panelSubAsksFor(option, ctx))
    .filter((sub) => {
      const key = `${sub.item.itemType}:${sub.item.itemId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (subAsks.length === 0) return null;

  return (
    <div className="rl-subasks">
      <p className="rl-subasks__lead">
        No problem. Would you like any of these on their own instead?
      </p>
      {subAsks.map((sub) => {
        const key = panelSubAskKey(petKey, sub.id);
        const answer = String(formData[key] ?? '');
        const price = priceFor(sub.item);
        return (
          <div key={sub.id} className="rl-subask">
            <div className="rl-subask__head">
              <span className="rl-subask__name">{sub.displayName || sub.item.name}</span>
              {price ? <span className="rl-subask__price">{price}</span> : null}
            </div>
            <div className="rl-yesno" role="radiogroup" aria-label={sub.displayName || sub.item.name}>
              <label className={answer === 'yes' ? 'is-selected' : undefined}>
                <input
                  type="radio"
                  name={key}
                  value="yes"
                  checked={answer === 'yes'}
                  disabled={disabled}
                  onChange={() => onChange(key, 'yes')}
                />
                <span>Yes, add it</span>
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
                <span>No thanks</span>
              </label>
            </div>
            {answer === 'no' && sub.cautionHtml ? (
              <div className="rl-caution">
                <AlertTriangle size={15} aria-hidden className="rl-caution__icon" />
                <div>
                  <strong className="rl-caution__title">Why we recommend this</strong>
                  <RoomLoaderHtml html={sub.cautionHtml} />
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
