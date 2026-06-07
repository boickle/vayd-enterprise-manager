import { createPortal } from 'react-dom';

type Props = {
  message: string;
  onDismiss: () => void;
};

/** Fixed viewport notice when calendar interaction is blocked (reschedule, preview, edit visit). */
export function ScheduleCalendarBlockedNotice({ message, onDismiss }: Props) {
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
        <button
          type="button"
          className="scheduler-calendar-blocked-notice-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>,
    document.body
  );
}
