import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, FileSearch, Trash2, Upload } from 'lucide-react';
import { createScoutChartNote, finalizeScoutChartNote } from '../../api/scoutChart';
import { uploadPatientChartDocument } from '../../api/patients';
import { fetchEmployee } from '../../api/appointmentSettings';
import { summarizeChartText } from '../../api/soapScribe';
import { useAuth } from '../../auth/useAuth';
import {
  clearOutsideRecordsForPatient,
  deleteOutsideRecord,
  peekOutsideRecordFile,
  saveOutsideRecord,
  takeOutsideRecordFile,
  type OutsideRecordAcceptResult,
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

function staffLabel(emp: {
  title?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  designation?: string | null;
  email?: string | null;
} | null): string | null {
  if (!emp) return null;
  const parts = [emp.title, emp.firstName, emp.lastName, emp.designation].filter(
    (p) => typeof p === 'string' && p.trim(),
  );
  const name = parts.join(' ').replace(/\s+/g, ' ').trim();
  return name || emp.email?.trim() || null;
}

/** Section titles like "Problems / diagnoses:" — not a bullet, not a long prose line. */
function isSummaryHeader(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('-') || trimmed.startsWith('•')) return false;
  return /^[A-Za-z][^:\n]{0,80}:\s*$/.test(trimmed);
}

function SummaryWithBoldHeaders({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="brief-review__summary">
      {lines.map((line, i) => {
        if (isSummaryHeader(line)) {
          return (
            <strong key={i} className="brief-review__summary-h">
              {line.trim()}
            </strong>
          );
        }
        const inline = line.match(/^([A-Za-z][^:\n]{0,80}:)(\s+.+)$/);
        if (inline && !line.trimStart().startsWith('-') && !line.trimStart().startsWith('•')) {
          return (
            <span key={i}>
              <strong>{inline[1]}</strong>
              {inline[2]}
              {i < lines.length - 1 ? '\n' : ''}
            </span>
          );
        }
        return (
          <span key={i}>
            {line}
            {i < lines.length - 1 ? '\n' : ''}
          </span>
        );
      })}
    </div>
  );
}

function AcceptRow({
  row,
  acceptingId,
  onAccept,
}: {
  row: OutsideRecordSummary;
  acceptingId: string | null;
  onAccept: (row: OutsideRecordSummary) => void;
}) {
  return (
    <div className="brief-review__accept">
      <button
        type="button"
        className="brief-btn primary"
        disabled={acceptingId != null}
        onClick={() => onAccept(row)}
      >
        <Check size={14} aria-hidden />
        {acceptingId === row.id ? 'Adding to record…' : 'Accept to medical record'}
      </button>
      <span className="brief-muted">
        Files the original and a summary note on the Timeline. Reminders and vaccines are left
        alone.
      </span>
    </div>
  );
}

type Props = {
  patientId: string;
  patientName?: string | null;
  clientId?: string | null;
  onAccepted?: (result?: OutsideRecordAcceptResult) => void;
  /** Set when the host already shows a title, so the heading isn't repeated. */
  hideHeading?: boolean;
};

