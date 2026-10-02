import type { PracticeTaxSettings } from '../../api/taxes';

export type TaxLevelOption = { value: number; label: string };

/** Build picker options: always None + level 1; 2/3 only when enabled (or currently selected). */
export function taxLevelOptions(
  settings: PracticeTaxSettings | null | undefined,
  currentValue?: number | null
): TaxLevelOption[] {
  const level1Name = settings?.taxLevel1Name?.trim() || 'Sales Tax';
  const level2Name = settings?.taxLevel2Name?.trim() || 'Tax Level 2';
  const level3Name = settings?.taxLevel3Name?.trim() || 'Tax Level 3';
  const current =
    currentValue != null && Number.isFinite(Number(currentValue))
      ? Number(currentValue)
      : null;

  const options: TaxLevelOption[] = [
    { value: 0, label: 'None' },
    { value: 1, label: level1Name },
  ];
  if (settings?.showTaxLevel2 || current === 2) {
    options.push({ value: 2, label: level2Name });
  }
  if (settings?.showTaxLevel3 || current === 3) {
    options.push({ value: 3, label: level3Name });
  }
  return options;
}

/** Normalize stored taxLevelValue for the select (null → None). */
export function taxLevelSelectValue(raw: number | null | undefined): number {
  if (raw == null || !Number.isFinite(Number(raw))) return 0;
  return Number(raw);
}

type Props = {
  settings: PracticeTaxSettings | null | undefined;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  label?: string;
};

/** Sales Tax dropdown for catalog items (None / Sales Tax / optional levels 2–3). */
export default function TaxLevelSelect({
  settings,
  value,
  onChange,
  disabled,
  id,
  className = 'settings-input',
  label = 'Sales Tax',
}: Props) {
  const options = taxLevelOptions(settings, value);
  return (
    <label className="settings-label">
      {label}
      <select
        id={id}
        className={className}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
