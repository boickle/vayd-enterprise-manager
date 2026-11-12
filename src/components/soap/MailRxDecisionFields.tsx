import type { ReactNode } from 'react';
import type { MailOrderLine, MailRxAcuity } from '../../api/onlineStore';
import {
  clampRefillExpiration,
  dateForInput,
  maxRefillExpirationInput,
  refillExpirationCapNote,
  refillExpirationExceedsMax,
  todayInput,
} from '../../utils/printRxLabel';
import './MailRxDecisionFields.css';

export type MailRxDecisionDraft = {
  acuity: MailRxAcuity | '';
  refills: string;
  expiration: string;
  /** Shown under the date when a chart/reminder date was cut to the 1-year limit. */
  expirationCapNote?: string | null;
};

function addMonths(from: string, months: number): string {
  const date = from ? new Date(`${from}T12:00:00`) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  date.setMonth(date.getMonth() + months);
  return dateForInput(date);
}

export function initialMailRxDecisionFromLine(
  line: Pick<
    MailOrderLine,
    | 'authorizedAcuity'
    | 'authorizedRefills'
    | 'authorizedRefillExpiration'
    | 'refillsRemaining'
    | 'refillExpiresAt'
  >,
): MailRxDecisionDraft {
  const exp =
    line.authorizedRefillExpiration ||
    line.refillExpiresAt ||
    '';
  return {
    acuity: line.authorizedAcuity ?? '',
    refills:
      line.authorizedRefills != null
        ? String(line.authorizedRefills)
        : line.refillsRemaining != null
          ? String(line.refillsRemaining)
          : '',
    expiration: exp ? String(exp).slice(0, 10) : '',
  };
}

export function parsedMailRefills(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  return Number(text);
}

/** The first thing still missing before this line can be approved, in words. */
export function mailRxDecisionMissing(draft: MailRxDecisionDraft): string | null {
  if (!draft.acuity) return 'Choose acute or chronic.';
  const refills = parsedMailRefills(draft.refills);
  if (refills == null) return 'Enter how many refills (0 if none).';
  if (refills > 0 && !draft.expiration.trim()) return 'Enter a refill expiration.';
  return null;
}

type Props = {
  value: MailRxDecisionDraft;
  onChange: (next: MailRxDecisionDraft) => void;
  /** Auto-ship lines are almost always chronic; shown as a hint, not a default. */
  autoship?: boolean;
  /** e.g. View details beside acuity / expiration. */
  chartExtra?: ReactNode;
  /** Extra control beside the refills label. */
  refillsExtra?: ReactNode;
  onError?: (message: string | null) => void;
  disabled?: boolean;
};

export default function MailRxDecisionFields({
  value,
  onChange,
  autoship,
  chartExtra,
  refillsExtra,
  onError,
  disabled,
}: Props) {
  const refills = parsedMailRefills(value.refills) ?? 0;
  const setExpiration = (next: string) => {
    if (refillExpirationExceedsMax(next)) {
      onChange({
        ...value,
        expiration: maxRefillExpirationInput(),
        expirationCapNote:
          refillExpirationCapNote(next) ?? 'Refills can only run 1 year from today.',
      });
      onError?.(null);
      return;
    }
    onError?.(null);
    onChange({ ...value, expiration: next, expirationCapNote: null });
  };

  return (
    <div className="mail-rx-decision">
      <div className="mail-rx-decision__row">
        <div className="mail-rx-decision__field">
          <span className="mail-rx-decision__label">
            Acute or chronic
            {autoship ? (
              <span className="mail-rx-decision__hint">Auto-ship · usually chronic</span>
            ) : null}
            {chartExtra}
          </span>
          <div className="mail-rx-decision__seg" role="radiogroup" aria-label="Acute or chronic">
            {(['acute', 'chronic'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={value.acuity === option}
                className={value.acuity === option ? 'is-on' : ''}
                disabled={disabled}
                onClick={() => onChange({ ...value, acuity: option })}
              >
                {option === 'acute' ? 'Acute' : 'Chronic'}
              </button>
            ))}
          </div>
        </div>
        <label className="mail-rx-decision__field mail-rx-decision__field--exp">
          <span className="mail-rx-decision__label">
            Refill expiration
            {refills > 0 ? <span className="mail-rx-decision__hint">Required when refills &gt; 0</span> : null}
            <span className="mail-rx-decision__chips" role="group" aria-label="Set refill expiration">
              {([3, 6, 12] as const).map((months) => {
                const chip = clampRefillExpiration(addMonths(todayInput(), months));
                return (
                  <button
                    key={months}
                    type="button"
                    className={`mail-rx-decision__chip${value.expiration === chip ? ' is-on' : ''}`}
                    disabled={disabled}
                    onClick={() => setExpiration(chip)}
                  >
                    +{months}m
                  </button>
                );
              })}
            </span>
          </span>
          <input
            type="date"
            className="settings-input mail-rx-decision__date"
            max={maxRefillExpirationInput()}
            value={value.expiration}
            disabled={disabled}
            onChange={(e) => setExpiration(e.target.value)}
            required={refills > 0}
          />
          {value.expirationCapNote ? (
            <p className="mail-rx-decision__cap-note" role="status">
              {value.expirationCapNote}
            </p>
          ) : null}
        </label>
      </div>
      <label className="mail-rx-decision__field">
        <span className="mail-rx-decision__label">
          Refills
          {refillsExtra}
        </span>
        <input
          type="number"
          min={0}
          step={1}
          className="settings-input mail-rx-decision__refills"
          value={value.refills}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, refills: e.target.value })}
          placeholder="0 if none"
          required
        />
      </label>
    </div>
  );
}
