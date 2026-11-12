import { useEffect, useState } from 'react';
import { FilePlus2 } from 'lucide-react';
import {
  createScoutChartNoteAddendum,
  listScoutChartNoteAddenda,
  type ScoutChartNoteAddendum,
} from '../../api/scoutChart';

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

type Props = {
  noteId: string;
};

export default function ScoutNoteAddenda({ noteId }: Props) {
  const [rows, setRows] = useState<ScoutChartNoteAddendum[]>([]);
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listScoutChartNoteAddenda(noteId)
      .then((list) => {
        if (!cancelled) setRows(list);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  const save = async () => {
    const body = draft.trim();
    if (!body || saving) return;
    setSaving(true);
    setError(null);
    try {
      const row = await createScoutChartNoteAddendum(noteId, body);
      setRows((prev) => [...prev, row]);
      setDraft('');
      setWriting(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that addendum.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pims-note-addenda" onClick={(e) => e.stopPropagation()}>
      <div className="pims-note-addenda__head">
        <strong>Addenda</strong>
        {!writing ? (
          <button
            type="button"
            className="pims-patient-detail__pdf-btn"
            onClick={() => setWriting(true)}
          >
            <FilePlus2 size={13} aria-hidden /> Write addendum
          </button>
        ) : null}
      </div>
      <p className="pims-note-addenda__hint">
        The original note stays as written. Addenda append a dated clarification.
      </p>
      {rows.length === 0 && !writing ? (
        <p className="pims-patient-detail__muted">No addenda yet.</p>
      ) : null}
      {rows.map((row) => (
        <div key={row.id} className="pims-note-addenda__item">
          <p className="pims-note-addenda__meta">
            {formatWhen(row.created)}
            {row.createdByName ? ` · ${row.createdByName}` : ''}
          </p>
          <p className="pims-note-addenda__body">{row.body}</p>
        </div>
      ))}
      {writing ? (
        <div className="pims-note-addenda__composer">
          <textarea
            className="pims-note-addenda__textarea"
            rows={4}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What needs to be added or corrected?"
            disabled={saving}
          />
          {error ? <p className="pims-chart-confirm__error">{error}</p> : null}
          <div className="pims-patient-detail__expand-actions">
            <button
              type="button"
              className="brief-btn"
              disabled={saving}
              onClick={() => {
                setWriting(false);
                setDraft('');
                setError(null);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="brief-btn primary"
              disabled={saving || !draft.trim()}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save addendum'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
