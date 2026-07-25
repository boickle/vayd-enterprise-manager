import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import './GmailOpenTrackingBadge.css';
import {
  fetchGmailMessageOpens,
  type GmailMessageTracking,
  type GmailTrackedOpenEvent,
} from '../../api/gmail';

function formatOpenTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatSince(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'just now';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatOpenTime(iso);
}

export function trackingSummaryLabel(tracking: GmailMessageTracking): string {
  if (tracking.openCount <= 0) return 'Not opened yet';
  const when = tracking.lastOpenedAt ?? tracking.firstOpenedAt;
  return when ? `Opened ${formatSince(when)}` : 'Opened';
}

function tooltipLabel(tracking: GmailMessageTracking): string {
  if (tracking.openCount <= 0) {
    return 'Sent from Scout with read tracking. No opens recorded yet — image blocking can hide real opens.';
  }
  const parts: string[] = [];
  if (tracking.firstOpenedAt) {
    parts.push(`First opened ${formatOpenTime(tracking.firstOpenedAt)}`);
  }
  if (tracking.lastOpenedAt && tracking.lastOpenedAt !== tracking.firstOpenedAt) {
    parts.push(`Last opened ${formatOpenTime(tracking.lastOpenedAt)}`);
  }
  parts.push(tracking.openCount === 1 ? '1 open' : `${tracking.openCount} opens`);
  return parts.join(' · ');
}

type Props = {
  tracking?: GmailMessageTracking | null;
  /** Required to load the per-open list when the badge is clicked. */
  mailbox?: string;
  /** Compact badges (list rows) show the icon and count only. */
  compact?: boolean;
  className?: string;
};

/**
 * Read receipt for a message Scout sent. Renders nothing for inbound mail or
 * for sends that predate tracking.
 */
export default function GmailOpenTrackingBadge({
  tracking,
  mailbox,
  compact = false,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<GmailTrackedOpenEvent[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  const messageId = tracking?.messageId ?? null;
  const opened = (tracking?.openCount ?? 0) > 0;
  const expandable = Boolean(open && mailbox && messageId);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!expandable || events || loadError || !mailbox || !messageId) return;
    let cancelled = false;
    void fetchGmailMessageOpens(mailbox, messageId)
      .then((res) => {
        if (!cancelled) setEvents(res.opens);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [expandable, events, loadError, mailbox, messageId]);

  if (!tracking) return null;

  const canExpand = Boolean(mailbox && messageId && opened);
  const label = trackingSummaryLabel(tracking);
  const title = tooltipLabel(tracking);
  const badgeClass = [
    'gmail-open-tracking__badge',
    opened ? 'gmail-open-tracking__badge--opened' : '',
    canExpand ? 'gmail-open-tracking__badge--button' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const inner = (
    <>
      {opened ? <Eye size={12} aria-hidden /> : <EyeOff size={12} aria-hidden />}
      {compact ? null : <span>{label}</span>}
      {tracking.openCount > 1 ? (
        <span className="gmail-open-tracking__count">{tracking.openCount}x</span>
      ) : null}
    </>
  );

  return (
    <span
      className={['gmail-open-tracking', className].filter(Boolean).join(' ')}
      ref={wrapRef}
    >
      {canExpand ? (
        <button
          type="button"
          className={badgeClass}
          title={title}
          aria-label={title}
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((prev) => !prev);
          }}
        >
          {inner}
        </button>
      ) : (
        <span className={badgeClass} title={title} aria-label={title}>
          {inner}
        </span>
      )}

      {expandable ? (
        <div
          className="gmail-open-tracking__popover"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="gmail-open-tracking__popover-title">
            {tracking.openCount === 1 ? 'Opened once' : `Opened ${tracking.openCount} times`}
          </div>
          {loadError ? (
            <div className="gmail-open-tracking__note">Could not load open history.</div>
          ) : events ? (
            <ul className="gmail-open-tracking__list">
              {events.map((event) => (
                <li key={event.openedAt}>{formatOpenTime(event.openedAt)}</li>
              ))}
            </ul>
          ) : (
            <div className="gmail-open-tracking__note">Loading…</div>
          )}
          <div className="gmail-open-tracking__note">
            Based on the recipient loading images. Clients that block images can hide real
            opens, and forwarded copies count too.
          </div>
        </div>
      ) : null}
    </span>
  );
}
