import { useRef, useState } from 'react';
import { AlertTriangle, Check, FileSearch, Trash2, Upload } from 'lucide-react';
import { createScoutChartNote, finalizeScoutChartNote } from '../../api/scoutChart';
import { summarizeChartText } from '../../api/soapScribe';
import {
  deleteOutsideRecord,
  listOutsideRecords,
  saveOutsideRecord,
  type OutsideRecordSummary,
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
  clientId?: string | null;
  onAccepted?: () => void;
};

export default function BriefRecordReview({
  patientId,
  patientName,
  clientId,
  onAccepted,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState(() => listOutsideRecords(patientId));
  const [busy, setBusy] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const refresh = () => setRows(listOutsideRecords(patientId));

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    setFlash(null);
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
      setFlash('Summary ready — review it, then accept to add it to the medical record.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not summarize that file.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const acceptToRecord = async (row: OutsideRecordSummary) => {
    const pid = Number(patientId);
    if (!Number.isFinite(pid) || pid <= 0) {
      setError('Could not resolve this patient.');
      return;
    }
    setAcceptingId(row.id);
    setError(null);
    setFlash(null);
    try {
      const cid =
        clientId != null && Number.isFinite(Number(clientId)) && Number(clientId) > 0
          ? Number(clientId)
          : null;
      const body = `Previous records summary · ${row.fileName}\n\n${row.summary.trim()}`;
      const draft = await createScoutChartNote({
        patientId: pid,
        clientId: cid,
        body,
      });
      await finalizeScoutChartNote(draft.id);
      deleteOutsideRecord(row.id);
      refresh();
      setFlash(`Accepted “${row.fileName}” onto the medical record.`);
      onAccepted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that summary to the record.');
    } finally {
      setAcceptingId(null);
    }
  };

  return (
    <div className="brief-review">
      <div className="brief-review__head">
        <FileSearch size={16} aria-hidden />
        <div>
          <h3>Upload file{patientName ? ` · ${patientName}` : ''}</h3>
          <p>
            Upload previous records from another hospital. We summarize the file; you review and
            accept to place it on this pet’s medical record (Timeline).
          </p>
        </div>
      </div>

      <label className={`brief-upload${busy ? ' is-busy' : ''}`}>
        <Upload size={16} aria-hidden />
        {busy ? 'Summarizing…' : 'Upload File'}
        <input
          ref={inputRef}
          type="file"
          hidden
          multiple
          accept="application/pdf,image/*,text/plain,.txt,.md,.html"
          disabled={busy || acceptingId != null}
          onChange={(e) => void onFiles(e.currentTarget.files)}
        />
      </label>

      {error ? <p className="brief-error">{error}</p> : null}
      {flash ? <p className="brief-muted">{flash}</p> : null}

      {rows.length === 0 && !busy ? (
        <p className="brief-muted">No pending uploads. Accepted summaries live on the Timeline.</p>
      ) : null}

      {rows.map((row) => (
        <section key={row.id} className="brief-review__block">
          <div className="brief-review__block-head">
            <h4>{row.fileName}</h4>
            <button
              type="button"
              className="brief-text-btn"
              disabled={acceptingId != null}
              onClick={() => {
                deleteOutsideRecord(row.id);
                refresh();
              }}
            >
              <Trash2 size={13} aria-hidden /> Discard
            </button>
          </div>
          <p className="brief-muted">{formatWhen(row.uploadedAt)} · pending accept</p>
          <pre className="brief-review__summary">{row.summary}</pre>
          <div className="pims-chart-pick__foot" style={{ marginTop: 10, justifyContent: 'flex-start' }}>
            <button
              type="button"
              className="brief-btn primary"
              disabled={acceptingId != null}
              onClick={() => void acceptToRecord(row)}
            >
              <Check size={14} aria-hidden />
              {acceptingId === row.id ? 'Adding to record…' : 'Accept to medical record'}
            </button>
          </div>
        </section>
      ))}

      <p className="brief-review__disclaimer">
        <AlertTriangle size={13} aria-hidden /> Summaries can miss details. Confirm important facts
        against the original file before accepting.
      </p>
    </div>
  );
}
