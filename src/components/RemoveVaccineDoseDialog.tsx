import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, Syringe } from 'lucide-react';
import {
  recordedDoseConflict,
  type VaccineDoseRemoval,
  type VaccineDoseRemovalReason,
} from '../api/visitWorkflow';
import './AppDialog.css';
import './RemoveVaccineDoseDialog.css';

export const VACCINE_DOSE_REMOVAL_REASON_LABELS: Record<VaccineDoseRemovalReason, string> = {
  entered_in_error: 'Entered in error',
  wrong_patient: 'Wrong patient',
  not_given: 'Not given',
  duplicate: 'Duplicate entry',
  other: 'Other',
};

const REASONS = Object.keys(VACCINE_DOSE_REMOVAL_REASON_LABELS) as VaccineDoseRemovalReason[];

export type RemoveVaccineDoseInfo = {
  vaccineName: string | null;
  tagNumber?: string | null;
  dateVaccinated?: string | null;
  /** The invoice is paid (older lines: chart signed). `null` when the caller doesn't know. */
  wasSigned: boolean | null;
  /** The charge is coming off the invoice in the same step. */
  withCharge?: boolean;
  /** How the charge comes off; defaults to removing the line. */
  chargeAction?: 'remove' | 'return' | 'void' | 'move';
};

const CHARGE_ACTION_COPY: Record<
  NonNullable<RemoveVaccineDoseInfo['chargeAction']>,
  { title: string; effect: string; button: string }
> = {
  remove: {
    title: 'Remove the dose and the charge?',
    effect: 'The charge comes off the invoice.',
    button: 'Remove dose and charge',
  },
  return: {
    title: 'Return the vaccine and remove the dose?',
    effect: 'The vaccine is returned on a credit.',
    button: 'Return and remove dose',
  },
  void: {
    title: 'Void the invoice and remove the dose?',
    effect: 'The invoice is voided.',
    button: 'Void and remove dose',
  },
  move: {
    title: 'Move the charge and remove the dose?',
    effect: 'The charge moves to the other pet. Record the dose again on that pet.',
    button: 'Move and remove dose',
  },
};

function formatDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // Dose dates are picked as a calendar day and stored as UTC midnight.
  const midnightUtc = d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(midnightUtc ? { timeZone: 'UTC' } : {}),
  });
}

function RemoveVaccineDoseDialog({
  info,
  onDone,
}: {
  info: RemoveVaccineDoseInfo;
  onDone: (result: VaccineDoseRemoval | null) => void;
}) {
  const [reason, setReason] = useState<VaccineDoseRemovalReason | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDone(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  const name = info.vaccineName?.trim() || 'Vaccine';
  const given = formatDay(info.dateVaccinated);
  const isRabies = /rabies/i.test(name);
  const tag = info.tagNumber?.trim() || null;
  const noteRequired = reason === 'other';
  const canConfirm = reason != null && (!noteRequired || note.trim().length > 0);
  const charge = info.withCharge ? CHARGE_ACTION_COPY[info.chargeAction ?? 'remove'] : null;

  return (
    <div
      className="app-dialog-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDone(null);
      }}
    >
      <div
        className="app-dialog app-dialog--decline-how vax-remove"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vax-remove-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="app-dialog__lead">
          <span className="app-dialog__icon" aria-hidden>
            <Syringe size={18} />
          </span>
          <div>
            <h2 id="vax-remove-title" className="app-dialog__title">
              {charge ? charge.title : 'Remove this vaccine dose?'}
            </h2>
            <p className="app-dialog__item">
              {[name, tag ? `Tag ${tag}` : null, given ? `given ${given}` : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </div>

        <ul className="vax-remove__effects">
          {charge ? <li>{charge.effect}</li> : null}
          <li>
            The dose leaves the vaccine history and certificates. It is kept as a removed entry
            (who, when, why) that staff can see with “Show removed”.
          </li>
          {charge ? (
            <li>
              The reminder this vaccine added is deleted, and the crossed-out reminder it was
              replacing goes back to normal.
            </li>
          ) : (
            <li>
              The charge stays on the invoice, so its reminders stay. Remove the line from the
              invoice to change them.
            </li>
          )}
          {info.wasSigned === true ? (
            <li>The invoice is paid, so this needs the “Remove a paid vaccine dose” permission.</li>
          ) : null}
        </ul>

        {isRabies ? (
          <p className="vax-remove__warn">
            <AlertTriangle size={16} aria-hidden />
            <span>
              {tag ? `Rabies tag ${tag} will no longer be valid. ` : ''}
              If a rabies certificate was already printed or emailed, let the owner know — and
              the county, if it was reported.
            </span>
          </p>
        ) : null}

        <p className="app-dialog__hint">Why is it being removed?</p>
        <div className="vax-remove__reasons" role="radiogroup">
          {REASONS.map((value) => (
            <label key={value} className={`vax-remove__reason${reason === value ? ' is-on' : ''}`}>
              <input
                type="radio"
                name="vax-remove-reason"
                checked={reason === value}
                onChange={() => setReason(value)}
              />
              {VACCINE_DOSE_REMOVAL_REASON_LABELS[value]}
            </label>
          ))}
        </div>

        <label className="app-dialog__label" htmlFor="vax-remove-note">
          Note
          <span>{noteRequired ? 'Required' : 'Optional'}</span>
        </label>
        <textarea
          id="vax-remove-note"
          className="app-dialog__field"
          rows={2}
          value={note}
          placeholder="Recorded in the audit log with your name and the time"
          onChange={(e) => setNote(e.target.value)}
        />

        <div className="app-dialog__actions">
          <button type="button" className="app-dialog__btn" onClick={() => onDone(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="app-dialog__btn app-dialog__btn--danger"
            disabled={!canConfirm}
            onClick={() => reason && onDone({ reason, note: note.trim() || null })}
          >
            {charge ? charge.button : 'Remove dose'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Ask why a recorded dose is being removed. Resolves `null` when cancelled. */
export function askRemoveVaccineDose(info: RemoveVaccineDoseInfo): Promise<VaccineDoseRemoval | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (result: VaccineDoseRemoval | null) => {
      root.unmount();
      host.remove();
      resolve(result);
    };
    root.render(<RemoveVaccineDoseDialog info={info} onDone={done} />);
  });
}

/**
 * Run a removal that the API may refuse because a vaccine dose is recorded on the line. On that
 * refusal, ask why and retry with the dose removed too. Resolves `null` if the user backs out.
 */
export async function removeWithRecordedDose<T>(
  attempt: (removeDose?: VaccineDoseRemoval) => Promise<T>,
  chargeAction: RemoveVaccineDoseInfo['chargeAction'] = 'remove'
): Promise<T | null> {
  try {
    return await attempt();
  } catch (e) {
    const dose = recordedDoseConflict(e);
    if (!dose) throw e;
    const removal = await askRemoveVaccineDose({
      vaccineName: dose.vaccineName,
      tagNumber: dose.tagNumber,
      dateVaccinated: dose.dateVaccinated,
      wasSigned: dose.wasSigned,
      withCharge: true,
      chargeAction,
    });
    if (!removal) return null;
    return attempt(removal);
  }
}
