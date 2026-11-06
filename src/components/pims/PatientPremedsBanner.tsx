import { useEffect, useState } from 'react';
import { Pill } from 'lucide-react';
import type { ScoutPatientWrite } from '../../api/patients';

type Props = {
  needsPremeds: boolean;
  note: string | null;
  /** Who last set it, e.g. "Deirdre F." */
  by?: string | null;
  onSave: (body: ScoutPatientWrite) => Promise<void>;
};

/**
 * Top-of-chart "Needs pre-meds for visits". When on, booking a visit for this pet starts
 * with "Needs pre-meds" checked.
 */
export default function PatientPremedsBanner({ needsPremeds, note, by, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(note ?? '');
  }, [note]);

  async function save(body: ScoutPatientWrite) {
    setBusy(true);
    setError(null);
    try {
      await onSave(body);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  const form = editing ? (
    <div className="pims-emr-premeds__form">
      <input
        className="settings-input"
        value={draft}
        maxLength={1000}
        placeholder="What and when, e.g. Gabapentin 100 mg 2 h before"
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter')
            void save({ needsPremeds: true, premedsNote: draft.trim() || null });
          if (e.key === 'Escape') setEditing(false);
        }}
        aria-label="Pre-meds instructions"
        autoFocus
      />
      <button
        type="button"
        className="btn btn-sm"
        disabled={busy}
        onClick={() => void save({ needsPremeds: true, premedsNote: draft.trim() || null })}
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
      <button
        type="button"
        className="btn secondary btn-sm"
        disabled={busy}
        onClick={() => {
          setDraft(note ?? '');
          setEditing(false);
        }}
      >
        Cancel
      </button>
    </div>
  ) : null;

  if (!needsPremeds) {
    return (
      <div className="pims-emr-premeds pims-emr-premeds--off">
        {editing ? (
          form
        ) : (
          <button
            type="button"
            className="pims-emr-premeds__add"
            onClick={() => setEditing(true)}
            title="Booking a visit for this pet will start with Needs pre-meds checked"
          >
            <Pill size={13} aria-hidden /> Mark as needing pre-meds for visits
          </button>
        )}
        {error ? <span className="pims-emr-premeds__error">{error}</span> : null}
      </div>
    );
  }

  return (
    <div className="pims-emr-premeds" role="note">
      <div className="pims-emr-premeds__head">
        <span className="pims-emr-premeds__label">
          <Pill size={14} aria-hidden /> Needs pre-meds for every visit
        </span>
        {!editing ? (
          <span className="pims-emr-premeds__actions">
            <button type="button" disabled={busy} onClick={() => setEditing(true)}>
              Edit
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm('Turn off "Needs pre-meds" for this pet?')) {
                  void save({ needsPremeds: false });
                }
              }}
            >
              Turn off
            </button>
          </span>
        ) : null}
      </div>
      {editing ? (
        form
      ) : note || by ? (
        <div className="pims-emr-premeds__note">
          {note}
          {by ? (
            <span className="pims-emr-premeds__by">{note ? ` — ${by}` : `Set by ${by}`}</span>
          ) : null}
        </div>
      ) : null}
      {error ? <span className="pims-emr-premeds__error">{error}</span> : null}
    </div>
  );
}
