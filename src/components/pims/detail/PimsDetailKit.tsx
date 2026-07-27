import { useCallback, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Pencil } from 'lucide-react';
import './PimsDetailKit.css';

/**
 * Shared building blocks for the client and patient detail views.
 *
 * Two ideas drive the layout. Records are edited one card at a time rather than through a
 * single page-wide form, because staff usually change one thing (a phone number, a weight)
 * and a whole-record form makes that a long scroll plus an all-fields write. And identifiers
 * that only matter when something has gone wrong — internal ids, PIMS keys, sync timestamps —
 * live in a collapsed panel instead of competing with the pet's name for attention.
 */

export type SelectOption = { value: string; label: string };

export type FieldSpec = {
  key: string;
  label: string;
  type?: 'text' | 'email' | 'tel' | 'date' | 'number' | 'textarea' | 'select';
  options?: SelectOption[];
  /** Span the full card width instead of one grid column. */
  full?: boolean;
  hint?: string;
  required?: boolean;
  placeholder?: string;
  /** Read-mode renderer. Defaults to the raw string, or an em dash when blank. */
  display?: (value: string) => ReactNode;
  /**
   * Replaces the default control. Receives the whole draft so dependent pickers work —
   * a breed list, for example, has to narrow itself to the species chosen in the same card.
   */
  renderInput?: (args: {
    value: string;
    onChange: (next: string) => void;
    setValue: (key: string, next: string) => void;
    values: CardValues;
    id: string;
  }) => ReactNode;
};

export type BadgeTone = 'ok' | 'danger' | 'warn' | 'muted' | 'info';

export function PimsBadge({
  tone = 'muted',
  title,
  children,
}: {
  tone?: BadgeTone;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span className={`pims-detail__badge pims-detail__badge--${tone}`} title={title}>
      {children}
    </span>
  );
}

/**
 * Identity header. Everything above the fold that staff read while on the phone: who this is,
 * the one-line summary, how to reach them, and the actions that change the record.
 */
export function DetailHeader({
  avatar,
  title,
  badges,
  summary,
  reach,
  stat,
  actions,
}: {
  avatar?: ReactNode;
  title: ReactNode;
  badges?: ReactNode;
  /** The clinical/contact one-liner directly under the name. */
  summary?: ReactNode;
  /** Contact affordances — phone, email, address. */
  reach?: ReactNode;
  /** A single prominent figure, right-aligned. */
  stat?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="pims-detail__header">
      {avatar}
      <div className="pims-detail__header-main">
        <div className="pims-detail__title-row">
          <h1 className="pims-detail__title">{title}</h1>
          {badges}
        </div>
        {summary ? <p className="pims-detail__signalment">{summary}</p> : null}
        {reach ? <ul className="pims-detail__reach">{reach}</ul> : null}
      </div>
      {stat || actions ? (
        <div className="pims-detail__header-side">
          {stat}
          {actions ? <div className="pims-detail__header-actions">{actions}</div> : null}
        </div>
      ) : null}
    </header>
  );
}

/** A labelled value. Blank values collapse to a muted em dash so rows stay scannable. */
export function Fact({ label, children }: { label: string; children?: ReactNode }) {
  const blank =
    children == null ||
    children === '' ||
    (typeof children === 'string' && !children.trim());
  return (
    <div className="pims-detail__fact">
      <dt>{label}</dt>
      <dd className={blank ? 'pims-detail__fact-empty' : undefined}>{blank ? '—' : children}</dd>
    </div>
  );
}

export function FactGrid({
  rows,
  columns = 2,
}: {
  rows: { label: string; value: ReactNode }[];
  columns?: 1 | 2 | 3;
}) {
  return (
    <dl className={`pims-detail__facts pims-detail__facts--${columns}`}>
      {rows.map((r, i) => (
        <Fact key={`${r.label}-${i}`} label={r.label}>
          {r.value}
        </Fact>
      ))}
    </dl>
  );
}

/** Safety information. Rendered as an assertive banner because it changes how staff handle the animal. */
export function AlertBanner({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="pims-detail__alert" role="alert">
      {icon ? <span className="pims-detail__alert-icon">{icon}</span> : null}
      <div className="pims-detail__alert-body">{children}</div>
    </div>
  );
}

