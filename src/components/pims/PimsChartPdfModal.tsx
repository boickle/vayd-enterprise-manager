import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import { downloadBlobUrl, fetchPatientChartDocumentFile } from '../../api/patients';
import './PimsChartPdfModal.css';

type Props = {
  patientId: number;
  documentId: number;
  title: string;
  filename?: string;
  onClose: () => void;
};

function downloadName(title: string, filename?: string): string {
  if (filename?.trim()) return filename.trim();
  const base = title.replace(/[^\w\s.-]+/g, '').replace(/\s+/g, ' ').trim() || 'document';
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}

export function PimsChartPdfModal({
  patientId,
  documentId,
  title,
  filename,
  onClose,
}: Props) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [savedName, setSavedName] = useState(downloadName(title, filename));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setLoading(true);
    setError(null);
    void fetchPatientChartDocumentFile(patientId, documentId, downloadName(title, filename))
      .then((file) => {
        if (cancelled) {
          URL.revokeObjectURL(file.objectUrl);
          return;
        }
        url = file.objectUrl;
        setObjectUrl(file.objectUrl);
        setSavedName(file.filename);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not open that PDF.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [patientId, documentId, title, filename]);

  const modal = (
    <div className="pims-chart-pdf" role="dialog" aria-modal aria-labelledby="pims-chart-pdf-title">
      <button
        type="button"
        className="pims-chart-pdf__backdrop"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="pims-chart-pdf__card">
        <div className="pims-chart-pdf__toolbar">
          <h2 id="pims-chart-pdf-title" className="pims-chart-pdf__title">
            {title}
          </h2>
          <button
            type="button"
            className="pims-chart-pdf__icon-btn"
            title="Close"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="pims-chart-pdf__body">
          {loading ? <p className="pims-chart-pdf__status">Loading PDF…</p> : null}
          {error ? <p className="pims-chart-pdf__error">{error}</p> : null}
          {objectUrl && !error ? (
            <iframe
              className="pims-chart-pdf__frame"
              title={title}
              src={objectUrl}
            />
          ) : null}
        </div>
        <div className="pims-chart-pdf__footer">
          <button type="button" className="pims-chart-pdf__btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="pims-chart-pdf__btn pims-chart-pdf__btn--primary"
            disabled={!objectUrl}
            onClick={() => {
              if (objectUrl) downloadBlobUrl(objectUrl, savedName);
            }}
          >
            <Download size={15} aria-hidden />
            Download
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
