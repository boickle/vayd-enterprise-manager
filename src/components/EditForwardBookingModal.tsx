import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import { patchForwardBooking, type ForwardBookingEntry } from '../api/forwardBooking';
import {
  FORWARD_BOOKING_AMOUNT_OPTIONS,
  FORWARD_BOOKING_UNIT_OPTIONS,
  forwardBookingOriginalVisitTargetParts,
  resolveForwardBookingIntervalFromEntry,
  type ForwardBookingIntervalUnit,
} from '../utils/forwardBookingFromAppointment';
import { PremedsCheckbox } from './PremedsCheckbox';
import '../pages/Scheduler.css';
import '../pages/Settings.css';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

type Props = {
  entry: ForwardBookingEntry;
  practiceId?: number;
  practiceTz: string;
  onClose: () => void;
  onSaved: (entry: ForwardBookingEntry) => void;
};

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function providerSelectLabel(p: Provider): string {
  const name =
    [pickStr(p.firstName), pickStr(p.lastName)].filter(Boolean).join(' ').trim() ||
    pickStr(p.name) ||
    `Provider #${p.id}`;
  const suffix = pickStr(p.designation) ?? pickStr(p.title);
  return suffix ? `${name}, ${suffix}` : name;
}

function errMsg(e: unknown): string {
  const ax = e as { response?: { data?: { message?: string | string[] } }; message?: string };
  const m = ax?.response?.data?.message;
  if (Array.isArray(m)) return m.join(', ');
  if (typeof m === 'string' && m.trim()) return m;
  if (ax?.message) return ax.message;
  return 'Could not save forward booking.';
}

