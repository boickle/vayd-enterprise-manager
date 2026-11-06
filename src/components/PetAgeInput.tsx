import { useState } from 'react';
import { parseAgeStringToYears } from '../utils/membershipAge';

const AGE_UNITS = [
  { value: 'days', singular: 'day' },
  { value: 'weeks', singular: 'week' },
  { value: 'months', singular: 'month' },
  { value: 'years', singular: 'year' },
] as const;

type AgeUnit = (typeof AGE_UNITS)[number]['value'];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function splitAge(value: string): { amount: string; unit: AgeUnit } {
  const m = value.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(day|week|month|year)s?$/);
  if (m) return { amount: m[1], unit: `${m[2]}s` as AgeUnit };
  const years = value.trim() ? parseAgeStringToYears(value) : null;
  return { amount: years == null ? '' : String(Math.round(years * 10) / 10), unit: 'years' };
}

function joinAge(amount: string, unit: AgeUnit): string {
  if (!amount.trim()) return '';
  const entry = AGE_UNITS.find((u) => u.value === unit)!;
  return `${amount} ${Number(amount) === 1 ? entry.singular : entry.value}`;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Props = {
  /** Stored as "5 years" / "10 weeks", or a birthday as YYYY-MM-DD. */
  value: string;
  onChange: (value: string) => void;
  hasError?: boolean;
  padding?: string;
  borderRadius?: string;
};

/** Pet age as a number and a unit, or a birthday when the client knows it. */
export default function PetAgeInput({ value, onChange, hasError, padding = '8px', borderRadius = '6px' }: Props) {
  const [useBirthday, setUseBirthday] = useState(() => ISO_DATE.test(value.trim()));
  const [pickedUnit, setPickedUnit] = useState<AgeUnit>(() => splitAge(value).unit);
  const fieldStyle = {
    padding,
    border: `1px solid ${hasError ? '#ef4444' : '#d1d5db'}`,
    borderRadius,
    fontSize: '14px',
    minWidth: 0,
  } as const;
  const linkStyle = {
    background: 'none',
    border: 'none',
    padding: 0,
    marginTop: '4px',
    color: '#0f766e',
    fontSize: '12px',
    cursor: 'pointer',
    textDecoration: 'underline',
  } as const;

  if (useBirthday) {
    return (
      <div>
        <input
          type="date"
          aria-label="Birthday"
          value={ISO_DATE.test(value.trim()) ? value.trim() : ''}
          max={todayIso()}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...fieldStyle, width: '100%' }}
        />
        <button
          type="button"
          style={linkStyle}
          onClick={() => {
            setUseBirthday(false);
            onChange('');
          }}
        >
          Enter an approximate age instead
        </button>
      </div>
    );
  }

  const split = splitAge(value);
  const amount = split.amount;
  const unit = amount ? split.unit : pickedUnit;
  return (
    <div>
      <div style={{ display: 'flex', gap: '6px' }}>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          aria-label="Age"
          placeholder="e.g. 5"
          value={amount}
          onChange={(e) => onChange(joinAge(e.target.value, unit))}
          style={{ ...fieldStyle, width: '72px', flex: '0 0 72px' }}
        />
        <select
          aria-label="Age unit"
          value={unit}
          onChange={(e) => {
            const next = e.target.value as AgeUnit;
            setPickedUnit(next);
            onChange(joinAge(amount, next));
          }}
          style={{ ...fieldStyle, flex: 1, background: '#fff' }}
        >
          {AGE_UNITS.map((u) => (
            <option key={u.value} value={u.value}>
              {u.value}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        style={linkStyle}
        onClick={() => {
          setUseBirthday(true);
          onChange('');
        }}
      >
        I know the birthday
      </button>
    </div>
  );
}
