import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Mail, Paperclip, Phone, RefreshCw, Search, Send, Upload } from 'lucide-react';
import {
  listRecordsRequests,
  notifyRecordsRequestStatusChanged,
  resendRecordsRequest,
  updateRecordsRequest,
  uploadRecordsRequestFile,
  type RecordsRequestRow,
  type RecordsRequestStatus,
} from '../api/recordsRequests';
import { apiErrorMessage } from '../api/http';
import {
  SCHEDULING_TOOLS_PAGE_REFRESH_EVENT,
  notifySchedulingToolsNavCountsRefresh,
} from '../hooks/useSchedulingToolsNavCounts';
import {
  isRecordsRequestUrgent,
  recordsRequestPhoneHref,
  visitCountdownLabel,
} from '../utils/recordsRequestUrgency';
import RecordsEmailLookup from '../components/records/RecordsEmailLookup';
import './RecordsRequestsPage.css';

type Filter = 'urgent' | 'open' | 'received' | 'closed' | 'all';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'urgent', label: 'Visit is close' },
  { id: 'open', label: 'Still waiting' },
  { id: 'received', label: 'Received' },
  { id: 'closed', label: 'Closed out' },
  { id: 'all', label: 'All' },
];

const STATUS_LABEL: Record<RecordsRequestStatus, string> = {
  pending: 'Waiting',
  received: 'Received',
  declined: 'No records',
  cancelled: 'Cancelled',
};

function matchesFilter(row: RecordsRequestRow, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'urgent') return isRecordsRequestUrgent(row);
  if (filter === 'open') return row.status === 'pending';
  if (filter === 'received') return row.status === 'received';
  return row.status === 'declined' || row.status === 'cancelled';
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** How long a pending request has been outstanding — shown, but not the triage signal. */
function daysWaiting(row: RecordsRequestRow): number | null {
  if (row.status !== 'pending') return null;
  const since = row.sentAt ?? row.requestedAt;
  if (!since) return null;
  const ms = Date.now() - new Date(since).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / 86_400_000);
}

