import { createPortal } from 'react-dom';

type Props = {
  message: string;
  onDismiss: () => void;
  /** Clears the lock (preview / reschedule), not just this toast. */
  actionLabel?: string;
  onAction?: () => void;
};

/** Fixed viewport notice when calendar interaction is blocked (reschedule, preview, edit visit). */
export function ScheduleCalendarBlockedNotice({
  message,
  onDismiss,
  actionLabel,
  onAction,
}: Props) {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="scheduler-calendar-blocked-notice-shell"
      role="alertdialog"
      aria-live="assertive"
      aria-label="Calendar unavailable"
      data-schedule-preview-allow
    >
      <div className="scheduler-calendar-blocked-notice">
        <p className="scheduler-calendar-blocked-notice-msg">{message}</p>
        {onAction && actionLabel ? (
          <button
            type="button"
            className="scheduler-calendar-blocked-notice-action"
            onClick={onAction}
          >
            {actionLabel}
          </button>
        ) : null}
        <button
          type="button"
          className="scheduler-calendar-blocked-notice-dismiss"
          onClick={onDismiss}
          aria-label="Hide this message"
        >
          ×
        </button>
      </div>
    </div>,
    document.body
  );
}
