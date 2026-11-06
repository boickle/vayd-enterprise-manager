import type { ReactNode } from 'react';
import { premedsWindowSpanLabel, usePracticePremedsWindowMinutes } from '../utils/premedsWindow';

type Props = {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  className?: string;
  /** Shown under the checkbox (why it was pre-checked, or a "had pre-meds before" warning). */
  notice?: ReactNode;
  /** Warning (amber) when unchecked despite history; info (blue) when explaining a pre-check. */
  noticeTone?: 'warning' | 'info';
  /** Purple callout when checked (forward booking, etc.). */
  emphasizeWhenChecked?: boolean;
};

/** "Needs pre-meds" toggle — narrows the visit's arrival window to the practice pre-meds window. */
export function PremedsCheckbox({
  checked,
  onChange,
  disabled,
  className,
  notice,
  noticeTone = checked ? 'info' : 'warning',
  emphasizeWhenChecked = false,
}: Props) {
  const minutes = usePracticePremedsWindowMinutes();
  return (
    <div
      className={[
        'premeds-checkbox-wrap',
        emphasizeWhenChecked && checked ? 'premeds-checkbox-wrap--emphasized' : null,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <label className="premeds-checkbox">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>
          Needs pre-meds
          <span className="premeds-checkbox-hint muted">
            {' '}
            (arrival window up to {premedsWindowSpanLabel(minutes)})
          </span>
        </span>
      </label>
      {notice ? (
        <p
          className={[
            'premeds-checkbox-notice',
            noticeTone === 'info' ? 'premeds-checkbox-notice--info' : null,
          ]
            .filter(Boolean)
            .join(' ')}
          role="note"
        >
          {notice}
        </p>
      ) : null}
    </div>
  );
}
