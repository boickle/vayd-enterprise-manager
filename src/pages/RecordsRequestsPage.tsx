import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { CheckCircle2, FileText, Mail, Paperclip, Phone, RefreshCw, Search, Send, Upload } from 'lucide-react';
import {
  listRecordsRequests,
  notifyRecordsRequestStatusChanged,
  resendRecordsRequest,
  recordsRequestDocumentIds,
  recordsRequestNeedsReview,
  updateRecordsRequest,
  uploadRecordsRequestFiles,
  type RecordsRequestRow,
  type RecordsRequestStatus,
} from '../api/recordsRequests';
import { apiErrorMessage } from '../api/http';
import { appConfirm } from '../utils/appDialog';
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
import RecordDocumentsReview from '../components/records/RecordDocumentsReview';
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
  if (filter === 'received') return recordsRequestNeedsReview(row);
  return row.status === 'declined' || row.status === 'cancelled' || Boolean(row.closedOutAt);
}

function statusLabel(row: RecordsRequestRow): string {
  if (row.status === 'received' && row.closedOutAt) return 'Closed out';
  if (row.status === 'received' && row.summaryNoteId) return 'Summarized';
  return STATUS_LABEL[row.status];
}

function statusPillClass(row: RecordsRequestRow): string {
  if (row.status === 'received' && row.closedOutAt) return 'is-closed-out';
  if (row.status === 'received' && !row.summaryNoteId) return 'is-to-review';
  return `is-${row.status}`;
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
  const [reviewId, setReviewId] = useState<number | null>(null);

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
      toReview: rows.filter((r) => recordsRequestNeedsReview(r)).length,
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

  const markSummarized = async (row: RecordsRequestRow, summaryNoteId: string) => {
    setError(null);
    try {
      await updateRecordsRequest(row.id, { summaryNoteId });
      afterChange(
        rows.map((r) =>
          r.id === row.id
            ? { ...r, summaryNoteId, summarizedAt: new Date().toISOString() }
            : r,
        ),
      );
      setFlash(
        `Summary added to ${row.patientName ?? 'the patient'}'s medical record. Enter any reminders from these records, then close out.`,
      );
    } catch (err) {
      setError(apiErrorMessage(err) || 'The summary was added, but the request did not update.');
    }
  };

  const closeOut = async (row: RecordsRequestRow, closedOut: boolean) => {
    if (closedOut) {
      const ok = await appConfirm({
        title: 'Close out these records?',
        message: `Confirm the summary is on ${row.patientName ?? 'the patient'}'s record and every reminder from these records (vaccines, tests, recheck dates) has been entered.`,
        confirmLabel: 'Reminders entered · Close out',
      });
      if (!ok) return;
    }
    setBusyId(row.id);
    setError(null);
    setFlash(null);
    try {
      await updateRecordsRequest(row.id, { closedOut });
      afterChange(
        rows.map((r) =>
          r.id === row.id
            ? { ...r, closedOutAt: closedOut ? new Date().toISOString() : null }
            : r,
        ),
      );
      if (closedOut) {
        if (reviewId === row.id) setReviewId(null);
        setFlash(`${row.patientName ?? 'Records'} closed out.`);
      }
    } catch (err) {
      setError(apiErrorMessage(err) || 'Could not close out that request.');
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
  const uploadForRow = async (row: RecordsRequestRow, files: File[]) => {
    setBusyId(row.id);
    setError(null);
    setFlash(null);
    try {
      const result = await uploadRecordsRequestFiles(row.id, files);
      const filed = Array.isArray(result?.chartDocumentIds) ? result.chartDocumentIds : [];
      afterChange(
        rows.map((r) =>
          r.id === row.id
            ? {
                ...r,
                status: 'received' as const,
                chartDocumentIds: [...recordsRequestDocumentIds(r), ...filed],
                chartDocumentId: r.chartDocumentId ?? filed[0] ?? null,
                summaryNoteId: null,
                summarizedAt: null,
                closedOutAt: null,
              }
            : r,
        ),
      );
      setFlash(
        `Filed ${files.length === 1 ? files[0]!.name : `${files.length} documents`} on ${row.patientName ?? 'the patient'}'s chart. Open Received → Review & summarize to name them and add a summary.`,
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
              {f.id === 'received' && counts.toReview > 0 ? (
                <span
                  className="records-page__filter-count is-review"
                  title={`${counts.toReview} received ${counts.toReview === 1 ? 'record needs' : 'records need'} review`}
                >
                  {counts.toReview}
                </span>
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
                    <span className={`records-page__pill ${statusPillClass(row)}`}>
                      {statusLabel(row)}
                    </span>
                    {row.closedOutAt ? (
                      <span className="records-page__sub">
                        {formatDate(row.closedOutAt)}
                        {row.closedOutByName ? ` by ${row.closedOutByName}` : ''}
                      </span>
                    ) : null}
                    {recordsRequestDocumentIds(row).length ? (
                      <span className="records-page__sub">
                        <Paperclip size={11} aria-hidden />{' '}
                        {recordsRequestDocumentIds(row).length > 1
                          ? `${recordsRequestDocumentIds(row).length} documents on chart`
                          : 'on chart'}
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
                            multiple
                            disabled={busy}
                            accept="application/pdf,image/*,text/plain,.doc,.docx"
                            onChange={(e) => {
                              const files = Array.from(e.currentTarget.files ?? []);
                              e.currentTarget.value = '';
                              if (files.length) void uploadForRow(row, files);
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
                    ) : row.closedOutAt ? (
                      <button
                        type="button"
                        disabled={busy}
                        title="Put this back on the Received list"
                        onClick={() => void closeOut(row, false)}
                      >
                        Reopen review
                      </button>
                    ) : (
                      <>
                        <label
                          className="records-page__upload"
                          title="Add more documents to this request"
                        >
                          <Upload size={13} aria-hidden />
                          <input
                            type="file"
                            hidden
                            multiple
                            disabled={busy}
                            accept="application/pdf,image/*,text/plain,.doc,.docx"
                            onChange={(e) => {
                              const files = Array.from(e.currentTarget.files ?? []);
                              e.currentTarget.value = '';
                              if (files.length) void uploadForRow(row, files);
                            }}
                          />
                        </label>
                        {recordsRequestDocumentIds(row).length ? (
                          <button
                            type="button"
                            className={reviewId === row.id ? 'is-active' : undefined}
                            onClick={() =>
                              setReviewId((prev) => (prev === row.id ? null : row.id))
                            }
                          >
                            <FileText size={12} aria-hidden />{' '}
                            {reviewId === row.id ? 'Hide review' : 'Review & summarize'}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="records-page__close-out"
                          disabled={busy || !row.summaryNoteId}
                          title={
                            row.summaryNoteId
                              ? 'Summary is on the chart — confirm reminders are entered and close out'
                              : 'Add a summary with Review & summarize first'
                          }
                          onClick={() => void closeOut(row, true)}
                        >
                          <CheckCircle2 size={12} aria-hidden /> Close out
                        </button>
                      </>
                    )}
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

                {reviewId === row.id ? (
                  <tr className="records-page__review-row">
                    <td colSpan={7}>
                      <RecordDocumentsReview
                        patientId={row.patientId}
                        patientName={row.patientName}
                        clientId={row.clientId}
                        hospitalName={row.hospitalName}
                        documentIds={recordsRequestDocumentIds(row)}
                        onAccepted={(result) => {
                          if (result?.scoutNoteId) void markSummarized(row, result.scoutNoteId);
                        }}
                      />
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
