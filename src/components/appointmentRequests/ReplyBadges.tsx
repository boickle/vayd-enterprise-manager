/**
 * Red and blue counts of unread client replies (owner, Nov 11, 2026): red for requests that are
 * mine or nobody's, blue for someone else's. Renders nothing when both are zero.
 */
import './ReplyBadges.css';

type Props = { mine: number; others: number; className?: string };

function cap(n: number): string {
  return n > 99 ? '99+' : String(n);
}

export function ReplyBadges({ mine, others, className }: Props) {
  if (mine <= 0 && others <= 0) return null;
  return (
    <span className={`appt-reply-badges${className ? ` ${className}` : ''}`}>
      {mine > 0 ? (
        <sup
          className="navbar-schedule-tab-badge appt-reply-badge--mine"
          aria-label={`${mine} with unread replies for you`}
          title="Unread client replies: yours or unassigned"
        >
          {cap(mine)}
        </sup>
      ) : null}
      {others > 0 ? (
        <sup
          className="navbar-schedule-tab-badge appt-reply-badge--others"
          aria-label={`${others} with unread replies for others`}
          title="Unread client replies on someone else's requests"
        >
          {cap(others)}
        </sup>
      ) : null}
    </span>
  );
}
