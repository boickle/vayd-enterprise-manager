import { useEffect, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import DateWheelPicker from '../DateWheelPicker';
import './StockLotPicker.css';

export function dateInputValue(value: string | null | undefined): string {
  if (!value) return '';
  const slice = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(slice) ? slice : '';
}

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function isoToDisplay(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '';
  return `${m}/${d}/${y}`;
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2200) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Empty string clears the date. `null` means the text is not a finished date yet. */
function parseTypedExpiration(raw: string, allowShortYear: boolean): string | null {
  const t = raw.trim();
  if (!t) return '';
  let match = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return toIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (match) {
    const yearRaw = match[3];
    if (yearRaw.length === 2 && !allowShortYear) return null;
    let year = Number(yearRaw);
    if (yearRaw.length === 2) year += year >= 70 ? 1900 : 2000;
    return toIsoDate(year, Number(match[1]), Number(match[2]));
  }
  match = t.match(/^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (match) {
    const month = MONTHS[match[1].toLowerCase()];
    if (!month) return null;
    return toIsoDate(Number(match[3]), month, Number(match[2]));
  }
  return null;
}

/**
 * Expiration date entry for lots: type MM/DD/YYYY, or tap the calendar to open
 * the month / day / year wheel. Starts empty — the wheel only appears on request
 * so it cannot be swiped by accident on a phone.
 */
export function ExpirationDateField({
  value,
  disabled,
  required,
  onCommit,
  ariaLabel,
  className,
}: {
  value: string | null | undefined;
  disabled?: boolean;
  required?: boolean;
  onCommit: (iso: string | null) => void;
  ariaLabel?: string;
  className?: string;
}) {
  const iso = dateInputValue(value);
  const display = iso ? isoToDisplay(iso) : '';
  const [draft, setDraft] = useState(display);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wheelOpen, setWheelOpen] = useState(false);

  useEffect(() => {
    if (!focused) {
      setDraft(display);
      setError(null);
    }
  }, [display, focused]);

  function commitIfComplete(raw: string) {
    const parsed = parseTypedExpiration(raw, false);
    if (parsed == null) return;
    setError(null);
    const next = parsed || null;
    if ((next ?? '') !== iso) onCommit(next);
  }

  return (
    <>
      <div className={`stock-lot-exp${className ? ` ${className}` : ''}`}>
        <input
          className="settings-input"
          type="text"
          inputMode="text"
          autoComplete="off"
          placeholder="MM/DD/YYYY"
          value={draft}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-invalid={error ? true : undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            const parsed = parseTypedExpiration(draft, true);
            if (parsed == null) {
              if (draft.trim()) setError('Enter a date as MM/DD/YYYY');
              return;
            }
            setError(null);
            const next = parsed || null;
            setDraft(next ? isoToDisplay(next) : '');
            if ((next ?? '') !== iso) onCommit(next);
          }}
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            setError(null);
            commitIfComplete(next);
          }}
          required={required}
        />
        <button
          type="button"
          className="stock-lot-exp__cal"
          disabled={disabled}
          aria-label="Pick expiration date"
          aria-expanded={wheelOpen}
          onClick={() => setWheelOpen((v) => !v)}
        >
          <CalendarDays size={16} strokeWidth={2} aria-hidden />
        </button>
        {wheelOpen ? (
          <DateWheelPicker
            title="Expiration date"
            value={iso}
            onChange={(next) => {
              setError(null);
              setDraft(isoToDisplay(next));
              onCommit(next);
            }}
            onClear={
              required
                ? undefined
                : () => {
                    setError(null);
                    setDraft('');
                    onCommit(null);
                  }
            }
            onClose={() => setWheelOpen(false)}
          />
        ) : null}
      </div>
      {error ? (
        <span style={{ display: 'block', marginTop: 4, color: '#dc2626', fontSize: 12 }}>{error}</span>
      ) : null}
    </>
  );
}

export default ExpirationDateField;