export default function BriefRecordReview({
  patientId,
  patientName,
  clientId,
  onAccepted,
  hideHeading = false,
}: Props) {
  const { employeeId, userEmail } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<OutsideRecordSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [staffName, setStaffName] = useState<string | null>(null);

  useEffect(() => {
    clearOutsideRecordsForPatient(patientId);
    setRows([]);
  }, [patientId]);

  useEffect(() => {
    const id = Number(employeeId);
    if (!Number.isFinite(id) || id <= 0) {
      setStaffName(userEmail);
      return;
    }
    let cancelled = false;
    void fetchEmployee(id)
      .then((emp) => {
        if (!cancelled) setStaffName(staffLabel(emp) || userEmail);
      })
      .catch(() => {
        if (!cancelled) setStaffName(userEmail);
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId, userEmail]);

  const onFiles = async (files: FileList | File[] | null) => {
    if (!files?.length) return;
    setError(null);
    setFlash(null);
    const pid = Number(patientId);
    if (!Number.isFinite(pid) || pid <= 0) {
      setError('Could not resolve this patient.');
      return;
    }
    clearOutsideRecordsForPatient(patientId);
    setRows([]);
    setBusy(true);
    const failed: string[] = [];
    const next: OutsideRecordSummary[] = [];
    try {
      for (const file of Array.from(files)) {
        if (file.size > 15 * 1024 * 1024) {
          throw new Error(`${file.name} is larger than 15 MB.`);
        }
        try {
          const extracted = await extractTextFromUpload(file);
          if (!extracted.text.trim() && extracted.images.length === 0) {
            throw new Error('unreadable');
          }
          const summary = await summarizeChartText({
            mode: 'outside-record',
            sourceText: extracted.text,
            images: extracted.images,
            patientName,
            fileName: file.name,
          });
          if (!summary.trim()) throw new Error('empty summary');
          next.push(
            saveOutsideRecord({
              patientId,
              fileName: file.name,
              summary,
              file,
              uploadedByName: staffName,
            }),
          );
        } catch {
          failed.push(file.name);
        }
      }
      setRows(next);
      if (failed.length) {
        setError(`Couldn’t summarize ${failed.join(', ')}. Nothing was added to the medical record.`);
      } else {
        setFlash('Summary ready. Nothing is on the medical record until you accept.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file.');
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
    const file = peekOutsideRecordFile(row.id);
    if (!file && !row.chartDocumentId) {
      setError(
        'The original file is only held until you accept. Upload it again, then accept.',
      );
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
      let chartDocumentId = row.chartDocumentId ?? null;
      const pendingFile = takeOutsideRecordFile(row.id);
      if (pendingFile) {
        const doc = await uploadPatientChartDocument(pid, pendingFile, {
          documentType: 'previousRecords',
        });
        const docId = Number(doc?.id);
        chartDocumentId = Number.isFinite(docId) && docId > 0 ? docId : chartDocumentId;
      }
      const who = row.uploadedByName?.trim() || staffName;
      const directed = who
        ? `Uploaded and summarized by ${who} · ${formatWhen(row.uploadedAt)}`
        : `Summarized ${formatWhen(row.uploadedAt)}`;
      const body = `Previous records summary · ${row.fileName}\n${directed}\n\n${row.summary.trim()}`;
      const draft = await createScoutChartNote({
        patientId: pid,
        clientId: cid,
        body,
      });
      const finalized = await finalizeScoutChartNote(draft.id);
      deleteOutsideRecord(row.id);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      setFlash(`Accepted “${row.fileName}” onto the medical record.`);
      onAccepted?.({
        chartDocumentId,
        scoutNoteId: finalized?.id ?? draft.id,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that summary to the record.');
    } finally {
      setAcceptingId(null);
    }
  };

  const disabled = busy || acceptingId != null;

  return (
    <div className="brief-review">
      <div className="brief-review__head">
        <FileSearch size={16} aria-hidden />
        <div>
          {hideHeading ? null : (
            <h3>Upload file{patientName ? ` · ${patientName}` : ''}</h3>
          )}
          <p>
            Upload previous records from another hospital. The file and summary stay here until you
            accept — then the original is filed under Documents and a note is added to the Timeline.
          </p>
        </div>
      </div>

      <label
        className={`brief-upload${busy ? ' is-busy' : ''}${dragOver ? ' is-drop' : ''}`}
        onDragEnter={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (disabled) return;
          void onFiles(e.dataTransfer.files);
        }}
      >
        <Upload size={16} aria-hidden />
        <span>
          {busy ? 'Summarizing…' : dragOver ? 'Drop to upload' : 'Upload File'}
          {!busy ? <em> or drag a file here</em> : null}
        </span>
        <input
          ref={inputRef}
          type="file"
          hidden
          multiple
          accept="application/pdf,image/*,text/plain,.txt,.md,.html"
          disabled={disabled}
          onChange={(e) => void onFiles(e.currentTarget.files)}
        />
      </label>

      {error ? <p className="brief-error">{error}</p> : null}
      {flash ? <p className="brief-muted">{flash}</p> : null}

      {rows.length === 0 && !busy ? (
        <p className="brief-muted">
          Choose or drop a file to start a new summary. Nothing is added to the medical record
          until you accept.
        </p>
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
                setRows((prev) => prev.filter((r) => r.id !== row.id));
              }}
            >
              <Trash2 size={13} aria-hidden /> Discard summary
            </button>
          </div>
          <p className="brief-muted">
            {formatWhen(row.uploadedAt)} · pending accept
            {row.uploadedByName || staffName
              ? ` · uploaded and summarized by ${row.uploadedByName || staffName}`
              : ''}
            {peekOutsideRecordFile(row.id) ? ' · original held until you accept' : ''}
          </p>
          <AcceptRow row={row} acceptingId={acceptingId} onAccept={(r) => void acceptToRecord(r)} />
          <SummaryWithBoldHeaders text={row.summary} />
          <AcceptRow row={row} acceptingId={acceptingId} onAccept={(r) => void acceptToRecord(r)} />
        </section>
      ))}

      <p className="brief-review__disclaimer">
        <AlertTriangle size={13} aria-hidden /> Summaries can miss details. Confirm important facts
        against the original file before accepting.
      </p>
    </div>
  );
}
