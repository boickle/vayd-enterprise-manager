import { useEffect, useRef, useState } from 'react';
import { FilePlus2, Lock } from 'lucide-react';
import {
  createSoapAddendum,
  listSoapAddenda,
  type SoapAddendum,
} from '../../api/visitWorkflow';
import './SoapAddendaSection.css';

type Props = {
  encounterId: string;
  /** When true, open the composer (e.g. header "Write addendum" scrolled here). */
  writing: boolean;
  onWritingChange: (writing: boolean) => void;
  /** Scroll this section into view when the composer opens (SOAP page only). */
  scrollIntoViewOnWrite?: boolean;
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * Append-only clinical addenda for a signed & locked SOAP.
 *
 * Rendered at the bottom of the SOAP note (where addenda chronologically belong)
 * and inside the patient chart's SOAP note modal. The SOAP page header's
 * "Write addendum" button opens this composer via `writing`.
 */
export default function SoapAddendaSection({
  encounterId,
  writing,
  onWritingChange,
  scrollIntoViewOnWrite = false,
}: Props) {
  const [addenda, setAddenda] = useState<SoapAddendum[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    void listSoapAddenda(encounterId)
      .then((rows) => {
        if (!canceled) setAddenda(rows);
      })
      .catch((e) => {
        if (!canceled) {
          setError(e instanceof Error ? e.message : 'Could not load addenda.');
        }
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [encounterId]);

  useEffect(() => {
    if (!writing) return;
    if (scrollIntoViewOnWrite) {
      sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    // Focus after any scroll settles a beat.
    const t = window.setTimeout(() => textareaRef.current?.focus(), 280);
    return () => window.clearTimeout(t);
  }, [writing, scrollIntoViewOnWrite]);

  const save = async () => {
    const body = draft.trim();
    if (!body) {
      setError('Addendum text is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await createSoapAddendum(encounterId, body);
      setAddenda((prev) => [...prev, saved]);
      setDraft('');
      onWritingChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save addendum.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section ref={sectionRef} className="soap-addenda" aria-label="SOAP addenda">
      <div className="soap-addenda__head">
        <span className="soap-addenda__title">
          <Lock size={14} /> Addenda
        </span>
        {!writing && (
          <button
            type="button"
            className="soap-addenda__btn"
            onClick={() => onWritingChange(true)}
          >
            <FilePlus2 size={13} /> Write addendum
          </button>
        )}
      </div>

      <p className="soap-addenda__hint">
        The signed SOAP stays locked. Addenda append a dated note without changing
        Subjective, Objective, Assessment, or Plan.
      </p>

      {loading && <p className="soap-addenda__muted">Loading addenda…</p>}

      {!loading && addenda.length === 0 && !writing && (
        <p className="soap-addenda__muted">No addenda yet.</p>
      )}

      {addenda.length > 0 && (
        <ul className="soap-addenda__list">
          {addenda.map((a) => (
            <li key={a.id} className="soap-addenda__item">
              <div className="soap-addenda__meta">
                <span>{formatWhen(a.created)}</span>
                {a.createdByName && <span>· {a.createdByName}</span>}
              </div>
              <div className="soap-addenda__body">{a.body}</div>
            </li>
          ))}
        </ul>
      )}

      {writing && (
        <div className="soap-addenda__composer">
          <label className="soap-addenda__composer-label">
            New addendum
            <textarea
              ref={textareaRef}
              className="soap-addenda__textarea"
              rows={5}
              value={draft}
              disabled={saving}
              placeholder="Clarify findings, note a late lab result, correct a detail…"
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          {error && <p className="soap-addenda__error">{error}</p>}
          <div className="soap-addenda__composer-actions">
            <button
              type="button"
              className="soap-addenda__btn"
              disabled={saving}
              onClick={() => {
                setDraft('');
                setError(null);
                onWritingChange(false);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="soap-addenda__btn soap-addenda__btn--primary"
              disabled={saving || !draft.trim()}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save addendum'}
            </button>
          </div>
        </div>
      )}

      {!writing && error && <p className="soap-addenda__error">{error}</p>}
    </section>
  );
}
