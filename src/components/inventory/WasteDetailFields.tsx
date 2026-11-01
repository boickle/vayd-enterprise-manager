import { useEffect, useState, type ReactNode } from 'react';
import { fetchAllEmployees } from '../../api/appointmentSettings';

export type WasteReasonOption = { code: string; label: string };
export type WasteMethodOption = { code: string; label: string };
export type WitnessOption = { id: number; name: string };

export type WasteDetailFieldsProps = {
  /** The item being wasted is a controlled drug: disposal is required and a witness may be named. */
  isControlled: boolean;
  /** Reasons to pick from. Leave out when the reason is fixed by the screen (it is then not shown). */
  reasons?: WasteReasonOption[];
  reasonCode?: string;
  onReasonChange?: (code: string) => void;
  /** Written why for "Other Correction", shown under the reasons with an Edit link. */
  reasonExplanation?: string;
  showReasonExplanation?: boolean;
  /** Disposal methods to offer (already limited for this reason and item). */
  methods: WasteMethodOption[];
  disposalCode: string;
  onDisposalChange: (code: string) => void;
  /** Show the disposal box for a non-controlled item (the reason asks for it). Controlled items always show it. */
  showDisposal?: boolean;
  disposalExplanation?: string;
  showDisposalExplanation?: boolean;
  /** Anything the screen needs between the disposal method and the notes (for example the lot picker). */
  children?: ReactNode;
  /** Hide the notes box when the screen writes its own note. */
  hideNotes?: boolean;
  notes?: string;
  onNotesChange?: (notes: string) => void;
  /** People who can co-sign controlled waste. Use useWitnessOptions() to load them. */
  witnessOptions: WitnessOption[];
  witnessEmployeeId: number | null;
  onWitnessChange: (id: number | null) => void;
  /** The signed-in employee, who cannot witness their own waste. */
  currentEmployeeId?: number | null;
};

const linkButton = {
  background: 'none',
  border: 0,
  padding: 0,
  color: '#0f766e',
  fontWeight: 600,
  cursor: 'pointer',
} as const;

/**
 * Loads employees for the Witness picker. Failing to load just leaves the picker empty:
 * the witness is optional, so waste can still be recorded.
 */
export function useWitnessOptions(enabled = true): WitnessOption[] {
  const [options, setOptions] = useState<WitnessOption[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void Promise.resolve()
      .then(() => fetchAllEmployees())
      .then((list) => {
        if (cancelled || !Array.isArray(list)) return;
        setOptions(
          list
            .filter((e) => (e as { isActive?: boolean }).isActive !== false)
            .map((e) => ({
              id: e.id,
              name: [e.firstName, e.lastName].filter(Boolean).join(' ') || `Employee #${e.id}`,
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return options;
}

/**
 * The detail fields of a waste record: reason, disposal method, notes and an optional witness.
 * Built for Waste / Adjust and the SOAP "drawn up, not given" box, and meant to be reused by the
 * client-return screen (CAT-11). Controlled drugs always need a disposal method (CAT-12); the
 * Witness picker appears for controlled drugs only.
 */
export default function WasteDetailFields({
  isControlled,
  reasons,
  reasonCode = '',
  onReasonChange,
  reasonExplanation,
  showReasonExplanation,
  methods,
  disposalCode,
  onDisposalChange,
  showDisposal = true,
  disposalExplanation,
  showDisposalExplanation,
  children,
  hideNotes,
  notes = '',
  onNotesChange,
  witnessOptions,
  witnessEmployeeId,
  onWitnessChange,
  currentEmployeeId,
}: WasteDetailFieldsProps) {
  const offerDisposal = isControlled || showDisposal;
  const witnesses = witnessOptions.filter(
    (w) => currentEmployeeId == null || w.id !== Number(currentEmployeeId)
  );
  return (
    <>
      {reasons ? (
        <fieldset style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
          <legend>Reason</legend>
          {reasons.map((r) => (
            <label key={r.code} className="settings-checkbox-item">
              <input
                type="radio"
                name="reason"
                checked={reasonCode === r.code}
                onChange={() => onReasonChange?.(r.code)}
              />
              <span>{r.label}</span>
            </label>
          ))}
          {showReasonExplanation && reasonExplanation ? (
            <p className="settings-muted" style={{ margin: '6px 0 0' }}>
              Why: {reasonExplanation}{' '}
              <button type="button" style={linkButton} onClick={() => onReasonChange?.(reasonCode)}>
                Edit
              </button>
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {offerDisposal ? (
        <fieldset style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginTop: 12 }}>
          <legend>Disposal method</legend>
          {isControlled ? (
            <p className="settings-muted" style={{ margin: '0 0 6px' }}>
              Required for controlled drugs.
            </p>
          ) : null}
          {methods.map((m) => (
            <label key={m.code} className="settings-checkbox-item">
              <input
                type="radio"
                name="disposal"
                required={isControlled}
                checked={disposalCode === m.code}
                onChange={() => onDisposalChange(m.code)}
              />
              <span>{m.label}</span>
            </label>
          ))}
          {showDisposalExplanation && disposalExplanation ? (
            <p className="settings-muted" style={{ margin: '6px 0 0' }}>
              How: {disposalExplanation}{' '}
              <button type="button" style={linkButton} onClick={() => onDisposalChange(disposalCode)}>
                Edit
              </button>
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {isControlled ? (
        <label className="settings-label" style={{ marginTop: 12 }}>
          Witness (optional)
          <select
            className="settings-input"
            value={witnessEmployeeId ?? ''}
            onChange={(e) => onWitnessChange(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">No witness</option>
            {witnesses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {children}

      {hideNotes ? null : (
        <label className="settings-label">
          Notes
          <textarea
            className="settings-input"
            rows={3}
            value={notes}
            onChange={(e) => onNotesChange?.(e.target.value)}
            style={{ maxWidth: 'none', width: '100%' }}
          />
        </label>
      )}
    </>
  );
}
