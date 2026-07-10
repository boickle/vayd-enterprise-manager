import { createPortal } from 'react-dom';
import { useEffect, useState, type RefObject } from 'react';
import type { HouseholdScheduledVisitConflict } from '../utils/bookingHouseholdVisitWarning';
import { clientDisplayLabelFirstLast } from '../utils/clientFirstNameForSms';
import '../pages/Scheduler.css';

type Props = {
  open: boolean;
  clientLabel?: string | null;
  conflicts: HouseholdScheduledVisitConflict[];
  onContinue?: () => void;
  onCancel: () => void;
  onViewPlacement?: (conflict: HouseholdScheduledVisitConflict) => void;
  onPreviewPlacement?: (conflict: HouseholdScheduledVisitConflict) => void;
  continuing?: boolean;
  /** When set, copy reflects a pre-routing check instead of pre-book. */
  context?: 'booking' | 'routing';
  /** Dock over the routing pane so the practice calendar stays visible and interactive. */
  dockInRoutingPanel?: boolean;
  /** Review-only — no search/book primary action. */
  reviewOnly?: boolean;
  portalContainerRef?: RefObject<HTMLElement | null>;
};

export default function HouseholdScheduledVisitsWarningModal({
  open,
  clientLabel,
  conflicts,
  onContinue,
  onCancel,
  onViewPlacement,
  onPreviewPlacement,
  continuing = false,
  context = 'booking',
  dockInRoutingPanel = false,
  portalContainerRef,
  reviewOnly = false,
}: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    if (!open) setSelectedId(null);
  }, [open]);

  if (!open || conflicts.length === 0) return null;

  const client = clientDisplayLabelFirstLast(clientLabel);
  const isRouting = context === 'routing';
  const previewPlacement = onPreviewPlacement ?? onViewPlacement;

  const showPlacement = (row: HouseholdScheduledVisitConflict) => {
    if (!previewPlacement || continuing) return;
    setSelectedId(row.appointmentId);
    previewPlacement(row);
  };

  const backdropClass = [
    'scheduler-modal-backdrop',
    dockInRoutingPanel ? 'scheduler-modal-backdrop--routing-household' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const modal = (
    <div
      className={backdropClass}
      role="presentation"
      onMouseDown={(e) => {
        if (dockInRoutingPanel) return;
        if (e.target === e.currentTarget && !continuing) onCancel();
      }}
    >
      <div
        className="scheduler-modal scheduler-household-visits-warning-modal"
        role="dialog"
        aria-modal={!dockInRoutingPanel}
        aria-labelledby="household-visits-warning-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="scheduler-modal-header">
          <div className="scheduler-modal-header-text">
            <p className="scheduler-modal-eyebrow">
              {isRouting
                ? reviewOnly
                  ? 'Household visits'
                  : 'Before routing'
                : 'Before booking'}
            </p>
            <h2 id="household-visits-warning-title">Other scheduled visits</h2>
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
          <p className="scheduler-household-visits-warning-lead">
            {client} already has {conflicts.length === 1 ? 'a visit' : `${conflicts.length} visits`}{' '}
            scheduled for a household pet within three months before and after{' '}
            {isRouting ? 'your routing search dates' : 'this placement'}.{' '}
            {reviewOnly ? (
              <>Click a visit to preview it on the calendar.</>
            ) : (
              <>
                Review below, then {isRouting ? 'search anyway or cancel' : 'book anyway or cancel'}.
                {dockInRoutingPanel && previewPlacement ? (
                  <> Click a visit to preview it on the calendar.</>
                ) : null}
              </>
            )}
          </p>
          <ul className="scheduler-household-visits-warning-list">
            {conflicts.map((row) => (
              <li
                key={row.appointmentId}
                className={[
                  'scheduler-household-visits-warning-item',
                  previewPlacement ? 'scheduler-household-visits-warning-item--interactive' : '',
                  selectedId === row.appointmentId
                    ? 'scheduler-household-visits-warning-item--previewing'
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                role={previewPlacement ? 'button' : undefined}
                tabIndex={previewPlacement && !continuing ? 0 : undefined}
                onClick={() => showPlacement(row)}
                onKeyDown={(e) => {
                  if (!previewPlacement || continuing) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    showPlacement(row);
                  }
                }}
              >
                <div className="scheduler-household-visits-warning-item-main">
                  <strong>{row.patientNames.join(', ')}</strong>
                  <span className="scheduler-household-visits-warning-meta">
                    {row.appointmentTypeLabel}
                    {row.isHold ? (
                      <span className="scheduler-household-visits-warning-hold">Hold</span>
                    ) : null}
                  </span>
                </div>
                <div className="scheduler-household-visits-warning-when">{row.scheduledLabel}</div>
                {row.notes ? (
                  <div className="scheduler-household-visits-warning-notes">{row.notes}</div>
                ) : null}
                {onViewPlacement ? (
                  <button
                    type="button"
                    className="scheduler-household-visits-warning-view"
                    disabled={continuing}
                    onClick={(e) => {
                      e.stopPropagation();
                      showPlacement(row);
                    }}
                  >
                    View placement
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>

        <div className="scheduler-book-actions scheduler-household-visits-warning-actions">
          {reviewOnly ? (
            <button
              type="button"
              className="scheduler-book-btn primary"
              disabled={continuing}
              onClick={onCancel}
            >
              Close
            </button>
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
                disabled={continuing || !onContinue}
                onClick={onContinue}
              >
                {continuing
                  ? isRouting
                    ? 'Searching…'
                    : 'Booking…'
                  : isRouting
                    ? 'Search anyway'
                    : 'Book anyway'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  const portalTarget =
    dockInRoutingPanel && portalContainerRef?.current
      ? portalContainerRef.current
      : document.body;

  return createPortal(modal, portalTarget);
}
