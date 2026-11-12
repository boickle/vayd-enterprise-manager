import type { ReactNode } from 'react';

/** True when a rate looks like a fraction (0.055) rather than a percent (5.5). */
export function looksLikeFraction(rate: number): boolean {
  return Number.isFinite(rate) && rate > 0 && rate < 1;
}

/**
 * A sales tax rate in percent. Typing 0.055 (the fraction) shows a warning, because the
 * practice would be charging a twentieth of a percent.
 */
export default function TaxRateInput(props: {
  label: ReactNode;
  value: number;
  disabled?: boolean;
  onChange: (rate: number) => void;
}) {
  const { label, value, disabled, onChange } = props;
  return (
    <label className="settings-label">
      {label}
      <input
        type="number"
        min={0}
        max={25}
        step="0.01"
        className="settings-input"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
      {looksLikeFraction(value) && (
        <span role="alert" className="settings-error" style={{ fontSize: 12, display: 'block' }}>
          Enter the percent, e.g. 5.5
        </span>
      )}
    </label>
  );
}
