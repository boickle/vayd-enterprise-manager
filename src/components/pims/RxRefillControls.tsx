import { useState } from 'react';
import { apiErrorMessage } from '../../api/http';
import { updatePatientPrescription } from '../../api/visitWorkflow';
import { useCan } from '../../permissions/PermissionContext';

/**
 * Refills on a prescription in the chart (owner decisions Nov 6, 2026): change how many are left,
 * stop them (the family changed their mind), or write new directions, which stops this script and
 * starts a new one (the V11 rule: a refill never changes directions). Fewer or none: doctors and
 * techs. More: a licensed vet only, because writing refills is theirs (D2).
 */
export default function RxRefillControls({
  prescriptionId,
  patientId,
  refill,
  disabled,
  onChanged,
  onNewScript,
}: {
  prescriptionId: number;
  /** The pet whose chart this is (eVet scripts often name no pet), for the History. */
  patientId?: number | null;
  refill: number | null;
  disabled?: boolean;
  onChanged: (refillsLeft: number) => void;
  /** Opens billing with this item as a new script (it starts from the catalog's directions). */
  onNewScript?: () => void;
}) {
  const canLower = useCan('rx.sig.draft');
  const canRaise = useCan('rx.sig.enter');
  const current = Math.max(0, Number(refill) || 0);
  const [value, setValue] = useState(String(current));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!canLower) {
    return (
      <p className="rx-refill-controls__note">
        {current} refill{current === 1 ? '' : 's'} left. Ask a doctor or technician to change them.
      </p>
    );
  }
  const next = Math.floor(Number(value));
  const valid = Number.isFinite(next) && next >= 0 && next <= 99;
  const raising = valid && next > current;

  const save = async (to: number) => {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await updatePatientPrescription(prescriptionId, {
        refill: to,
        ...(patientId != null && patientId > 0 ? { patientId } : {}),
      });
      const left = Math.max(0, Number(saved.refill) || 0);
      setValue(String(left));
      onChanged(left);
      setMessage(left === 0 ? 'Refills stopped.' : `Saved: ${left} refill${left === 1 ? '' : 's'} left.`);
      return true;
    } catch (e) {
      setMessage(apiErrorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rx-refill-controls" onClick={(e) => e.stopPropagation()}>
      <label className="rx-refill-controls__count">
        Refills left
        <input
          type="number"
          min={0}
          max={99}
          value={value}
          disabled={disabled || busy}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="pims-patient-detail__linkish"
        disabled={disabled || busy || !valid || next === current || (raising && !canRaise)}
        title={raising && !canRaise ? 'Only a licensed veterinarian can add refills' : 'Save the refills left'}
        onClick={() => void save(next)}
      >
        Save refills
      </button>
      {current > 0 ? (
        <button
          type="button"
          className="pims-patient-detail__linkish"
          disabled={disabled || busy}
          onClick={() => {
            if (window.confirm('Stop refills on this prescription? It will have 0 refills left.')) void save(0);
          }}
        >
          Stop refills
        </button>
      ) : null}
      {onNewScript ? (
        <button
          type="button"
          className="pims-patient-detail__linkish"
          disabled={disabled || busy}
          title="Stop this prescription and write a new script with new directions"
          onClick={() => {
            if (
              !window.confirm(
                "New directions can't go on a refill. Stop this prescription (0 refills left) and write a new script? It starts from the item's usual directions, under the doctor, and needs approval."
              )
            ) {
              return;
            }
            void (async () => {
              if (current === 0 || (await save(0))) onNewScript();
            })();
          }}
        >
          New directions…
        </button>
      ) : null}
      {raising && !canRaise ? (
        <span className="rx-refill-controls__note">Only a licensed veterinarian can add refills.</span>
      ) : null}
      {message ? <span className="rx-refill-controls__note">{message}</span> : null}
    </div>
  );
}