export function Card({
  title,
  icon,
  actions,
  children,
  padded = true,
  className,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  padded?: boolean;
  className?: string;
}) {
  return (
    <section className={['pims-detail__card', className].filter(Boolean).join(' ')}>
      {title != null || actions ? (
        <header className="pims-detail__card-head">
          <h3 className="pims-detail__card-title">
            {icon ? <span className="pims-detail__card-icon">{icon}</span> : null}
            {title}
          </h3>
          {actions ? <div className="pims-detail__card-actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className={padded ? 'pims-detail__card-body' : undefined}>{children}</div>
    </section>
  );
}

function FieldControl({
  field,
  value,
  onChange,
  setValue,
  values,
}: {
  field: FieldSpec;
  value: string;
  onChange: (next: string) => void;
  setValue: (key: string, next: string) => void;
  values: CardValues;
}) {
  const id = `pims-field-${field.key}`;
  if (field.renderInput) {
    return <>{field.renderInput({ value, onChange, setValue, values, id })}</>;
  }

  if (field.type === 'textarea') {
    return (
      <textarea
        id={id}
        className="input pims-detail__textarea"
        rows={4}
        value={value}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (field.type === 'select') {
    return (
      <select
        id={id}
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {(field.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      id={id}
      className="input"
      type={field.type === 'number' ? 'text' : (field.type ?? 'text')}
      inputMode={field.type === 'number' ? 'decimal' : undefined}
      value={value}
      placeholder={field.placeholder}
      required={field.required}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export type CardValues = Record<string, string>;

/**
 * A card that flips between reading and editing its own fields, and writes only those fields.
 *
 * Scoping the write to one card means a failed save can't lose edits elsewhere on the page, and
 * omitted fields keep their stored value because the API applies keys individually.
 */
export function EditableCard({
  title,
  icon,
  fields,
  values,
  onSave,
  editable = true,
  columns = 2,
  footer,
  children,
  emptyHint,
}: {
  title: ReactNode;
  icon?: ReactNode;
  fields: FieldSpec[];
  values: CardValues;
  onSave: (next: CardValues) => Promise<void>;
  editable?: boolean;
  columns?: 1 | 2 | 3;
  /** Rendered below the fields in both modes. */
  footer?: ReactNode;
  /** Rendered below the fields in read mode only. */
  children?: ReactNode;
  /** Shown in read mode when every field is blank. */
  emptyHint?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CardValues>(values);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const begin = useCallback(() => {
    setDraft(values);
    setError(null);
    setEditing(true);
  }, [values]);

  const cancel = useCallback(() => {
    setEditing(false);
    setError(null);
  }, []);

  const setField = useCallback((key: string, next: string) => {
    setDraft((d) => ({ ...d, [key]: next }));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const missing = fields.find((f) => f.required && !(draft[f.key] ?? '').trim());
    if (missing) {
      setError(`${missing.label} is required.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (err) {
      const e2 = err as { response?: { data?: { message?: string } }; message?: string };
      setError(e2?.response?.data?.message ?? e2?.message ?? 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    const allBlank = fields.every((f) => !(values[f.key] ?? '').trim());
    return (
      <Card
        title={title}
        icon={icon}
        actions={
          editable ? (
            <button type="button" className="pims-detail__btn-quiet" onClick={begin}>
              <Pencil size={14} aria-hidden />
              Edit
            </button>
          ) : null
        }
      >
        {allBlank && emptyHint ? (
          <p className="pims-detail__muted">{emptyHint}</p>
        ) : (
          <dl className={`pims-detail__facts pims-detail__facts--${columns}`}>
            {fields.map((f) => {
              const raw = values[f.key] ?? '';
              return (
                <div
                  key={f.key}
                  className={['pims-detail__fact', f.full ? 'pims-detail__fact--full' : '']
                    .filter(Boolean)
                    .join(' ')}
                >
                  <dt>{f.label}</dt>
                  <dd className={!raw.trim() ? 'pims-detail__fact-empty' : undefined}>
                    {raw.trim() ? (f.display ? f.display(raw) : raw) : '—'}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
        {children}
        {footer}
      </Card>
    );
  }

  return (
    <Card title={title} icon={icon}>
      <form onSubmit={submit}>
        {error ? (
          <p className="pims-detail__form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className={`pims-detail__field-grid pims-detail__field-grid--${columns}`}>
          {fields.map((f) => (
            <div
              key={f.key}
              className={[
                'pims-detail__field',
                f.full ? 'pims-detail__field--full' : '',
                f.type === 'textarea' ? 'pims-detail__field--full' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <label className="pims-detail__field-label" htmlFor={`pims-field-${f.key}`}>
                {f.label}
                {f.required ? <span aria-hidden> *</span> : null}
              </label>
              <FieldControl
                field={f}
                value={draft[f.key] ?? ''}
                onChange={(v) => setField(f.key, v)}
                setValue={setField}
                values={draft}
              />
              {f.hint ? <p className="pims-detail__field-hint">{f.hint}</p> : null}
            </div>
          ))}
        </div>
        {footer}
        <div className="pims-detail__form-actions">
          <button
            type="button"
            className="pims-detail__btn-secondary"
            onClick={cancel}
            disabled={saving}
          >
            Cancel
          </button>
          <button type="submit" className="pims-detail__btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Card>
  );
}

/**
 * Internal ids, PIMS keys and sync timestamps. Collapsed by default: staff only need these
 * when reconciling a record against eVet, but then they need all of them at once.
 */
export function TechnicalDetails({
  rows,
  note,
}: {
  rows: { label: string; value: ReactNode }[];
  note?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="pims-detail__card pims-detail__tech">
      <button
        type="button"
        className="pims-detail__tech-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
        Record &amp; sync details
      </button>
      {open ? (
        <div className="pims-detail__card-body">
          {note ? <p className="pims-detail__muted pims-detail__tech-note">{note}</p> : null}
          <FactGrid rows={rows} columns={2} />
        </div>
      ) : null}
    </section>
  );
}

/** A collapsible section for long lists (invoices, appointments) that shouldn't always be open. */
export function CollapsibleCard({
  title,
  icon,
  count,
  defaultOpen = true,
  actions,
  children,
}: {
  title: string;
  icon?: ReactNode;
  count?: number;
  defaultOpen?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="pims-detail__card">
      <header className="pims-detail__card-head">
        <button
          type="button"
          className="pims-detail__collapse-toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
          {icon ? <span className="pims-detail__card-icon">{icon}</span> : null}
          {title}
          {count != null ? <span className="pims-detail__count">{count}</span> : null}
        </button>
        {actions ? <div className="pims-detail__card-actions">{actions}</div> : null}
      </header>
      {open ? <div className="pims-detail__card-body">{children}</div> : null}
    </section>
  );
}