export function EditForwardBookingModal({
  entry,
  practiceId = PRACTICE_ID,
  practiceTz,
  onClose,
  onSaved,
}: Props) {
  const initialInterval = resolveForwardBookingIntervalFromEntry(entry);
  const [forwardAmount, setForwardAmount] = useState(
    initialInterval ? String(initialInterval.amount) : '',
  );
  const [forwardUnit, setForwardUnit] = useState<ForwardBookingIntervalUnit | ''>(
    initialInterval?.unit ?? '',
  );
  const [providerId, setProviderId] = useState(
    entry.primaryProvider?.id != null ? String(entry.primaryProvider.id) : '',
  );
  const [bookingNotes, setBookingNotes] = useState(entry.bookingNotes ?? '');
  const [needsPremeds, setNeedsPremeds] = useState(entry.needsPremeds === true);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientLabel = useMemo(() => {
    const c = entry.client;
    if (!c) return `Client #${entry.clientId}`;
    return (
      [pickStr(c.firstName), pickStr(c.lastName)].filter(Boolean).join(' ').trim() ||
      `Client #${c.id}`
    );
  }, [entry.client, entry.clientId]);

  const patientLabel = pickStr(entry.patient?.name) ?? `Patient #${entry.patientId}`;
  const visit = forwardBookingOriginalVisitTargetParts(entry, practiceTz);
  const originalVisit = !visit.hasSource
    ? 'No associated visit'
    : visit.typeName
      ? `${visit.typeName} — ${visit.sourceDateLabel}`
      : visit.sourceDateLabel;
  const linked =
    entry.status === 'booked' ||
    (entry.bookedAppointmentId != null && entry.bookedAppointmentId > 0);

  const providerMissing =
    providerId.trim() !== '' &&
    !providers.some((p) => String(p.id) === providerId);
  const amountMissing =
    forwardAmount.trim() !== '' &&
    !FORWARD_BOOKING_AMOUNT_OPTIONS.some((n) => String(n) === forwardAmount);

  useEffect(() => {
    let cancelled = false;
    setProvidersLoading(true);
    void fetchPrimaryProviders()
      .then((rows) => {
        if (!cancelled) setProviders(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setProviders([]);
      })
      .finally(() => {
        if (!cancelled) setProvidersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [practiceId]);

  const submit = async () => {
    const amount = Number(forwardAmount);
    if (!Number.isFinite(amount) || amount <= 0 || !forwardUnit) {
      setError('Select how far out to forward book (number and days, weeks, or months).');
      return;
    }
    const nextProvider = providerId.trim() ? Number(providerId) : null;
    if (providerId.trim() && !Number.isFinite(nextProvider)) {
      setError('Select a provider.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await patchForwardBooking(entry.id, {
        practiceId,
        intervalAmount: amount,
        intervalUnit: forwardUnit,
        primaryProviderId: nextProvider,
        bookingNotes: bookingNotes.trim() ? bookingNotes.trim() : null,
        needsPremeds,
      });
      onSaved(updated);
      onClose();
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
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
        aria-labelledby="edit-forward-booking-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="scheduler-modal-header">
          <div className="scheduler-modal-header-text">
            <p className="scheduler-modal-eyebrow">Forward booking</p>
            <h2 id="edit-forward-booking-title">Edit forward booking</h2>
            <p className="scheduler-modal-subtitle">
              {clientLabel}
              <span className="scheduler-modal-subtitle-sep">·</span>
              {patientLabel}
            </p>
          </div>
          <button type="button" className="scheduler-modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="scheduler-modal-body scheduler-modal-body--edit">
          {error ? <p className="scheduler-edit-error">{error}</p> : null}
          <p className="settings-muted" style={{ marginTop: 0 }}>
            {linked
              ? 'Updates the follow-up interval, provider, and booking note. The calendar visit stays as booked.'
              : 'Updates how far out to schedule, the provider, and the booking note. Saving recalculates the target date.'}
          </p>
          <p className="settings-muted" style={{ marginTop: 0 }}>
            Original visit: {originalVisit}
            {visit.targetDateLabel && visit.targetDateLabel !== '—'
              ? ` · Current target: ${visit.targetDateLabel}`
              : ''}
          </p>

          <div className="scheduler-edit-two-col">
            <label className="scheduler-edit-field">
              <span>Forward book *</span>
              <select
                value={forwardAmount}
                onChange={(e) => setForwardAmount(e.target.value)}
                disabled={busy}
              >
                <option value="">Select…</option>
                {amountMissing ? <option value={forwardAmount}>{forwardAmount}</option> : null}
                {FORWARD_BOOKING_AMOUNT_OPTIONS.map((n) => (
                  <option key={n} value={String(n)}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="scheduler-edit-field">
              <span>Unit *</span>
              <select
                value={forwardUnit}
                onChange={(e) => setForwardUnit(e.target.value as ForwardBookingIntervalUnit | '')}
                disabled={busy}
              >
                <option value="">Select…</option>
                {FORWARD_BOOKING_UNIT_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="scheduler-edit-field" style={{ display: 'block', marginTop: 10 }}>
            <span>Forward booking with</span>
            <select
              className="settings-input"
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
              disabled={busy || providersLoading}
              aria-label="Forward booking provider"
              style={{ width: '100%' }}
            >
              <option value="">No provider</option>
              {providerMissing ? (
                <option value={providerId}>
                  {providerSelectLabel({
                    id: entry.primaryProvider?.id ?? providerId,
                    name:
                      [entry.primaryProvider?.firstName, entry.primaryProvider?.lastName]
                        .filter(Boolean)
                        .join(' ')
                        .trim() ||
                      entry.primaryProvider?.name ||
                      `Provider #${providerId}`,
                    email: '',
                  })}
                </option>
              ) : null}
              {providers.map((p) => (
                <option key={String(p.id)} value={String(p.id)}>
                  {providerSelectLabel(p)}
                </option>
              ))}
            </select>
          </label>

          <label className="scheduler-edit-field" style={{ display: 'block', marginTop: 10 }}>
            <span>Forward booking note</span>
            <textarea
              className="settings-input"
              rows={3}
              value={bookingNotes}
              onChange={(e) => setBookingNotes(e.target.value)}
              disabled={busy}
              placeholder="e.g. Prefers AM slots, same provider"
              style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: 14 }}
            />
          </label>
          <PremedsCheckbox checked={needsPremeds} onChange={setNeedsPremeds} disabled={busy} />
        </div>

        <div className="scheduler-edit-footer">
          <button type="button" className="btn secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
