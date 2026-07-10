import './ClientContactLogEditor.css';

type Props = {
  contextNote?: string | null;
  contextLabel?: string;
  value: string;
  onChange: (value: string) => void;
  onSave?: () => void;
  saving?: boolean;
  saveDisabled?: boolean;
  disabled?: boolean;
  error?: string | null;
  id?: string;
  rows?: number;
  placeholder?: string;
  hint?: string;
};

/** Shared contact log block — visit context (read-only) + editable staff contact history. */
export function ClientContactLogEditor({
  contextNote,
  contextLabel = 'Visit context',
  value,
  onChange,
  onSave,
  saving,
  saveDisabled,
  disabled,
  error,
  id,
  rows = 2,
  placeholder = 'e.g. LMOM 11/14 — client prefers afternoons',
  hint = 'Shared across care outreach, schedule loader, on hold, and the scheduler.',
}: Props) {
  const showSave = onSave != null;
  const inputId = id ?? 'client-contact-log';

  return (
    <div className="client-contact-log">
      {contextNote ? (
        <div className="client-contact-log__context">
          <span className="client-contact-log__label">{contextLabel}</span>
          <p className="client-contact-log__context-text">{contextNote}</p>
        </div>
      ) : null}
      <div className="client-contact-log__editor">
        <div className="client-contact-log__head">
          <label htmlFor={inputId} className="client-contact-log__label">
            Contact log
          </label>
          {showSave ? (
            <button
              type="button"
              className="btn secondary client-contact-log__save"
              disabled={disabled || saveDisabled || saving}
              onClick={onSave}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          ) : null}
        </div>
        {hint ? <p className="client-contact-log__hint">{hint}</p> : null}
        <textarea
          id={inputId}
          className="settings-input client-contact-log__textarea"
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled || saving}
          aria-label="Contact log"
        />
        {error ? <p className="client-contact-log__error">{error}</p> : null}
      </div>
    </div>
  );
}

/** Read-only merged contact log for scheduler / routing bars. */
export function ClientContactLogReadout({
  contextNote,
  contextLabel = 'Visit context',
  contactLog,
}: {
  contextNote?: string | null;
  contextLabel?: string;
  contactLog?: string | null;
}) {
  if (!contextNote && !contactLog) return null;
  return (
    <div className="client-contact-log-readout">
      {contextNote ? (
        <div className="client-contact-log-readout__line">
          <span className="client-contact-log-readout__label">{contextLabel}:</span>{' '}
          {contextNote}
        </div>
      ) : null}
      {contactLog ? (
        <div className="client-contact-log-readout__line">
          <span className="client-contact-log-readout__label">Contact log:</span> {contactLog}
        </div>
      ) : null}
    </div>
  );
}