export default function RecordsRequestsPage() {
  const [rows, setRows] = useState<RecordsRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('open');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [lookupId, setLookupId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listRecordsRequests({}));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err) || 'Could not load records requests.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onRefresh = () => void load();
    window.addEventListener(SCHEDULING_TOOLS_PAGE_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(SCHEDULING_TOOLS_PAGE_REFRESH_EVENT, onRefresh);
  }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((row) => matchesFilter(row, filter))
      .filter((row) =>
        q
          ? [row.patientName, row.clientName, row.hospitalName]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(q))
          : true,
      );
  }, [rows, filter, search]);

  const counts = useMemo(
    () => ({
      open: rows.filter((r) => r.status === 'pending').length,
      urgent: rows.filter((r) => isRecordsRequestUrgent(r)).length,
    }),
    [rows],
  );

  const afterChange = (next: RecordsRequestRow[]) => {
    setRows(next);
    notifyRecordsRequestStatusChanged();
    notifySchedulingToolsNavCountsRefresh();
  };

  const setStatus = async (row: RecordsRequestRow, status: RecordsRequestStatus) => {
    setBusyId(row.id);
    setError(null);
    try {
      await updateRecordsRequest(row.id, { status });
      afterChange(rows.map((r) => (r.id === row.id ? { ...r, status } : r)));
    } catch (err) {
      setError(apiErrorMessage(err) || 'Could not update that request.');
    } finally {
      setBusyId(null);
    }
  };

  const resend = async (row: RecordsRequestRow) => {
    setBusyId(row.id);
    setError(null);
    setFlash(null);
    try {
      const result = await resendRecordsRequest(row.id);
      setFlash(`Resent to ${result.sentTo}.`);
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, sentAt: new Date().toISOString() } : r)),
      );
    } catch (err) {
      setError(apiErrorMessage(err) || 'Could not resend that request.');
    } finally {
      setBusyId(null);
    }
  };

  /** Records that arrived by fax or post still need a home on the chart. */
  const uploadForRow = async (row: RecordsRequestRow, file: File) => {
    setBusyId(row.id);
    setError(null);
    setFlash(null);
    try {
      await uploadRecordsRequestFile(row.id, file);
      afterChange(
        rows.map((r) => (r.id === row.id ? { ...r, status: 'received' as const } : r)),
      );
      setFlash(
        `Filed ${file.name} on ${row.patientName ?? 'the patient'}'s chart. The summary lands on the timeline shortly.`,
      );
    } catch (err) {
      setError(apiErrorMessage(err) || 'Could not file that document.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="records-page">
      <div className="records-page__bar">
        <div className="records-page__filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`records-page__filter${filter === f.id ? ' is-active' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              {f.id === 'open' && counts.open > 0 ? (
                <span className="records-page__filter-count">{counts.open}</span>
              ) : null}
              {f.id === 'urgent' && counts.urgent > 0 ? (
                <span className="records-page__filter-count is-urgent">{counts.urgent}</span>
              ) : null}
            </button>
          ))}
        </div>
        <input
          className="records-page__search"
          value={search}
          placeholder="Search patient, client, or hospital…"
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          type="button"
          className="btn secondary"
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw size={14} aria-hidden /> Refresh
        </button>
      </div>

      {counts.urgent > 0 ? (
        <p className="records-page__stale">
          {counts.urgent} request{counts.urgent === 1 ? '' : 's'} still open with the visit
          three days out or sooner. Resend, or call the hospital.
        </p>
      ) : null}
      {error ? <p className="records-page__error">{error}</p> : null}
      {flash ? <p className="records-page__flash">{flash}</p> : null}

      {loading ? (
        <p className="records-page__muted">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="records-page__muted">
          {rows.length === 0
            ? 'No records requests yet. Right-click a visit on the calendar and choose Forms → Request records.'
            : 'Nothing matches this filter.'}
        </p>
      ) : (
        <table className="records-page__table">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Client</th>
              <th>Visit</th>
              <th>Hospital</th>
              <th>Asked</th>
              <th>Status</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const waiting = daysWaiting(row);
              const busy = busyId === row.id;
              const urgent = isRecordsRequestUrgent(row);
              const countdown = visitCountdownLabel(row);
              const phoneHref = recordsRequestPhoneHref(row);
              return (
                <Fragment key={row.id}>
                <tr className={`is-${row.status}${urgent ? ' is-urgent' : ''}`}>
                  <td>
                    <Link to={`/schedule/patients?patientId=${row.patientId}`}>
                      {row.patientName ?? `Patient #${row.patientId}`}
                    </Link>
                    {row.species ? (
                      <span className="records-page__muted"> · {row.species}</span>
                    ) : null}
                  </td>
                  <td>{row.clientName ?? '—'}</td>
                  <td>
                    {formatDate(row.appointmentStart)}
                    {countdown ? (
                      <span
                        className={`records-page__sub${urgent ? ' records-page__sub--warn' : ''}`}
                      >
                        {countdown}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {row.hospitalName ?? '—'}
                    {row.sentToEmail ? (
                      <span className="records-page__sub">{row.sentToEmail}</span>
                    ) : (
                      <span className="records-page__sub records-page__sub--warn">
                        no email — call them
                      </span>
                    )}
                  </td>
                  <td>
                    {formatDate(row.sentAt ?? row.requestedAt)}
                    {waiting != null ? (
                      <span className="records-page__sub">
                        {waiting === 0 ? 'today' : `${waiting}d ago`}
                      </span>
                    ) : null}
                    {row.requestedByName ? (
                      <span className="records-page__sub">by {row.requestedByName}</span>
                    ) : null}
                  </td>
                  <td>
                    <span className={`records-page__pill is-${row.status}`}>
                      {STATUS_LABEL[row.status]}
                    </span>
                    {row.chartDocumentId ? (
                      <span className="records-page__sub">
                        <Paperclip size={11} aria-hidden /> on chart
                      </span>
                    ) : null}
                  </td>
                  <td className="records-page__actions">
                    {row.status === 'pending' ? (
                      <>
                        <label className="records-page__upload" title="File a document you received">
                          <Upload size={13} aria-hidden />
                          <input
                            type="file"
                            hidden
                            disabled={busy}
                            accept="application/pdf,image/*,text/plain,.doc,.docx"
                            onChange={(e) => {
                              const file = e.currentTarget.files?.[0];
                              e.currentTarget.value = '';
                              if (file) void uploadForRow(row, file);
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          disabled={busy}
                          title="Search the shared inbox for this patient"
                          onClick={() =>
                            setLookupId((prev) => (prev === row.id ? null : row.id))
                          }
                        >
                          <Search size={12} aria-hidden /> Gmail
                        </button>
                        <button type="button" disabled={busy} onClick={() => void resend(row)}>
                          Resend
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void setStatus(row, 'received')}
                        >
                          Received
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void setStatus(row, 'cancelled')}
                        >
                          Cancel
                        </button>
                      </>
                    ) : row.status !== 'received' ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void setStatus(row, 'pending')}
                      >
                        Reopen
                      </button>
                    ) : null}
                  </td>
                </tr>

                {urgent ? (
                  <tr className="records-page__nudge-row">
                    <td colSpan={7}>
                      <div className="records-page__nudge">
                        <span>
                          {countdown ? countdown[0].toUpperCase() + countdown.slice(1) : 'Visit is close'}{' '}
                          and {row.hospitalName ?? 'the hospital'} hasn&rsquo;t sent
                          anything yet.
                        </span>
                        <button
                          type="button"
                          className="records-page__nudge-btn"
                          disabled={busy || !row.sentToEmail}
                          title={
                            row.sentToEmail
                              ? `Resend to ${row.sentToEmail}`
                              : 'No email on file for this hospital'
                          }
                          onClick={() => void resend(row)}
                        >
                          <Send size={12} aria-hidden /> Resend records request
                        </button>
                        {phoneHref ? (
                          <a className="records-page__nudge-btn" href={phoneHref}>
                            <Phone size={12} aria-hidden /> Call {row.hospitalName} ·{' '}
                            {row.hospitalPhone}
                          </a>
                        ) : (
                          <span className="records-page__nudge-none">
                            <Mail size={12} aria-hidden /> No phone number on file — add one
                            under Settings → Practice → Outside Hospitals
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : null}

                {lookupId === row.id ? (
                  <tr className="records-page__lookup-row">
                    <td colSpan={7}>
                      <RecordsEmailLookup
                        patientName={row.patientName}
                        clientName={row.clientName}
                        hospitalName={row.hospitalName}
                      />
                    </td>
                  </tr>
                ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
