import { useEffect, useState } from 'react';
import {
  getPatientRecordHistory,
  type RecordHistoryEntry,
} from '../../api/recordHistory';
import { usePermissions } from '../../permissions/PermissionContext';
import { historyTime } from './RecordHistoryLink';
import './RecordHistoryLink.css';

const KIND_LABEL: Record<string, string> = {
  prescription: 'Prescription',
  vaccination: 'Vaccine dose',
  lab_result: 'Lab result',
  encounter: 'Visit record',
  problem: 'Problem list',
  idexx_result: 'IDEXX result',
};

/**
 * Staff-only History for one pet (owner decision Nov 3, 2026): every logged step on the pet's
 * prescriptions, vaccine doses edited after sign-off and in-house lab results, and visits switched
 * between a medical note and a SOAP, and problems added, resolved or removed and eVet problem
 * suggestions accepted or dismissed (Nov 4, 2026), newest first.
 *
 * Renders nothing for anyone who is not signed in as staff. Never placed on the medical-record
 * print, records sent out, certificates, labels or the client portal, and hidden when printed.
 */
export default function PatientRecordHistoryPanel({
  patientId,
}: {
  patientId: string | number | null | undefined;
}) {
  const { effective } = usePermissions();
  const isStaff = Boolean(effective && (effective.employeeId != null || effective.isPlatformAdmin));
  const [entries, setEntries] = useState<RecordHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasPatient = patientId != null && patientId !== '';
  useEffect(() => {
    if (!isStaff || !hasPatient) return;
    let cancelled = false;
    setEntries(null);
    setError(null);
    getPatientRecordHistory(patientId!)
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the history.');
      });
    return () => {
      cancelled = true;
    };
  }, [isStaff, hasPatient, patientId]);

  if (!isStaff || !hasPatient) return null;

  return (
    <div className="record-history patient-record-history" role="region" aria-label="Pet record history">
      <p className="patient-record-history__note">
        Staff only. Who entered or changed prescriptions, vaccine doses after sign-off and lab
        results, and who switched a visit between a medical note and a SOAP. Not part of the
        medical record.
      </p>
      {error ? (
        <p className="record-history-error">{error}</p>
      ) : entries == null ? (
        <p className="record-history-empty">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="record-history-empty">Nothing logged yet.</p>
      ) : (
        <table className="patient-record-history__table">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Record</th>
              <th scope="col">What happened</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} data-history-entity={e.entityType ?? ''}>
                <td>
                  <time dateTime={e.at}>{historyTime(e.at)}</time>
                </td>
                <td>
                  <span className="patient-record-history__kind">
                    {KIND_LABEL[e.entityType ?? ''] ?? 'Record'}
                  </span>
                  {e.subject ? <> · {e.subject}</> : null}
                </td>
                <td>{e.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
