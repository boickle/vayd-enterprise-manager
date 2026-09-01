import { useRef, useState } from 'react';
import { AlertTriangle, FileSearch, Trash2, Upload } from 'lucide-react';
import { summarizeChartText } from '../../api/soapScribe';
import {
  deleteOutsideRecord,
  listOutsideRecords,
  saveOutsideRecord,
} from '../../utils/briefRecordStore';
import { extractTextFromUpload } from '../../utils/extractUploadText';

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
  patientId: string;
  patientName?: string | null;
};

export default function BriefRecordReview({ patientId, patientName }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState(() => listOutsideRecords(patientId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => setRows(listOutsideRecords(patientId));

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 15 * 1024 * 1024) {
          throw new Error(`${file.name} is larger than 15 MB.`);
        }
        const extracted = await extractTextFromUpload(file);
        if (!extracted.text.trim() && extracted.images.length === 0) {
          throw new Error(`Could not read text from ${file.name}.`);
        }
        const summary = await summarizeChartText({
          mode: 'outside-record',
          sourceText: extracted.text,
          images: extracted.images,
          patientName,
          fileName: file.name,
        });
        if (!summary.trim()) throw new Error(`No summary came back for ${file.name}.`);
        saveOutsideRecord({ patientId, fileName: file.name, summary });
      }
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not summarize that file.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="brief-review">
      <div className="brief-review__head">
        <FileSearch size={16} aria-hidden />
        <div>
          <h3>Record review{patientName ? ` · ${patientName}` : ''}</h3>
          <p>
            Upload previous records from another hospital. Each file is summarized so you can prep
            without reading the whole PDF.
          </p>
        </div>
      </div>

      <label className={`brief-upload${busy ? ' is-busy' : ''}`}>
        <Upload size={16} aria-hidden />
        {busy ? 'Summarizing…' : 'Upload previous records'}
        <input
          ref={inputRef}
          type="file"
          hidden
          multiple
          accept="application/pdf,image/*,text/plain,.txt,.md,.html"
          disabled={busy}
          onChange={(e) => void onFiles(e.currentTarget.files)}
        />
      </label>

      {error ? <p className="brief-error">{error}</p> : null}

      {rows.length === 0 && !busy ? (
        <p className="brief-muted">No uploaded records yet.</p>
      ) : null}

      {rows.map((row) => (
        <section key={row.id} className="brief-review__block">
          <div className="brief-review__block-head">
            <h4>{row.fileName}</h4>
            <button
              type="button"
              className="brief-text-btn"
              onClick={() => {
                deleteOutsideRecord(row.id);
                refresh();
              }}
            >
              <Trash2 size={13} aria-hidden /> Remove
            </button>
          </div>
          <p className="brief-muted">{formatWhen(row.uploadedAt)}</p>
          <pre className="brief-review__summary">{row.summary}</pre>
        </section>
      ))}

      <p className="brief-review__disclaimer">
        <AlertTriangle size={13} aria-hidden /> Summaries can miss details. Confirm important facts
        against the original file before acting.
      </p>
    </div>
  );
}
