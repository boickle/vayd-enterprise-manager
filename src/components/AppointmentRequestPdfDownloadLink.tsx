import { useCallback, useState } from 'react';
import { downloadAppointmentRequestSubmissionPdf } from '../api/appointmentRequestSubmissions';

type Props = {
  submissionId: number;
  clientLabel?: string | null;
};

export function AppointmentRequestPdfDownloadLink({ submissionId, clientLabel }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await downloadAppointmentRequestSubmissionPdf(submissionId, clientLabel);
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { message?: string } }; message?: string };
      setError(ax?.response?.data?.message ?? ax?.message ?? 'Could not download PDF.');
    } finally {
      setBusy(false);
    }
  }, [busy, submissionId, clientLabel]);

  return (
    <span className="appt-request-pdf-download-wrap">
      <button
        type="button"
        className="appt-request-pdf-download"
        disabled={busy}
        onClick={() => void handleDownload()}
      >
        {busy ? 'Downloading…' : 'Download PDF'}
      </button>
      {error ? (
        <span className="appt-request-pdf-download-error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
