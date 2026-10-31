import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  declinePublicRecordsRequest,
  getPublicRecordsRequestForm,
  submitPublicRecordsUpload,
  type PublicRecordsRequestForm,
} from '../api/recordsRequests';
import './EuthanasiaConsentForm.css';
import './RecordsUploadPage.css';

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 20;

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function axiosMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const response = (err as { response?: { data?: { message?: unknown } } }).response;
    const message = response?.data?.message;
    if (typeof message === 'string' && message.trim()) return message;
    if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  }
  return err instanceof Error ? err.message : '';
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="consent-page">
      <div className="consent-card">{children}</div>
    </div>
  );
}

function petLabel(form: PublicRecordsRequestForm): string {
  const detail = [form.species, form.breed].filter(Boolean).join(', ');
  return detail ? `${form.patientName} (${detail})` : form.patientName;
}

export default function RecordsUploadPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token')?.trim() || '';

  const [form, setForm] = useState<PublicRecordsRequestForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<'uploaded' | 'declined' | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setError('This records link is missing its token.');
      return;
    }
    let cancelled = false;
    void getPublicRecordsRequestForm(token)
      .then((payload) => {
        if (!cancelled) setForm(payload);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(axiosMessage(err) || 'This records link is not valid or has expired.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const pickFiles = (list: FileList | null | undefined) => {
    const picked = Array.from(list ?? []);
    if (!picked.length) return;
    const tooBig = picked.filter((f) => f.size > MAX_BYTES).map((f) => f.name);
    const next = [...files];
    for (const f of picked) {
      if (f.size > MAX_BYTES) continue;
      if (next.some((x) => x.name === f.name && x.size === f.size)) continue;
      next.push(f);
    }
    const capped = next.slice(0, MAX_FILES);
    setFiles(capped);
    if (tooBig.length) {
      setError(`Larger than 25 MB, not added: ${tooBig.join(', ')}. Please send smaller files.`);
    } else if (next.length > MAX_FILES) {
      setError(`Up to ${MAX_FILES} files can be sent at once.`);
    } else {
      setError(null);
    }
  };

  const upload = async () => {
    if (!files.length) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitPublicRecordsUpload({ token, files, note });
      setDone('uploaded');
    } catch (err) {
      setError(axiosMessage(err) || 'Could not upload that file. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const decline = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await declinePublicRecordsRequest({ token, note });
      setDone('declined');
    } catch (err) {
      setError(axiosMessage(err) || 'Could not send that reply. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Shell>
        <p className="consent-muted">Loading…</p>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <h1>Thank you</h1>
        <p className="consent-muted">
          {done === 'uploaded'
            ? 'The records are on their way to the patient’s chart. Nothing else is needed.'
            : 'Thanks for letting us know. We won’t ask again for this patient.'}
        </p>
      </Shell>
    );
  }

  if (!form) {
    return (
      <Shell>
        <h1>Records request</h1>
        <p className="consent-muted">{error || 'This records link is not valid.'}</p>
        <p className="consent-muted">
          You can reply to the request email with the records attached instead.
        </p>
      </Shell>
    );
  }

  if (form.alreadyReceived) {
    return (
      <Shell>
        <h1>Already received</h1>
        <p className="consent-muted">
          We already have records for {form.patientName} from this request. Thank you!
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1>Records request</h1>
      <p className="consent-muted">
        {form.practiceName} is caring for <strong>{petLabel(form)}</strong>
        {form.clientName ? `, owned by ${form.clientName}` : ''}, and would like a copy of
        their records from {form.hospitalName}.
      </p>
      {error ? <div className="consent-error">{error}</div> : null}

      <label
        className={`records-upload__drop${dragOver ? ' is-drop' : ''}`}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          pickFiles(e.dataTransfer.files);
        }}
      >
        <strong>
          {files.length ? 'Add more files' : 'Choose files or drag them here'}
        </strong>
        <span className="consent-muted">
          You can select several files at once. PDF works best; images and Word documents
          are fine too. Up to 25 MB each.
        </span>
        <input
          type="file"
          hidden
          multiple
          accept="application/pdf,image/*,text/plain,.doc,.docx"
          onChange={(e) => {
            pickFiles(e.currentTarget.files);
            e.currentTarget.value = '';
          }}
        />
      </label>

      {files.length ? (
        <ul className="records-upload__files">
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${i}`}>
              <span className="records-upload__file-name">{f.name}</span>
              <span className="consent-muted">{formatSize(f.size)}</span>
              <button
                type="button"
                className="records-upload__remove"
                disabled={submitting}
                aria-label={`Remove ${f.name}`}
                onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <label className="consent-field">
        Anything we should know? (optional)
        <textarea
          rows={3}
          value={note}
          placeholder="Handling notes, records sent separately, etc."
          onChange={(e) => setNote(e.target.value)}
        />
      </label>

      <div className="consent-actions">
        <button
          type="button"
          className="consent-btn ghost"
          disabled={submitting}
          onClick={() => void decline()}
        >
          We have no records for this patient
        </button>
        <button
          type="button"
          className="consent-btn"
          disabled={!files.length || submitting}
          onClick={() => void upload()}
        >
          {submitting
            ? 'Sending…'
            : files.length > 1
              ? `Send ${files.length} files`
              : 'Send records'}
        </button>
      </div>

      <p className="consent-muted records-upload__foot">
        This link is unique to this request and does not require an account. You can also
        reply to our email with the records attached.
      </p>
    </Shell>
  );
}
