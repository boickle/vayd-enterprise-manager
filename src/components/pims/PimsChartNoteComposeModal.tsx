import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Lock, X } from 'lucide-react';
import {
  createScoutChartNote,
  finalizeScoutChartNote,
  listScoutChartNotes,
  updateScoutChartNote,
  type ScoutChartNote,
} from '../../api/scoutChart';

type Props = {
  patientId: number;
  clientId: number | null;
  patientName: string;
  onClose: () => void;
  onWrappedUp: () => void;
};

export function PimsChartNoteComposeModal({
  patientId,
  clientId,
  patientName,
  onClose,
  onWrappedUp,
}: Props) {
  const [note, setNote] = useState<ScoutChartNote | null>(null);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [wrapping, setWrapping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const noteIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const drafts = await listScoutChartNotes(patientId, 'draft');
        if (cancelled) return;
        const existing = drafts[0] ?? null;
        if (existing) {
          setNote(existing);
          setBody(existing.body);
          noteIdRef.current = existing.id;
        } else {
          const created = await createScoutChartNote({
            patientId,
            clientId,
            body: '',
          });
          if (cancelled) return;
          setNote(created);
          setBody(created.body);
          noteIdRef.current = created.id;
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not open a medical note.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId, clientId]);

  useEffect(() => {
    if (!note || note.status !== 'draft') return;
    const handle = window.setTimeout(() => {
      if (body === note.body) return;
      setSaving(true);
      void updateScoutChartNote(note.id, body)
        .then((saved) => {
          setNote(saved);
          noteIdRef.current = saved.id;
        })
        .catch(() => {
          /* keep typing; wrap-up will surface the error */
        })
        .finally(() => setSaving(false));
    }, 800);
    return () => window.clearTimeout(handle);
  }, [body, note]);

  async function wrapUp() {
    const id = noteIdRef.current;
    if (!id || wrapping) return;
    if (!body.trim()) {
      setError('Write the note before wrapping up.');
      return;
    }
    setWrapping(true);
    setError(null);
    try {
      if (note && body !== note.body) {
        await updateScoutChartNote(id, body);
      }
      await finalizeScoutChartNote(id);
      onWrappedUp();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not wrap up this note.');
    } finally {
      setWrapping(false);
    }
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="pims-chart-pick" role="dialog" aria-modal="true" aria-labelledby="pims-chart-note-title">
      <button type="button" className="pims-chart-pick__backdrop" aria-label="Close" onClick={onClose} />
      <div className="pims-chart-pick__card pims-chart-compose">
        <div className="pims-chart-pick__head">
          <div>
            <h3 id="pims-chart-note-title">Medical note · {patientName}</h3>
            <p className="pims-chart-compose__hint">
              Blank note. Wrap up to lock it on the chart — it cannot be edited after that.
            </p>
          </div>
          <button type="button" className="pims-chart-pick__close" onClick={onClose}>
            <X size={16} aria-hidden />
          </button>
        </div>
        {error ? <p className="pims-chart-compose__error">{error}</p> : null}
        {loading ? (
          <p className="pims-chart-compose__hint">Opening note…</p>
        ) : (
          <textarea
            className="pims-chart-compose__textarea"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write the note…"
            autoFocus
            rows={12}
          />
        )}
        <div className="pims-chart-pick__foot pims-chart-compose__foot">
          <span className="pims-chart-compose__meta">
            {saving ? 'Saving draft…' : note ? 'Draft saved' : ''}
          </span>
          <button type="button" className="brief-btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="brief-btn primary"
            disabled={wrapping || loading || !body.trim()}
            onClick={() => void wrapUp()}
          >
            <Lock size={14} aria-hidden />
            {wrapping ? 'Wrapping up…' : 'Wrap up'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
