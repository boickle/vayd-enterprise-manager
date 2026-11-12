import { useEffect, useState } from 'react';
import {
  listLabResultsForLine,
  listPendingLabResults,
  type LabResult,
} from '../../api/inHouseLabs';
import InvoiceLineLabResults from '../labs/InvoiceLineLabResults';
import type { TaskDetail } from '../../api/tasks';
import { labInvoiceLineIdFromTask } from '../../utils/labResultTask';

type Props = {
  task: TaskDetail;
  patientName?: string | null;
  readOnly?: boolean;
  onUpdated: () => void;
};

function httpStatus(err: unknown): number | null {
  const status = (err as { response?: { status?: number } })?.response?.status;
  return typeof status === 'number' ? status : null;
}

/**
 * The charge is already on the bill. The work left is filling in the in-house
 * form that belongs to that line. Saving the last pending form closes the task.
 */
export default function LabResultTaskPanel({
  task,
  patientName,
  readOnly = false,
  onUpdated,
}: Props) {
  const lineId = labInvoiceLineIdFromTask(task);
  const patientId = task.links?.find((l) => l.entityType === 'patient')?.entityId ?? null;
  const [results, setResults] = useState<LabResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!lineId) {
      setResults([]);
      setError(null);
      return;
    }
    let canceled = false;
    setResults(null);
    setError(null);
    void (async () => {
      try {
        let rows: LabResult[];
        try {
          rows = await listLabResultsForLine(lineId);
        } catch (err) {
          if (httpStatus(err) !== 404 || patientId == null) throw err;
          const pending = await listPendingLabResults(patientId);
          rows = pending.filter((r) => r.visitInvoiceLineId === lineId);
        }
        if (!canceled) setResults(rows);
      } catch (err) {
        if (!canceled) {
          setResults([]);
          setError(err instanceof Error ? err.message : 'Could not load this lab.');
        }
      }
    })();
    return () => {
      canceled = true;
    };
  }, [lineId, patientId]);

  const who = patientName?.trim() || 'this patient';

  return (
    <section className="pims-fb-task" aria-label="Enter lab results">
      <p className="pims-fb-task__lead">
        Enter the in-house results for {who}. This task closes on its own once every
        form on the charge is saved.
      </p>
      {error ? (
        <p className="pims-fb-task__hint" role="alert">
          {error}
        </p>
      ) : null}
      {results == null ? (
        <p className="pims-fb-task__hint">Loading the lab form…</p>
      ) : results.length === 0 ? (
        <p className="pims-fb-task__hint">
          {lineId
            ? 'No lab form is attached to this charge anymore.'
            : 'This task is not tied to a lab charge.'}
        </p>
      ) : (
        <InvoiceLineLabResults
          results={results}
          readOnly={readOnly}
          onSaved={(saved) => {
            setResults((prev) =>
              (prev ?? []).map((row) => (row.id === saved.id ? saved : row)),
            );
            onUpdated();
          }}
        />
      )}
    </section>
  );
}
