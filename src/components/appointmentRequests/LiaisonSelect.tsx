import type { ClientLiaisonOption } from '../../api/holds';
import { staffShortName } from '../../utils/appointmentRequestTableRow';

type Person = { id: number; firstName: string | null; lastName: string | null };

type Props = {
  /** Current owner, or null when nobody owns it yet. */
  value: Person | null;
  liaisons: readonly ClientLiaisonOption[];
  saving?: boolean;
  /** Anyone can hand the request to anyone (themselves, someone else, or nobody). */
  onChange: (employeeId: number | null) => void;
  ariaLabel?: string;
  /** Read-only users see the liaison but can't change it. */
  disabled?: boolean;
};

/** Liaison column: one owner per request or hold. */
export function LiaisonSelect({ value, liaisons, saving, onChange, ariaLabel, disabled }: Props) {
  // The owner may not be a CL (e.g. a doctor placed the hold); keep them selectable.
  const options: Person[] =
    value && !liaisons.some((l) => l.id === value.id) ? [value, ...liaisons] : [...liaisons];
  return (
    <select
      className={`appt-table-liaison${value ? ' appt-table-liaison--set' : ''}`}
      value={value?.id != null ? String(value.id) : ''}
      disabled={saving || disabled}
      aria-label={ariaLabel ?? 'Liaison'}
      onChange={(e) => {
        const raw = e.target.value;
        onChange(raw ? Number(raw) : null);
      }}
    >
      <option value="">{saving ? 'Saving…' : 'Select liaison'}</option>
      {options.map((p) => (
        <option key={p.id} value={String(p.id)}>
          {staffShortName(p, options)}
        </option>
      ))}
    </select>
  );
}
