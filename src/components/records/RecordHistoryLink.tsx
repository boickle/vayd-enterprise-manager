import { useState } from 'react';
import { History } from 'lucide-react';
import {
  getRecordHistory,
  type RecordHistoryEntityType,
  type RecordHistoryEntry,
} from '../../api/recordHistory';
import { usePermissions } from '../../permissions/PermissionContext';
import './RecordHistoryLink.css';

/** "Nov 3, 10:42 AM" in the browser's time zone. */
export function historyTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Staff-only "History" link for one clinical record (EMR-07b). Generic on purpose: give it the
 * record type and id (a prescription today; vaccine doses later, EMR-A2) and it lists every logged
 * step, oldest first, e.g. "Nov 3, 10:42 AM — Directions entered by Sam Fernsby (tech) for
 * Dr. Odile Oakhollow: '1 tab PO q12h', qty 30, 2 refills".
 *
 * Renders nothing for anyone who is not signed in as staff, and must never be placed on the
 * medical-record print, records sent out, the Rx label or the client portal.
 */
export default function RecordHistoryLink({
  entityType,
  entityId,
  label = 'History',
  className = 'record-history-link',
}: {
  entityType: RecordHistoryEntityType;
  entityId: string | number | null | undefined;
  label?: string;
  className?: string;
}) {
  const { effective } = usePermissions();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<RecordHistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isStaff = Boolean(effective && (effective.employeeId != null || effective.isPlatformAdmin));
  if (!isStaff || entityId == null || entityId === '') return null;

  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      setEntries(await getRecordHistory(entityType, entityId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the history.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <span className="record-history">
      <button
        type="button"
        className={className}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          void toggle();
        }}
      >
        <History size={12} aria-hidden /> {label}
      </button>
      {open ? (
        <div className="record-history-panel" role="region" aria-label="Record history">
          {loading ? (
            <p className="record-history-empty">Loading…</p>
          ) : error ? (
            <p className="record-history-error">{error}</p>
          ) : !entries || entries.length === 0 ? (
            <p className="record-history-empty">Nothing logged yet.</p>
          ) : (
            <ol className="record-history-list">
              {entries.map((e) => (
                <li key={e.id}>
                  <time dateTime={e.at}>{historyTime(e.at)}</time> — {e.text}
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </span>
  );
}
