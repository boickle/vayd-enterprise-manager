import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, Lock, Stethoscope } from 'lucide-react';
import './SoapEncounterPage.css';
import {
  listEncounters,
  type SoapEncounter,
  type SoapEncounterStatus,
} from '../api/visitWorkflow';

type Tab = SoapEncounterStatus;

/**
 * Doctor worklist — the "Pending SOAPs" queue (spec §1, ScheduleLayout rail).
 * Lists encounters by status and links into each SOAP. A lightweight entry point
 * so encounters are reachable without deep-linking.
 */
export default function DoctorWorklistPage() {
  const [tab, setTab] = useState<Tab>('draft');
  const [rows, setRows] = useState<SoapEncounter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);
    listEncounters({ status: tab })
      .then((data) => {
        if (!canceled) setRows(data);
      })
      .catch((e) => {
        if (!canceled) setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [tab]);

  return (
    <div className="soap-page">
      <header className="soap-header">
        <div className="soap-header-main">
          <Stethoscope size={20} />
          <div>
            <h1>Doctor worklist</h1>
            <span className="soap-header-sub">SOAP encounters by status</span>
          </div>
        </div>
        <div className="soap-mode-switch">
          <button
            type="button"
            className={tab === 'draft' ? 'active' : ''}
            onClick={() => setTab('draft')}
          >
            Pending SOAPs
          </button>
          <button
            type="button"
            className={tab === 'completed' ? 'active' : ''}
            onClick={() => setTab('completed')}
          >
            Completed
          </button>
        </div>
      </header>

      {error && <div className="soap-error soap-error-banner">{error}</div>}

      <div className="soap-section">
        {loading ? (
          <div className="soap-empty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="soap-empty">
            {tab === 'draft'
              ? 'No pending SOAPs.'
              : 'No completed encounters yet.'}
          </div>
        ) : (
          <ul className="soap-mpl-list">
            {rows.map((enc) => (
              <li key={enc.id} className="soap-mpl-item">
                {enc.status === 'completed' ? (
                  <Lock size={15} />
                ) : (
                  <ClipboardList size={15} />
                )}
                <span className="soap-mpl-label">
                  Patient #{enc.patientId} · Visit #{enc.appointmentId} ·{' '}
                  {enc.mode === 'quick' ? 'Quick' : 'Comprehensive'}
                </span>
                <Link
                  className="soap-btn small"
                  to={`/schedule/soap/${enc.appointmentId}/${enc.patientId}${
                    enc.clientId ? `?clientId=${enc.clientId}` : ''
                  }`}
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
