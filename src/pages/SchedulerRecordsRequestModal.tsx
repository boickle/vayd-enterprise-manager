import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, Plus, Send } from 'lucide-react';
import type { Appointment } from '../api/roomLoader';
import {
  createOutsideHospital,
  listOutsideHospitals,
  type OutsideHospital,
  type OutsideHospitalFields,
} from '../api/outsideHospitals';
import {
  createRecordsRequests,
  listRecordsRequests,
  notifyRecordsRequestStatusChanged,
  recordsRequestHospitalName,
  resendRecordsRequest,
  updateRecordsRequest,
  type RecordsRequestRow,
  type RecordsRequestTarget,
} from '../api/recordsRequests';
import { apiErrorMessage } from '../api/http';
import OutsideHospitalForm from '../components/settings/OutsideHospitalForm';
import './Scheduler.css';
import './SchedulerRecordsRequestModal.css';

function errorText(err: unknown, fallback: string): string {
  return apiErrorMessage(err) || fallback;
}

function formatWhen(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusLabel(row: RecordsRequestRow): string {
  switch (row.status) {
    case 'received':
      return `Received ${formatWhen(row.receivedAt)}`;
    case 'declined':
      return 'They have no records';
    case 'cancelled':
      return 'Cancelled';
    default:
      return row.sentAt ? `Asked ${formatWhen(row.sentAt)}` : 'Not sent yet';
  }
}

export function SchedulerRecordsRequestModal({
  appt,
  patientId,
  patientName,
  clientId,
  accentColor,
  onClose,
}: {
  appt: Appointment;
  patientId: number;
  patientName: string;
  clientId?: number | null;
  accentColor: string;
  onClose: () => void;
}) {
  const [hospitals, setHospitals] = useState<OutsideHospital[]>([]);
  const [existing, setExisting] = useState<RecordsRequestRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [freeText, setFreeText] = useState('');
  const [freeTextEmail, setFreeTextEmail] = useState('');
  const [attested, setAttested] = useState(true);
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [addingHospital, setAddingHospital] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const appointmentId = Number(appt.id);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      listOutsideHospitals(),
      listRecordsRequests({ patientId }),
    ])
      .then(([directory, rows]) => {
        if (cancelled) return;
        setHospitals(directory);
        setExisting(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err, 'Could not load the hospital directory.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  /** Hospitals already asked for this patient shouldn't be offered twice. */
  const alreadyAsked = useMemo(
    () =>
      new Set(
        existing
          .filter((r) => r.status === 'pending' || r.status === 'received')
          .map((r) => r.outsideHospitalId)
          .filter((id): id is number => id != null),
      ),
    [existing],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const pool = hospitals.filter((h) => !alreadyAsked.has(h.id));
    if (!q) return pool;
    return pool.filter((h) =>
      [h.name, h.email, h.address].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [hospitals, alreadyAsked, search]);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const targets: RecordsRequestTarget[] = useMemo(() => {
    const out: RecordsRequestTarget[] = [...selected].map((id) => ({ outsideHospitalId: id }));
    if (freeText.trim()) {
      out.push({
        freeTextHospital: freeText.trim(),
        ...(freeTextEmail.trim() ? { email: freeTextEmail.trim() } : {}),
      });
    }
    return out;
  }, [selected, freeText, freeTextEmail]);

  const missingEmail = useMemo(
    () =>
      [...selected]
        .map((id) => hospitals.find((h) => h.id === id))
        .filter((h): h is OutsideHospital => Boolean(h) && !h!.email)
        .map((h) => h.name),
    [selected, hospitals],
  );

  const addHospital = async (fields: OutsideHospitalFields) => {
    setBusy(true);
    setError(null);
    try {
      const created = await createOutsideHospital(fields);
      setHospitals((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setSelected((prev) => new Set(prev).add(created.id));
      setAddingHospital(false);
    } catch (err) {
      setError(errorText(err, 'Could not add that hospital.'));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!targets.length) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const result = await createRecordsRequests({
        appointmentId: Number.isFinite(appointmentId) ? appointmentId : undefined,
        patientId,
        clientId: clientId ?? undefined,
        targets,
        authorizationAttested: attested,
        notes: notes.trim() || undefined,
      });
      setExisting(await listRecordsRequests({ patientId }));
      setSelected(new Set());
      setFreeText('');
      setFreeTextEmail('');
      notifyRecordsRequestStatusChanged();
      setFlash(
        result.skipped.length
          ? `Emailed ${result.emailed}. No email on file for ${result.skipped.join(', ')} — call them instead.`
          : `Emailed ${result.emailed} hospital${result.emailed === 1 ? '' : 's'}.`,
      );
    } catch (err) {
      setError(errorText(err, 'Could not send those requests.'));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (
    row: RecordsRequestRow,
    status: 'received' | 'cancelled',
  ) => {
    setError(null);
    try {
      await updateRecordsRequest(row.id, { status });
      setExisting((prev) => prev.map((r) => (r.id === row.id ? { ...r, status } : r)));
      notifyRecordsRequestStatusChanged();
    } catch (err) {
      setError(errorText(err, 'Could not update that request.'));
    }
  };

  const resend = async (row: RecordsRequestRow) => {
    setError(null);
    setFlash(null);
    try {
      const result = await resendRecordsRequest(row.id);
      setFlash(`Resent to ${result.sentTo}.`);
    } catch (err) {
      setError(errorText(err, 'Could not resend that request.'));
    }
  };

  const modal = (
    <div
      className="scheduler-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="scheduler-modal scheduler-modal--edit"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scheduler-records-request-title"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ ['--scheduler-accent' as string]: accentColor }}
      >
        <div className="scheduler-modal-accent" aria-hidden />
        <div className="scheduler-modal-header">
          <div className="scheduler-modal-header-text">
            <p className="scheduler-modal-eyebrow">Forms</p>
            <h2 id="scheduler-records-request-title">Request Records</h2>
            <p className="scheduler-modal-subtitle">{patientName}</p>
          </div>
          <button type="button" className="scheduler-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="scheduler-modal-body records-request">
          {error ? <p className="records-request__error">{error}</p> : null}
          {flash ? <p className="records-request__flash">{flash}</p> : null}

          {existing.length > 0 ? (
            <section className="records-request__section">
              <h3>Already asked</h3>
              <ul className="records-request__existing">
                {existing.map((row) => (
                  <li key={row.id} className={`records-request__row is-${row.status}`}>
                    <div>
                      <strong>{recordsRequestHospitalName(row)}</strong>
                      <span className="records-request__muted"> · {statusLabel(row)}</span>
                    </div>
                    {row.status === 'pending' ? (
                      <div className="records-request__row-actions">
                        <button type="button" onClick={() => void resend(row)}>
                          Resend
                        </button>
                        <button type="button" onClick={() => void setStatus(row, 'received')}>
                          Mark received
                        </button>
                        <button type="button" onClick={() => void setStatus(row, 'cancelled')}>
                          Cancel
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="records-request__section">
            <h3>Who should we ask?</h3>
            {loading ? (
              <p className="records-request__muted">Loading directory…</p>
            ) : (
              <>
                <input
                  className="records-request__search"
                  value={search}
                  placeholder="Search hospitals…"
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="records-request__list">
                  {visible.length === 0 ? (
                    <p className="records-request__muted">
                      {hospitals.length === 0
                        ? 'No hospitals in the directory yet. Add one below, or import your list under Settings → Practice → Outside Hospitals.'
                        : 'No matches. Add a hospital below if it is not on the list.'}
                    </p>
                  ) : (
                    visible.map((h) => (
                      <label key={h.id} className="records-request__option">
                        <input
                          type="checkbox"
                          checked={selected.has(h.id)}
                          onChange={() => toggle(h.id)}
                        />
                        <span>
                          <strong>{h.name}</strong>
                          <span className="records-request__muted">
                            {h.email ? ` · ${h.email}` : ' · no email on file'}
                          </span>
                          {h.address ? (
                            <span className="records-request__addr">{h.address}</span>
                          ) : null}
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </>
            )}

            {addingHospital ? (
              <OutsideHospitalForm
                saving={busy}
                submitLabel="Add and select"
                onSubmit={(fields) => void addHospital(fields)}
                onCancel={() => setAddingHospital(false)}
              />
            ) : (
              <button
                type="button"
                className="records-request__link-btn"
                onClick={() => setAddingHospital(true)}
              >
                <Plus size={13} aria-hidden /> Add a hospital to the directory
              </button>
            )}

            <div className="records-request__freetext">
              <label>
                One-off hospital (not saved to the directory)
                <input
                  value={freeText}
                  placeholder="Name of the practice"
                  onChange={(e) => setFreeText(e.target.value)}
                />
              </label>
              <label>
                Their email
                <input
                  type="email"
                  value={freeTextEmail}
                  placeholder="records@example.com"
                  onChange={(e) => setFreeTextEmail(e.target.value)}
                />
              </label>
            </div>
          </section>

          <section className="records-request__section">
            <label className="records-request__attest">
              <input
                type="checkbox"
                checked={attested}
                onChange={(e) => setAttested(e.target.checked)}
              />
              <span>
                Client has authorized us to request records from this practice.
                <span className="records-request__muted">
                  {' '}
                  Saved with your name and today&rsquo;s date for our records. Not mentioned
                  in the email to the hospital.
                </span>
              </span>
            </label>

            <label className="records-request__notes">
              Notes (internal only)
              <textarea
                rows={2}
                value={notes}
                placeholder="Anything the CL should know about this request"
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>

            {missingEmail.length > 0 ? (
              <p className="records-request__warn">
                <AlertTriangle size={13} aria-hidden /> No email on file for{' '}
                {missingEmail.join(', ')}. Those will be logged as pending so you can call.
              </p>
            ) : null}
          </section>

          <div className="records-request__actions">
            <button
              type="button"
              className="btn"
              disabled={targets.length === 0 || busy}
              onClick={() => void send()}
            >
              {busy ? (
                'Sending…'
              ) : (
                <>
                  <Send size={14} aria-hidden /> Send {targets.length || ''} request
                  {targets.length === 1 ? '' : 's'}
                </>
              )}
            </button>
            <button type="button" className="btn secondary" onClick={onClose}>
              <Check size={14} aria-hidden /> Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

export default SchedulerRecordsRequestModal;
