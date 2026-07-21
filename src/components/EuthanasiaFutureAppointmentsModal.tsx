import { createPortal } from 'react-dom';
import type { EuthanasiaFutureAppointmentRow } from '../utils/euthanasiaFutureAppointments';
import '../pages/Scheduler.css';

export type EuthanasiaFutureAppointmentsModalMode = 'booking' | 'end_visit';

type Props = {
  open: boolean;
  mode: EuthanasiaFutureAppointmentsModalMode;
  rows: EuthanasiaFutureAppointmentRow[];
  patientLabel?: string | null;
  continuing?: boolean;
  onCancel: () => void;
  /** Booking: keep future appointments and continue. End visit: unused. */
  onKeep?: () => void;
  /** Booking: delete future appointments and continue. End visit: confirm end + delete. */
  onConfirmDelete: () => void;
};

export default function EuthanasiaFutureAppointmentsModal({
  open,
  mode,
  rows,
  patientLabel,
  continuing = false,
  onCancel,
  onKeep,
  onConfirmDelete,
}: Props) {
  if (!open || rows.length === 0) return null;

  const isBooking = mode === 'booking';
  const pet =
    patientLabel?.trim() ||
    (rows.length === 1 ? rows[0]!.patientName : `${new Set(rows.map((r) => r.patientId)).size} pets`);

  const modal = (
    <div
      className="scheduler-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !continuing) onCancel();
      }}
    >
      <div
        className="scheduler-modal scheduler-euthanasia-future-appts-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="euthanasia-future-appts-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="scheduler-modal-header">
          <div className="scheduler-modal-header-text">
            <p className="scheduler-modal-eyebrow">
              {isBooking ? 'Before booking' : 'Before ending visit'}
            </p>
            <h2 id="euthanasia-future-appts-title">
              {isBooking ? 'Future appointments found' : 'Remove future appointments'}
            </h2>
          </div>
          <button
            type="button"
            className="scheduler-modal-close"
            aria-label="Close"
            disabled={continuing}
            onClick={onCancel}
          >
            ×
          </button>
        </div>

        <div className="scheduler-modal-body">
          <p className="scheduler-euthanasia-future-appts-lead">
            {isBooking ? (
              <>
                <strong>{pet}</strong> already has{' '}
                {rows.length === 1 ? 'a future appointment' : `${rows.length} future appointments`}.
                After euthanasia those visits should usually be removed. Delete them now, or keep
                them and decide when you end the visit?
              </>
            ) : (
              <>
                Ending this euthanasia visit will remove{' '}
                {rows.length === 1 ? 'this future appointment' : 'these future appointments'} for{' '}
                <strong>{pet}</strong> and mark the patient inactive:
              </>
            )}
          </p>
          <ul className="scheduler-euthanasia-future-appts-list">
            {rows.map((row) => (
              <li key={row.appointmentId} className="scheduler-euthanasia-future-appts-item">
                <div className="scheduler-euthanasia-future-appts-item-main">
                  <strong>{row.patientName}</strong>
                  <span className="scheduler-euthanasia-future-appts-meta">
                    {row.appointmentTypeLabel}
                  </span>
                </div>
                <div className="scheduler-euthanasia-future-appts-when">{row.scheduledLabel}</div>
              </li>
            ))}
          </ul>
        </div>

        <div className="scheduler-book-actions scheduler-euthanasia-future-appts-actions">
          {isBooking ? (
            <>
              <button
                type="button"
                className="scheduler-book-btn secondary"
                disabled={continuing}
                onClick={onCancel}
              >
                Cancel booking
              </button>
              <button
                type="button"
                className="scheduler-book-btn secondary"
                disabled={continuing || !onKeep}
                onClick={onKeep}
              >
                {continuing ? 'Booking…' : 'Keep appointments'}
              </button>
              <button
                type="button"
                className="scheduler-book-btn primary"
                disabled={continuing}
                onClick={onConfirmDelete}
              >
                {continuing ? 'Deleting…' : 'Delete & book'}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="scheduler-book-btn secondary"
                disabled={continuing}
                onClick={onCancel}
              >
                Cancel
              </button>
              <button
                type="button"
                className="scheduler-book-btn primary"
                disabled={continuing}
                onClick={onConfirmDelete}
              >
                {continuing ? 'Saving…' : 'End visit & delete'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
