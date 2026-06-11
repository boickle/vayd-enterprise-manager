import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  setForwardBookingBookAfterDate,
  type ForwardBookingEntry,
} from '../api/forwardBooking';
import {
  formatForwardBookingBookAfterDate,
  forwardBookingBookLaterQuickPicks,
  forwardBookingTodayYmd,
} from '../utils/forwardBookingBookLater';
import '../pages/Scheduler.css';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

type Props = {
  entry: ForwardBookingEntry;
  practiceTz: string;
  onClose: () => void;
  onSaved: (updated: ForwardBookingEntry) => void;
};

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function initialDateValue(entry: ForwardBookingEntry, practiceTz: string): string {
  const raw = entry.bookAfterDate?.trim();
  if (raw && /^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return forwardBookingBookLaterQuickPicks(practiceTz)[1]?.ymd ?? forwardBookingTodayYmd(practiceTz);
}

export function ForwardBookingBookLaterModal({ entry, practiceTz, onClose, onSaved }: Props) {
  const quickPicks = useMemo(() => forwardBookingBookLaterQuickPicks(practiceTz), [practiceTz]);
  const [dateYmd, setDateYmd] = useState(() => initialDateValue(entry, practiceTz));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientLabel = useMemo(() => {
    const c = entry.client;
    if (!c) return 'Client';
    return (
      [pickStr(c.firstName), pickStr(c.lastName)].filter(Boolean).join(' ').trim() || `Client #${c.id}`
    );
  }, [entry.client]);

  const patientLabel = pickStr(entry.patient?.name) ?? `Patient #${entry.patientId}`;
  const minDate = forwardBookingTodayYmd(practiceTz);

  const handleSave = async () => {
    if (!dateYmd.trim()) {
      setError('Choose a date.');
      return;
    }
    if (dateYmd < minDate) {
      setError('Choose today or a future date.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await setForwardBookingBookAfterDate(entry.id, PRACTICE_ID, dateYmd);
      onSaved(updated);
      onClose();
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { message?: string } }; message?: string };
      setError(ax?.response?.data?.message ?? ax?.message ?? 'Could not save book-later date.');
    } finally {
      setSaving(false);
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
        aria-labelledby="forward-booking-book-later-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="scheduler-modal-header">
          <div className="scheduler-modal-header-text">
            <p className="scheduler-modal-eyebrow">Forward booking</p>
            <h2 id="forward-booking-book-later-title">Book later</h2>
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
            This row will move to the Book later tab until the date below. On that day it returns to
            Needs booking automatically. The visit target date does not change.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            {quickPicks.map((pick) => (
              <button
                key={pick.id}
                type="button"
                className={`btn secondary${dateYmd === pick.ymd ? ' primary' : ''}`}
                disabled={saving}
                onClick={() => setDateYmd(pick.ymd)}
              >
                {pick.label}
              </button>
            ))}
          </div>

          <label className="scheduler-edit-field" style={{ display: 'block' }}>
            <span>Returns to Needs booking on</span>
            <input
              type="date"
              className="settings-input"
              value={dateYmd}
              min={minDate}
              disabled={saving}
              onChange={(e) => setDateYmd(e.target.value)}
              style={{ width: '100%', maxWidth: 280 }}
            />
          </label>
          {dateYmd ? (
            <p className="settings-muted" style={{ marginTop: 8, marginBottom: 0, fontSize: 13 }}>
              {formatForwardBookingBookAfterDate(dateYmd, practiceTz)}
            </p>
          ) : null}
        </div>

        <div className="scheduler-edit-footer">
          <button type="button" className="btn secondary" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn" disabled={saving} onClick={() => void handleSave()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
