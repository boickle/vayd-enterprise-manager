import { useEffect, useState } from 'react';
import { Check, Pill } from 'lucide-react';
import { fetchPatientByIdStaff, patchPatient } from '../../api/patients';
import type { OutsideRecordPremeds } from '../../api/soapScribe';

type Props = {
  patientId: number;
  patientName?: string | null;
  premeds: OutsideRecordPremeds | null;
};

/**
 * The records suggest pre-visit meds: offer to mark the pet so every booking starts with
 * "Needs pre-meds" checked. Hidden when the pet is already marked.
 */
export default function RecordPremedsSuggestion({ patientId, patientName, premeds }: Props) {
  const [already, setAlready] = useState<boolean | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'dismissed'>('idle');
  const [error, setError] = useState<string | null>(null);
  const recommended = premeds?.recommended === true;

  useEffect(() => {
    if (!recommended) return;
    let cancelled = false;
    void fetchPatientByIdStaff(String(patientId))
      .then((p) => {
        if (!cancelled) setAlready((p as { needsPremeds?: unknown })?.needsPremeds === true);
      })
      .catch(() => {
        if (!cancelled) setAlready(false);
      });
    return () => {
      cancelled = true;
    };
  }, [recommended, patientId]);

  if (!recommended || already !== false || state === 'dismissed') return null;
  const pet = patientName?.trim() || 'This pet';

  async function turnOn() {
    setState('saving');
    setError(null);
    try {
      await patchPatient(String(patientId), {
        needsPremeds: true,
        premedsNote: premeds?.medication?.trim() || null,
      });
      setState('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
      setState('idle');
    }
  }

  return (
    <div className="rrw__premeds" role="note">
      <Pill size={16} aria-hidden />
      <div className="rrw__premeds-text">
        {state === 'done' ? (
          <strong>
            <Check size={14} aria-hidden /> {pet} is marked as needing pre-meds. Booking a visit
            will start with &ldquo;Needs pre-meds&rdquo; checked.
          </strong>
        ) : (
          <>
            <strong>Recommended: mark {pet} as needing pre-meds for visits.</strong>
            <span>{premeds?.reason}</span>
            {premeds?.medication ? <span>Records: {premeds.medication}</span> : null}
            {error ? <span className="rrw__premeds-error">{error}</span> : null}
          </>
        )}
      </div>
      {state === 'done' ? null : (
        <div className="rrw__premeds-actions">
          <button
            type="button"
            className="rdr__btn rdr__btn--primary"
            disabled={state === 'saving'}
            onClick={() => void turnOn()}
          >
            {state === 'saving' ? 'Turning on…' : 'Turn on Needs pre-meds'}
          </button>
          <button
            type="button"
            className="rdr__btn"
            disabled={state === 'saving'}
            onClick={() => setState('dismissed')}
          >
            Not now
          </button>
        </div>
      )}
    </div>
  );
}
