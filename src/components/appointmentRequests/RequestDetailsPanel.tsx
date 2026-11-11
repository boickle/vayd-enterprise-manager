/**
 * Left side of an open request on the Appointments list: who the client is, what they asked for,
 * the pets, notes (saved as you type), and the full form behind "View full request".
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

type Props = {
  clientName: ReactNode;
  clientType: 'new' | 'existing' | 'unknown';
  phone: string | null;
  email: string | null;
  address: string | null;
  /** Visit is somewhere other than the client's home. */
  alternateAddress: boolean;
  /** "Emergent – today", "Within 2 weeks"… */
  howSoon: string | null;
  /** "Requested Tue Dec 1 AM with Dr. Messina", "On hold Fri Nov 20"… */
  visitLine: string | null;
  notBookedReason: string | null;
  /** Special handling callout, pets list. */
  callout?: ReactNode;
  pets: ReactNode;
  notes: string;
  notesDisabled?: boolean;
  onSaveNotes: (text: string) => Promise<void>;
  /** The full form (all answers), shown under "View full request". */
  fullRequest: ReactNode;
  pdfLink?: ReactNode;
};

const AUTOSAVE_MS = 1200;

export function RequestDetailsPanel(props: Props) {
  const [notes, setNotes] = useState(props.notes);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [showFull, setShowFull] = useState(false);
  const lastSaved = useRef(props.notes);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A newer copy of the notes from the server (another person, socket refresh) wins if unedited.
  useEffect(() => {
    if (notes === lastSaved.current) {
      setNotes(props.notes);
      lastSaved.current = props.notes;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to server changes
  }, [props.notes]);

  const save = async (text: string) => {
    if (text === lastSaved.current) return;
    setSaveState('saving');
    try {
      await props.onSaveNotes(text);
      lastSaved.current = text;
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const onChange = (text: string) => {
    setNotes(text);
    setSaveState('idle');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(text), AUTOSAVE_MS);
  };

  return (
    <section className="req-details" aria-label="Client and request">
      <header className="req-details-head">
        <div className="req-details-name">{props.clientName}</div>
        {props.clientType !== 'unknown' ? (
          <span className={`req-details-chip req-details-chip--${props.clientType}`}>
            {props.clientType === 'existing' ? 'Existing client' : 'New client'}
          </span>
        ) : null}
      </header>
      <ul className="req-details-contact">
        {props.phone ? <li>☎ {props.phone}</li> : null}
        {props.email ? <li>✉ {props.email}</li> : null}
        {props.address ? (
          <li className={props.alternateAddress ? 'req-details-alt' : undefined}>
            📍 {props.address}
            {props.alternateAddress ? <strong> · visit at this address, not home</strong> : null}
          </li>
        ) : null}
      </ul>
      {props.howSoon || props.visitLine || props.notBookedReason ? (
        <dl className="req-details-facts">
          {props.howSoon ? (
            <>
              <dt>Wants</dt>
              <dd>{props.howSoon}</dd>
            </>
          ) : null}
          {props.visitLine ? (
            <>
              <dt>Visit</dt>
              <dd>{props.visitLine}</dd>
            </>
          ) : null}
          {props.notBookedReason ? (
            <>
              <dt>Not booked</dt>
              <dd>{props.notBookedReason}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {props.callout}
      <div className="req-details-pets">{props.pets}</div>

      <label className="req-details-notes-label">
        Notes
        <span className={`req-details-save req-details-save--${saveState}`} aria-live="polite">
          {saveState === 'saving'
            ? 'Saving…'
            : saveState === 'saved'
              ? 'Saved'
              : saveState === 'error'
                ? 'Not saved, try again'
                : ''}
        </span>
        <textarea
          className="req-details-notes"
          rows={2}
          value={notes}
          disabled={props.notesDisabled}
          placeholder="Notes for the team (saved automatically)"
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            if (timer.current) clearTimeout(timer.current);
            void save(notes);
          }}
        />
      </label>

      <div className="req-details-links">
        <button
          type="button"
          className="req-details-link"
          onClick={() => setShowFull((v) => !v)}
          aria-expanded={showFull}
        >
          {showFull ? 'Hide full request' : 'View full request'}
        </button>
        {props.pdfLink}
      </div>
      {showFull ? <div className="req-details-full">{props.fullRequest}</div> : null}
    </section>
  );
}
