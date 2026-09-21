import { Check } from 'lucide-react';
import {
  isWeightAddressed,
  isWeightAwaitingConfirmation,
  type Vitals,
  type WeightUnit,
} from '../../utils/soapVitals';

const UNITS: [WeightUnit, string][] = [
  ['lb', 'Lb'],
  ['kg', 'kg'],
];

const OTHER_VITALS: [Exclude<keyof Vitals, 'weight' | 'weightUnit' | 'weightNotTaken' | 'weightConfirmed'>, string][] =
  [
    ['tempF', 'Temp °F'],
    ['hr', 'HR (bpm)'],
    ['rr', 'RR (rpm)'],
    ['bcs', 'BCS /9'],
    ['painScore', 'FAS /5'],
  ];

type Props = {
  vitals: Vitals;
  disabled: boolean;
  /** Patch state without persisting — for keystroke-by-keystroke edits. */
  onChange: (next: Vitals) => void;
  /** Patch state and write it to the encounter. */
  onCommit: (next: Vitals) => void;
  /** Distinguishes the two weight-unit radio groups when both views are mounted. */
  radioGroupName?: string;
};

/**
 * Weight and the rest of the vitals, shared by the tabbed SOAP form and the scribe
 * Document view.
 *
 * Scribe visits had no vitals UI at all, so the weight the wrap-up insists on before
 * signing was unreachable from the flow most visits actually use.
 */
export default function SoapVitalsFields({
  vitals,
  disabled,
  onChange,
  onCommit,
  radioGroupName = 'soap-weight-unit',
}: Props) {
  const awaitingConfirmation = isWeightAwaitingConfirmation(vitals);
  const addressed = isWeightAddressed(vitals);

  return (
    <>
      <div className="soap-subhead">Vitals (TPR, weight, BCS /9, FAS /5)</div>
      <div
        className={[
          'soap-weight',
          addressed ? '' : 'soap-weight--required',
          awaitingConfirmation ? 'soap-weight--unconfirmed' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="soap-weight__row">
          <label className="soap-vital soap-weight__value">
            <span>
              Weight{' '}
              <span className="soap-weight__req" aria-hidden>
                *
              </span>
            </span>
            <input
              className="soap-input"
              inputMode="decimal"
              placeholder="e.g. 12.4"
              value={vitals.weightNotTaken ? '' : vitals.weight}
              disabled={disabled || vitals.weightNotTaken}
              onChange={(e) =>
                onChange({
                  ...vitals,
                  weight: e.target.value,
                  weightNotTaken: false,
                  // Typing it is confirming it.
                  weightConfirmed: true,
                })
              }
              onBlur={(e) => {
                if (vitals.weightNotTaken) return;
                onCommit({
                  ...vitals,
                  weight: e.currentTarget.value,
                  weightNotTaken: false,
                  weightConfirmed: true,
                });
              }}
            />
          </label>
          <fieldset
            className="soap-weight__units"
            disabled={disabled || vitals.weightNotTaken}
          >
            <legend className="soap-sr-only">Weight unit</legend>
            {UNITS.map(([unit, label]) => (
              <label
                key={unit}
                className={
                  vitals.weightUnit === unit && !vitals.weightNotTaken
                    ? 'soap-weight__unit is-selected'
                    : 'soap-weight__unit'
                }
              >
                <input
                  type="radio"
                  name={radioGroupName}
                  value={unit}
                  checked={vitals.weightUnit === unit && !vitals.weightNotTaken}
                  disabled={disabled || vitals.weightNotTaken}
                  onChange={() =>
                    onCommit({ ...vitals, weightUnit: unit, weightNotTaken: false })
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
        </div>

        {awaitingConfirmation && !disabled && (
          <div className="soap-weight__confirm">
            <p>
              Scribe heard <strong>{vitals.weight.trim()} {vitals.weightUnit}</strong> in the
              recording. Check it against the scale before it goes on the chart — doses are
              calculated from this.
            </p>
            <button
              type="button"
              className="soap-btn small"
              onClick={() => onCommit({ ...vitals, weightConfirmed: true })}
            >
              <Check size={14} /> Confirm weight
            </button>
          </div>
        )}

        <label className="soap-weight__none">
          <input
            type="checkbox"
            checked={vitals.weightNotTaken}
            disabled={disabled}
            onChange={(e) => {
              const weightNotTaken = e.target.checked;
              onCommit({
                ...vitals,
                weightNotTaken,
                weight: weightNotTaken ? '' : vitals.weight,
                weightConfirmed: true,
              });
            }}
          />
          No weight taken
        </label>

        {!addressed && !awaitingConfirmation && !disabled && (
          <p className="soap-weight__hint">
            Enter a weight and choose Lb or kg, or select &ldquo;No weight taken.&rdquo; Required
            before signing.
          </p>
        )}
      </div>

      <div className="soap-vitals">
        {OTHER_VITALS.map(([key, label]) => (
          <label key={key} className="soap-vital">
            <span>{label}</span>
            <input
              className="soap-input"
              inputMode="decimal"
              value={vitals[key]}
              disabled={disabled}
              onChange={(e) => onChange({ ...vitals, [key]: e.target.value })}
              onBlur={() => onCommit(vitals)}
            />
          </label>
        ))}
      </div>

      <p className="soap-section-hint">
        BCS: 1 skeletal → 9 obese. FAS (fear/anxiety): 1 relaxed → 5 extremely reactive. Exam aids
        (treats, Calm &amp; Cozy, muzzle, etc.) go in Objective notes.
      </p>
    </>
  );
}
