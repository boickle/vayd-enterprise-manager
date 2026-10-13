import { useEffect, useState } from 'react';
import { searchPatientsStaff } from '../api/patients';
import {
  fetchPatientRecordUploads,
  fetchSubmissionRecordUploads,
  linkRecordUploadToPatient,
  type ClientRecordUpload,
} from '../api/clientRecordUploads';
import './ClientUploadedRecordsList.css';

type Props = {
  submissionId?: number;
  patientId?: number;
  practiceId?: number;
  /** Show a search box so staff can attach an unlinked file to a chart. */
  allowAttach?: boolean;
  /** Client said they would upload, even if no files arrived. */
  expectedUpload?: boolean;
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ClientUploadedRecordsList({
  submissionId,
  patientId,
  practiceId,
  allowAttach = false,
  expectedUpload = false,
}: Props) {
  const [items, setItems] = useState<ClientRecordUpload[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [activeUploadId, setActiveUploadId] = useState<number | null>(null);
  const [results, setResults] = useState<Array<{ id: number; label: string }>>([]);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const rows =
          submissionId != null
            ? await fetchSubmissionRecordUploads(submissionId)
            : patientId != null
              ? await fetchPatientRecordUploads(patientId)
              : [];
        if (!cancelled) {
          setItems(rows);
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setItems([]);
          setError('Records could not be loaded.');
        }
      }
    };
    if (submissionId == null && patientId == null) return;
    void load();
    return () => {
      cancelled = true;
    };
  }, [submissionId, patientId]);

  useEffect(() => {
    if (!allowAttach || activeUploadId == null) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchPatientsStaff(trimmed, {
        practiceId,
        activeOnly: true,
      })
        .then((rows) => {
          if (cancelled) return;
          setResults(
            rows.slice(0, 8).flatMap((row) => {
              const id = Number(row.id);
              if (!Number.isFinite(id) || id <= 0) return [];
              return [{ id, label: String(row.name ?? 'Patient') }];
            }),
          );
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeUploadId, allowAttach, practiceId, query]);

  if (submissionId == null && patientId == null) return null;
  if (items == null && !error) {
    if (submissionId == null) return null;
    return <p className="client-uploaded-records__muted">Loading uploaded records…</p>;
  }
  if (submissionId == null && (error || !items || items.length === 0)) return null;
  if ((!items || items.length === 0) && !expectedUpload && !error) return null;

  const attach = async (uploadId: number, nextPatientId: number) => {
    if (submissionId == null) return;
    setLinking(true);
    setError(null);
    try {
      const updated = await linkRecordUploadToPatient(submissionId, uploadId, nextPatientId);
      setItems((current) =>
        (current ?? []).map((item) => (item.id === uploadId ? updated : item)),
      );
      setActiveUploadId(null);
      setQuery('');
      setResults([]);
    } catch {
      setError('Could not attach that file to the patient.');
    } finally {
      setLinking(false);
    }
  };

  return (
    <section className="client-uploaded-records appt-request-detail-card">
      <h4 className="client-uploaded-records__title">Client-uploaded records</h4>
      {error ? <p className="client-uploaded-records__error">{error}</p> : null}
      {items && items.length === 0 ? (
        <p className="client-uploaded-records__muted">
          The client chose to upload records, but no files arrived.
        </p>
      ) : (
        <ul className="client-uploaded-records__list">
          {(items ?? []).map((item) => {
            const isImage = item.contentType.startsWith('image/') && item.contentType !== 'image/heic';
            return (
              <li key={item.id} className="client-uploaded-records__item">
                {isImage ? (
                  <img src={item.url} alt="" className="client-uploaded-records__preview" />
                ) : null}
                <div className="client-uploaded-records__meta">
                  <div className="client-uploaded-records__name">{item.originalFilename}</div>
                  <div className="client-uploaded-records__sub">
                    {item.petName} · {formatBytes(item.byteSize)}
                    {item.patientId != null ? ' · On patient chart' : ''}
                  </div>
                </div>
                <a
                  className="client-uploaded-records__open"
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open
                </a>
                {allowAttach && submissionId != null && item.patientId == null ? (
                  <div className="client-uploaded-records__attach">
                    {activeUploadId === item.id ? (
                      <>
                        <input
                          value={query}
                          placeholder="Search patient name"
                          onChange={(e) => setQuery(e.target.value)}
                          disabled={linking}
                        />
                        {results.length > 0 ? (
                          <ul className="client-uploaded-records__results">
                            {results.map((result) => (
                              <li key={result.id}>
                                <button
                                  type="button"
                                  disabled={linking}
                                  onClick={() => void attach(item.id, result.id)}
                                >
                                  {result.label}
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </>
                    ) : (
                      <button
                        type="button"
                        className="client-uploaded-records__open"
                        onClick={() => {
                          setActiveUploadId(item.id);
                          setQuery('');
                          setResults([]);
                        }}
                      >
                        Attach to patient
                      </button>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
