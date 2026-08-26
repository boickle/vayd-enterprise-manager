import type { ReactNode } from 'react';
import { staffConfirmClientNameChange } from '../utils/schedulerVisitDisplay';

type Props = {
  requestClientLabel: string;
  linkedClientLabel?: string | null;
  /** Strikethrough → new name only when a new client was linked after HOLD onboarding. */
  isNewClient?: boolean;
  className?: string;
  /** When set, wraps the current (linked) name in this element. */
  linkedNameWrapper?: (currentName: string) => ReactNode;
};

export function AppointmentRequestClientNameChange({
  requestClientLabel,
  linkedClientLabel,
  isNewClient = false,
  className,
  linkedNameWrapper,
}: Props) {
  const nameChange =
    isNewClient ? staffConfirmClientNameChange(requestClientLabel, linkedClientLabel) : null;
  const fallback = linkedClientLabel?.trim() || requestClientLabel.trim();

  if (nameChange) {
    const current = linkedNameWrapper
      ? linkedNameWrapper(nameChange.current)
      : nameChange.current;
    return (
      <span className={['appt-request-client-name-change', className].filter(Boolean).join(' ')}>
        <span className="appt-request-client-name-was">{nameChange.previous}</span>
        <span className="appt-request-client-name-arrow" aria-hidden>
          →
        </span>
        <span className="appt-request-client-name-now">{current}</span>
      </span>
    );
  }

  const content =
    linkedNameWrapper && linkedClientLabel?.trim()
      ? linkedNameWrapper(linkedClientLabel.trim())
      : linkedNameWrapper
        ? linkedNameWrapper(fallback)
        : fallback;

  return <span className={className}>{content}</span>;
}
